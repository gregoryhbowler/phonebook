// LUBADH NODE - Main Interface Class
// Wraps the AudioWorkletNode and provides high-level control API
// Emulates Instruō Lúbadh - Dual Channel Tape Looper
// 10 minutes recording per deck, varispeed ±4x, overdub with feedback
// Sound-on-sound looping with tape emulation characteristics

// Speed presets for the hardware's notch positions
export const SPEED_NOTCHES = {
    REVERSE_4X: 0,      // Full CCW - 4x reverse
    REVERSE_2X: 0.125,  // 2x reverse (octave down)
    REVERSE_1X: 0.25,   // 1x reverse (original speed)
    REVERSE_HALF: 0.375, // 0.5x reverse (octave down)
    STALL: 0.5,         // Center - stalled/stopped
    FORWARD_HALF: 0.625, // 0.5x forward (octave down)
    FORWARD_1X: 0.75,   // 1x forward (original speed)
    FORWARD_2X: 0.875,  // 2x forward (octave up)
    FORWARD_4X: 1       // Full CW - 4x forward
};

// Recording modes
export const RECORD_MODE = {
    LOOP: 'loop',       // Continuous looping record
    ONE_SHOT: 'oneshot' // One-shot record (stops at loop end)
};

// Playback modes
export const PLAYBACK_MODE = {
    LOOP: 'loop',       // Continuous looping playback
    ONE_SHOT: 'oneshot' // One-shot playback (triggered)
};

// Input monitoring modes
export const MONITOR_MODE = {
    ENABLED: 'enabled',  // Always pass input to output
    ARMED: 'armed',      // Only when armed/recording
    DISABLED: 'disabled' // Never pass input (playback only)
};

// Time knob modes
export const TIME_MODE = {
    CLOCK_DIV: 'clock',   // Clock division output
    DUB_LEVEL: 'dub',     // Overdub feedback level
    USER_PARAM: 'user'    // User-definable (tape emulation, etc.)
};

export class LubadhNode {
    constructor(ctx) {
        this.ctx = ctx;
        this.workletNode = null;
        this.isLoaded = false;

        // Input/output nodes for connection
        this.inputGain = ctx.createGain();
        this.outputGain = ctx.createGain();

        // All parameters with their ranges and defaults
        // Based on Lúbadh hardware: 48kHz, 32-bit, 10 minute reels per deck
        this.params = {
            // === DECK A (LEFT) PARAMETERS ===
            speedA: 0.75,           // 0-1: Varispeed control
                                    // 0 = 4x reverse, 0.5 = stalled, 1 = 4x forward
                                    // 0.75 = 1x forward (original speed)

            startA: 0,              // 0-1: Loop start position within recording
            lengthA: 1,             // 0-1: Loop length (1 = full recording)

            inputLevelA: 0.5,       // 0-1: Input gain (0.5 = unity, higher = saturation)
            outputLevelA: 1,        // 0-1: Output level

            dubLevelA: 0.9,         // 0-1: Overdub feedback (0.9 = slight decay)
                                    // Lower values = faster decay, 1 = infinite

            // === DECK B (RIGHT) PARAMETERS ===
            speedB: 0.75,
            startB: 0,
            lengthB: 1,
            inputLevelB: 0.5,
            outputLevelB: 1,
            dubLevelB: 0.9,

            // === SHARED/CROSSFADE PARAMETERS ===
            auxInputXfade: 0.5,     // 0-1: Aux input crossfade (0=deckA, 1=deckB)
            auxOutputXfade: 0.5,    // 0-1: Aux output crossfade (0=deckA, 1=deckB)

            // === TAPE EMULATION ===
            tapeEmulation: 0.5,     // 0-1: Amount of tape character
                                    // Affects saturation, filtering, wow/flutter
            wowFlutter: 0.3,        // 0-1: Pitch wobble amount
            saturation: 0.4,        // 0-1: Soft clipping/warmth
            tapeFilter: 0.5,        // 0-1: High frequency rolloff

            // === CROSSFADE SETTINGS ===
            crossfadeDuration: 0.5, // 0-1: Loop crossfade length (0=none, 1=250ms)

            // === MIX ===
            mix: 1                  // 0-1: Dry/wet mix (for insert processing)
        };

        // Recording state per deck
        this.deckA = {
            isRecording: false,
            isPlaying: true,
            isArmed: false,
            recordMode: RECORD_MODE.LOOP,
            playbackMode: PLAYBACK_MODE.LOOP,
            monitorMode: MONITOR_MODE.ENABLED,
            timeMode: TIME_MODE.CLOCK_DIV,
            recordedLength: 0,      // Length of recording in samples
            playheadPosition: 0,    // Current playhead position
            clockDivision: 1,       // Clock triggers per loop
            quantization: 0         // Start/length quantization (0=off)
        };

        this.deckB = {
            isRecording: false,
            isPlaying: true,
            isArmed: false,
            recordMode: RECORD_MODE.LOOP,
            playbackMode: PLAYBACK_MODE.LOOP,
            monitorMode: MONITOR_MODE.ENABLED,
            timeMode: TIME_MODE.CLOCK_DIV,
            recordedLength: 0,
            playheadPosition: 0,
            clockDivision: 1,
            quantization: 0
        };

        // Link mode - deck B mirrors deck A
        this.linkEnabled = false;

        // Multi-tap state (up to 4 playheads per deck)
        this.multiTapEnabled = false;
        this.tapsA = [];
        this.tapsB = [];

        // Clock sync
        this.clockBPM = 120;
        this.externalClock = false;

        // Sample loading state
        this.loadedSampleA = null;
        this.loadedSampleB = null;

        // Callbacks
        this.onParamChange = null;
        this.onRecordingStopped = null;
        this.onLoopEnd = null;
        this.onClockPulse = null;
    }

    // Initialize the AudioWorklet
    async initialize() {
        try {
            // Register the worklet module
            await this.ctx.audioWorklet.addModule(new URL('/worklets/lubadh-processor.js', import.meta.url).href);

            // Create the worklet node
            this.workletNode = new AudioWorkletNode(this.ctx, 'lubadh-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2], // Stereo output (deck A = L, deck B = R, or linked stereo)
                processorOptions: {
                    sampleRate: this.ctx.sampleRate
                }
            });

            // Connect: inputGain -> worklet -> outputGain
            this.inputGain.connect(this.workletNode);
            this.workletNode.connect(this.outputGain);

            // Setup message handling from worklet
            this.workletNode.port.onmessage = (e) => this._handleMessage(e.data);

            // Send initial parameters to worklet
            this._syncAllParams();

            this.isLoaded = true;
            return this;

        } catch (error) {
            console.error('LubadhNode: Failed to initialize:', error);
            throw error;
        }
    }

    // Sync all parameters to the worklet
    _syncAllParams() {
        if (!this.workletNode) return;

        // Send all current parameters
        for (const [name, value] of Object.entries(this.params)) {
            this._sendParam(name, value);
        }

        // Send deck states
        this._sendMessage({ type: 'setDeckState', deck: 'A', state: this.deckA });
        this._sendMessage({ type: 'setDeckState', deck: 'B', state: this.deckB });

        // Send modes
        this._sendMessage({ type: 'setBPM', bpm: this.clockBPM });
        this._sendMessage({ type: 'setLink', enabled: this.linkEnabled });
        this._sendMessage({ type: 'setMultiTap', enabled: this.multiTapEnabled });
    }

    // Send a parameter to the worklet
    _sendParam(name, value) {
        this._sendMessage({
            type: 'setParam',
            name,
            value
        });
    }

    // Send a message to the worklet
    _sendMessage(message) {
        this.workletNode?.port.postMessage(message);
    }

    // Handle messages from the worklet
    _handleMessage(data) {
        switch (data.type) {
            case 'recordingStopped':
                const deck = data.deck === 'A' ? this.deckA : this.deckB;
                deck.isRecording = false;
                deck.recordedLength = data.recordedLength;
                if (this.onRecordingStopped) {
                    this.onRecordingStopped(data.deck, data);
                }
                break;

            case 'loopEnd':
                if (this.onLoopEnd) {
                    this.onLoopEnd(data.deck);
                }
                break;

            case 'clockPulse':
                if (this.onClockPulse) {
                    this.onClockPulse(data.deck, data.division);
                }
                break;

            case 'playheadPosition':
                if (data.deck === 'A') {
                    this.deckA.playheadPosition = data.position;
                } else {
                    this.deckB.playheadPosition = data.position;
                }
                break;

            case 'meter':
                if (this.onMeter) {
                    this.onMeter(data);
                }
                break;
        }
    }

    // === PARAMETER SETTERS ===

    setParam(name, value) {
        if (!(name in this.params)) {
            console.warn(`LubadhNode: Unknown param "${name}"`);
            return;
        }

        // Validate and clamp
        value = Math.max(0, Math.min(1, value));

        this.params[name] = value;
        this._sendParam(name, value);

        if (this.onParamChange) {
            this.onParamChange(name, value);
        }
    }

    getParam(name) {
        return this.params[name];
    }

    getParams() {
        return { ...this.params };
    }

    setParams(params) {
        for (const [name, value] of Object.entries(params)) {
            this.setParam(name, value);
        }
    }

    // === SPEED CONTROL ===

    // Set speed for deck A (normalized 0-1)
    setSpeedA(value) {
        this.setParam('speedA', value);
        if (this.linkEnabled) {
            this.setParam('speedB', value);
        }
    }

    // Set speed for deck B
    setSpeedB(value) {
        this.setParam('speedB', value);
    }

    // Set to a speed notch preset
    setSpeedNotchA(notch) {
        if (notch in SPEED_NOTCHES) {
            this.setSpeedA(SPEED_NOTCHES[notch]);
        }
    }

    setSpeedNotchB(notch) {
        if (notch in SPEED_NOTCHES) {
            this.setSpeedB(SPEED_NOTCHES[notch]);
        }
    }

    // Stall deck A
    stallA() {
        this.setSpeedA(0.5);
    }

    // Stall deck B
    stallB() {
        this.setSpeedB(0.5);
    }

    // Forward 1x
    forward1xA() {
        this.setSpeedA(0.75);
    }

    forward1xB() {
        this.setSpeedB(0.75);
    }

    // Reverse 1x
    reverse1xA() {
        this.setSpeedA(0.25);
    }

    reverse1xB() {
        this.setSpeedB(0.25);
    }

    // === START/LENGTH CONTROL ===

    setStartA(value) {
        this.setParam('startA', value);
        if (this.linkEnabled) {
            this.setParam('startB', value);
        }
    }

    setStartB(value) {
        this.setParam('startB', value);
    }

    setLengthA(value) {
        this.setParam('lengthA', value);
        if (this.linkEnabled) {
            this.setParam('lengthB', value);
        }
    }

    setLengthB(value) {
        this.setParam('lengthB', value);
    }

    // === QUANTIZATION ===

    setQuantizationA(divisions) {
        // 0 = off, 2, 4, 8, 12, 16, 24, 32, 64
        this.deckA.quantization = divisions;
        this._sendMessage({ type: 'setQuantization', deck: 'A', divisions });
    }

    setQuantizationB(divisions) {
        this.deckB.quantization = divisions;
        this._sendMessage({ type: 'setQuantization', deck: 'B', divisions });
    }

    // === DUB LEVEL (OVERDUB FEEDBACK) ===

    setDubLevelA(value) {
        this.setParam('dubLevelA', value);
        if (this.linkEnabled) {
            this.setParam('dubLevelB', value);
        }
    }

    setDubLevelB(value) {
        this.setParam('dubLevelB', value);
    }

    // === INPUT/OUTPUT LEVELS ===

    setInputLevelA(value) {
        this.setParam('inputLevelA', value);
    }

    setInputLevelB(value) {
        this.setParam('inputLevelB', value);
    }

    setOutputLevelA(value) {
        this.setParam('outputLevelA', value);
    }

    setOutputLevelB(value) {
        this.setParam('outputLevelB', value);
    }

    // === TAPE EMULATION ===

    setTapeEmulation(value) {
        this.setParam('tapeEmulation', value);
    }

    setWowFlutter(value) {
        this.setParam('wowFlutter', value);
    }

    setSaturation(value) {
        this.setParam('saturation', value);
    }

    setTapeFilter(value) {
        this.setParam('tapeFilter', value);
    }

    // === CROSSFADE ===

    setCrossfadeDuration(value) {
        this.setParam('crossfadeDuration', value);
    }

    // === RECORDING CONTROL ===

    // Start recording on deck A
    startRecordingA() {
        this.deckA.isRecording = true;
        this._sendMessage({ type: 'startRecording', deck: 'A' });
        if (this.linkEnabled) {
            this.deckB.isRecording = true;
            this._sendMessage({ type: 'startRecording', deck: 'B' });
        }
    }

    // Start recording on deck B
    startRecordingB() {
        this.deckB.isRecording = true;
        this._sendMessage({ type: 'startRecording', deck: 'B' });
    }

    // Stop recording on deck A
    stopRecordingA() {
        this.deckA.isRecording = false;
        this._sendMessage({ type: 'stopRecording', deck: 'A' });
        if (this.linkEnabled) {
            this.deckB.isRecording = false;
            this._sendMessage({ type: 'stopRecording', deck: 'B' });
        }
    }

    // Stop recording on deck B
    stopRecordingB() {
        this.deckB.isRecording = false;
        this._sendMessage({ type: 'stopRecording', deck: 'B' });
    }

    // Toggle recording
    toggleRecordingA() {
        if (this.deckA.isRecording) {
            this.stopRecordingA();
        } else {
            this.startRecordingA();
        }
    }

    toggleRecordingB() {
        if (this.deckB.isRecording) {
            this.stopRecordingB();
        } else {
            this.startRecordingB();
        }
    }

    // Punch-in recording (destructive - replaces audio)
    punchInA() {
        this._sendMessage({ type: 'punchIn', deck: 'A' });
    }

    punchInB() {
        this._sendMessage({ type: 'punchIn', deck: 'B' });
    }

    // === ERASE ===

    eraseA() {
        this._sendMessage({ type: 'erase', deck: 'A' });
        this.deckA.recordedLength = 0;
        if (this.linkEnabled) {
            this._sendMessage({ type: 'erase', deck: 'B' });
            this.deckB.recordedLength = 0;
        }
    }

    eraseB() {
        this._sendMessage({ type: 'erase', deck: 'B' });
        this.deckB.recordedLength = 0;
    }

    // === RETRIGGER ===

    retriggerA() {
        this._sendMessage({ type: 'retrigger', deck: 'A' });
        if (this.linkEnabled) {
            this._sendMessage({ type: 'retrigger', deck: 'B' });
        }
    }

    retriggerB() {
        this._sendMessage({ type: 'retrigger', deck: 'B' });
    }

    // === MODES ===

    // Record mode
    setRecordModeA(mode) {
        if (Object.values(RECORD_MODE).includes(mode)) {
            this.deckA.recordMode = mode;
            this._sendMessage({ type: 'setRecordMode', deck: 'A', mode });
        }
    }

    setRecordModeB(mode) {
        if (Object.values(RECORD_MODE).includes(mode)) {
            this.deckB.recordMode = mode;
            this._sendMessage({ type: 'setRecordMode', deck: 'B', mode });
        }
    }

    // Playback mode
    setPlaybackModeA(mode) {
        if (Object.values(PLAYBACK_MODE).includes(mode)) {
            this.deckA.playbackMode = mode;
            this._sendMessage({ type: 'setPlaybackMode', deck: 'A', mode });
        }
    }

    setPlaybackModeB(mode) {
        if (Object.values(PLAYBACK_MODE).includes(mode)) {
            this.deckB.playbackMode = mode;
            this._sendMessage({ type: 'setPlaybackMode', deck: 'B', mode });
        }
    }

    // Monitor mode
    setMonitorModeA(mode) {
        if (Object.values(MONITOR_MODE).includes(mode)) {
            this.deckA.monitorMode = mode;
            this._sendMessage({ type: 'setMonitorMode', deck: 'A', mode });
        }
    }

    setMonitorModeB(mode) {
        if (Object.values(MONITOR_MODE).includes(mode)) {
            this.deckB.monitorMode = mode;
            this._sendMessage({ type: 'setMonitorMode', deck: 'B', mode });
        }
    }

    // Time mode
    setTimeModeA(mode) {
        if (Object.values(TIME_MODE).includes(mode)) {
            this.deckA.timeMode = mode;
            this._sendMessage({ type: 'setTimeMode', deck: 'A', mode });
        }
    }

    setTimeModeB(mode) {
        if (Object.values(TIME_MODE).includes(mode)) {
            this.deckB.timeMode = mode;
            this._sendMessage({ type: 'setTimeMode', deck: 'B', mode });
        }
    }

    // === LINK MODE ===

    setLink(enabled) {
        this.linkEnabled = !!enabled;
        this._sendMessage({ type: 'setLink', enabled: this.linkEnabled });

        // If enabling link, sync deck B to deck A
        if (this.linkEnabled) {
            this.setParam('speedB', this.params.speedA);
            this.setParam('startB', this.params.startA);
            this.setParam('lengthB', this.params.lengthA);
            this.setParam('dubLevelB', this.params.dubLevelA);
        }
    }

    isLinkEnabled() {
        return this.linkEnabled;
    }

    toggleLink() {
        this.setLink(!this.linkEnabled);
    }

    // === MONITOR MODE ===

    setMonitorModeA(mode) {
        this.deckA.monitorMode = mode;
        this._sendMessage({ type: 'setMonitorMode', deck: 'A', mode });
    }

    setMonitorModeB(mode) {
        this.deckB.monitorMode = mode;
        this._sendMessage({ type: 'setMonitorMode', deck: 'B', mode });
    }

    isMonitorEnabledA() {
        return this.deckA.monitorMode === 'enabled';
    }

    isMonitorEnabledB() {
        return this.deckB.monitorMode === 'enabled';
    }

    toggleMonitorA() {
        const newMode = this.deckA.monitorMode === 'enabled' ? 'disabled' : 'enabled';
        this.setMonitorModeA(newMode);
    }

    toggleMonitorB() {
        const newMode = this.deckB.monitorMode === 'enabled' ? 'disabled' : 'enabled';
        this.setMonitorModeB(newMode);
    }

    // === MULTI-TAP ===

    setMultiTap(enabled) {
        this.multiTapEnabled = !!enabled;
        this._sendMessage({ type: 'setMultiTap', enabled: this.multiTapEnabled });
    }

    // Add a new tap (playhead) to deck A
    addTapA() {
        if (this.tapsA.length < 4) {
            this._sendMessage({ type: 'addTap', deck: 'A' });
        }
    }

    addTapB() {
        if (this.tapsB.length < 4) {
            this._sendMessage({ type: 'addTap', deck: 'B' });
        }
    }

    // Remove a tap from deck A
    removeTapA() {
        this._sendMessage({ type: 'removeTap', deck: 'A' });
    }

    removeTapB() {
        this._sendMessage({ type: 'removeTap', deck: 'B' });
    }

    // Clear all taps
    clearTapsA() {
        this._sendMessage({ type: 'clearTaps', deck: 'A' });
        this.tapsA = [];
    }

    clearTapsB() {
        this._sendMessage({ type: 'clearTaps', deck: 'B' });
        this.tapsB = [];
    }

    // === CLOCK CONTROL ===

    setBPM(bpm) {
        this.clockBPM = Math.max(20, Math.min(300, bpm));
        this._sendMessage({ type: 'setBPM', bpm: this.clockBPM });
    }

    getBPM() {
        return this.clockBPM;
    }

    setExternalClock(enabled) {
        this.externalClock = !!enabled;
        this._sendMessage({ type: 'setExternalClock', enabled: this.externalClock });
    }

    // Send clock pulse
    clockPulse() {
        this._sendMessage({ type: 'clockPulse' });
    }

    syncToClock(clockSystem) {
        this.clockSource = clockSystem;
        this.setBPM(clockSystem.bpm);
    }

    // Set clock division for deck
    setClockDivisionA(division) {
        // Available: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 24, 32, 64
        this.deckA.clockDivision = division;
        this._sendMessage({ type: 'setClockDivision', deck: 'A', division });
    }

    setClockDivisionB(division) {
        this.deckB.clockDivision = division;
        this._sendMessage({ type: 'setClockDivision', deck: 'B', division });
    }

    // === AUX CROSSFADE ===

    setAuxInputCrossfade(value) {
        this.setParam('auxInputXfade', value);
    }

    setAuxOutputCrossfade(value) {
        this.setParam('auxOutputXfade', value);
    }

    // === SAMPLE LOADING ===

    // Load an audio buffer to deck A
    async loadSampleA(audioBuffer, name = 'sample') {
        const bufferL = audioBuffer.getChannelData(0);
        const bufferR = audioBuffer.numberOfChannels > 1 ?
            audioBuffer.getChannelData(1) :
            audioBuffer.getChannelData(0);

        this._sendMessage({
            type: 'loadBuffer',
            deck: 'A',
            bufferL: Array.from(bufferL),
            bufferR: Array.from(bufferR)
        });

        this.deckA.recordedLength = bufferL.length;
        this.loadedSampleA = name;

        if (this.onParamChange) {
            this.onParamChange('loadedSampleA', name);
        }
    }

    // Load an audio buffer to deck B
    async loadSampleB(audioBuffer, name = 'sample') {
        const bufferL = audioBuffer.getChannelData(0);
        const bufferR = audioBuffer.numberOfChannels > 1 ?
            audioBuffer.getChannelData(1) :
            audioBuffer.getChannelData(0);

        this._sendMessage({
            type: 'loadBuffer',
            deck: 'B',
            bufferL: Array.from(bufferL),
            bufferR: Array.from(bufferR)
        });

        this.deckB.recordedLength = bufferL.length;
        this.loadedSampleB = name;

        if (this.onParamChange) {
            this.onParamChange('loadedSampleB', name);
        }
    }

    // Load stereo sample to linked decks (L=A, R=B)
    async loadStereoSample(audioBuffer, name = 'sample') {
        if (audioBuffer.numberOfChannels >= 2) {
            const bufferL = audioBuffer.getChannelData(0);
            const bufferR = audioBuffer.getChannelData(1);

            this._sendMessage({
                type: 'loadBuffer',
                deck: 'A',
                bufferL: Array.from(bufferL),
                bufferR: Array.from(bufferL) // Mono for deck A
            });

            this._sendMessage({
                type: 'loadBuffer',
                deck: 'B',
                bufferL: Array.from(bufferR),
                bufferR: Array.from(bufferR) // Mono for deck B
            });

            this.deckA.recordedLength = bufferL.length;
            this.deckB.recordedLength = bufferR.length;
            this.loadedSampleA = name + ' (L)';
            this.loadedSampleB = name + ' (R)';
        } else {
            // Mono sample - load to both
            await this.loadSampleA(audioBuffer, name);
            await this.loadSampleB(audioBuffer, name);
        }
    }

    // Load sample from URL
    async loadSampleFromURL(url, deck = 'A', name) {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

            if (deck === 'A') {
                await this.loadSampleA(audioBuffer, name || url.split('/').pop());
            } else if (deck === 'B') {
                await this.loadSampleB(audioBuffer, name || url.split('/').pop());
            } else if (deck === 'stereo') {
                await this.loadStereoSample(audioBuffer, name || url.split('/').pop());
            }
        } catch (error) {
            console.error('LubadhNode: Failed to load sample:', error);
            throw error;
        }
    }

    // Load sample from File
    async loadSampleFromFile(file, deck = 'A') {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

            if (deck === 'A') {
                await this.loadSampleA(audioBuffer, file.name);
            } else if (deck === 'B') {
                await this.loadSampleB(audioBuffer, file.name);
            } else if (deck === 'stereo') {
                await this.loadStereoSample(audioBuffer, file.name);
            }
        } catch (error) {
            console.error('LubadhNode: Failed to load file:', error);
            throw error;
        }
    }

    // === CONNECTION ===

    get input() {
        return this.inputGain;
    }

    connect(destination) {
        this.outputGain.connect(destination);
        return this;
    }

    disconnect() {
        this.outputGain.disconnect();
    }

    // === INITIALIZATION SETTINGS ===

    setInitializationState() {
        this.setParams({
            speedA: 0.75,       // Forward 1x
            speedB: 0.75,
            startA: 0,
            startB: 0,
            lengthA: 1,
            lengthB: 1,
            inputLevelA: 0.5,   // Unity gain
            inputLevelB: 0.5,
            outputLevelA: 1,
            outputLevelB: 1,
            dubLevelA: 0.9,     // Slight decay
            dubLevelB: 0.9,
            auxInputXfade: 0.5,
            auxOutputXfade: 0.5,
            tapeEmulation: 0.5,
            wowFlutter: 0.3,
            saturation: 0.4,
            tapeFilter: 0.5,
            crossfadeDuration: 0.5,
            mix: 1
        });
    }

    // === PRESETS ===

    getPreset() {
        return {
            params: { ...this.params },
            deckA: { ...this.deckA },
            deckB: { ...this.deckB },
            linkEnabled: this.linkEnabled,
            multiTapEnabled: this.multiTapEnabled,
            clockBPM: this.clockBPM
        };
    }

    loadPreset(preset) {
        if (preset.params) {
            this.setParams(preset.params);
        }
        if (preset.linkEnabled !== undefined) {
            this.setLink(preset.linkEnabled);
        }
        if (preset.multiTapEnabled !== undefined) {
            this.setMultiTap(preset.multiTapEnabled);
        }
        if (preset.clockBPM !== undefined) {
            this.setBPM(preset.clockBPM);
        }
        // Restore deck modes
        if (preset.deckA) {
            if (preset.deckA.recordMode) this.setRecordModeA(preset.deckA.recordMode);
            if (preset.deckA.playbackMode) this.setPlaybackModeA(preset.deckA.playbackMode);
            if (preset.deckA.monitorMode) this.setMonitorModeA(preset.deckA.monitorMode);
            if (preset.deckA.timeMode) this.setTimeModeA(preset.deckA.timeMode);
        }
        if (preset.deckB) {
            if (preset.deckB.recordMode) this.setRecordModeB(preset.deckB.recordMode);
            if (preset.deckB.playbackMode) this.setPlaybackModeB(preset.deckB.playbackMode);
            if (preset.deckB.monitorMode) this.setMonitorModeB(preset.deckB.monitorMode);
            if (preset.deckB.timeMode) this.setTimeModeB(preset.deckB.timeMode);
        }
    }

    // === CLEANUP ===

    dispose() {
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode.port.close();
            this.workletNode = null;
        }

        this.inputGain?.disconnect();
        this.outputGain?.disconnect();

        this.isLoaded = false;
    }
}

// Factory function
export function createLubadhNode(ctx) {
    return new LubadhNode(ctx);
}
