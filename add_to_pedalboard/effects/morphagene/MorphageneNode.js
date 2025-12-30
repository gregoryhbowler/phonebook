// MORPHAGENE NODE - Main Interface Class
// Wraps the AudioWorkletNode and provides high-level control API
// Emulates Make Noise Soundhack Morphagene
// Next-generation Tape and Microsound music module
// 2.9 minute Reels, up to 300 Splices, Granular Genes with Morph

// Morph chord ratios (user configurable via options.txt on hardware)
export const DEFAULT_MORPH_CHORD_RATIOS = [1, 2, 3, 4]; // Unison, +1oct, +1oct+5th, +2oct

export class MorphageneNode {
    constructor(ctx) {
        this.ctx = ctx;
        this.workletNode = null;
        this.isLoaded = false;

        // Input/output nodes for connection
        this.inputGain = ctx.createGain();
        this.outputGain = ctx.createGain();

        // All parameters with their ranges and defaults
        // Based on Morphagene hardware: 48kHz, 32-bit, 2.9 minute reels
        this.params = {
            // === CORE PARAMETERS ===
            varispeed: 0.5,         // 0-1: Playback speed/direction
                                    // 0 = max reverse, 0.5 = stopped, 1 = max forward
                                    // Original speed at ~0.75 (2:30 position)

            geneSize: 0,            // 0-1: Gene playback window size
                                    // 0 = full splice, 1 = microsound

            slide: 0,               // 0-1: Position offset within splice for gene start
                                    // Also sets play reset/start point

            morph: 0.3,             // 0-1: Gene overlap and layering
                                    // 0 = gaps between genes
                                    // ~0.3 = seamless 1/1 loop
                                    // Higher = 2-4 voice overlap with panning/pitch

            organize: 0,            // 0-1: Splice selection
                                    // Takes effect at end of current gene

            sos: 1,                 // 0-1: Sound On Sound mix
                                    // 0 = input only, 1 = playback only

            // === MIX ===
            mix: 1                  // 0-1: Dry/wet mix (for insert processing)
        };

        // Recording state
        this.isRecording = false;

        // Play state
        this.isPlaying = true;

        // Freeze state
        this.freezeActive = false;

        // Clock sync
        this.clockBPM = 120;
        this.externalClock = false;

        // Morph chord ratios (user configurable)
        this.morphChordRatios = [...DEFAULT_MORPH_CHORD_RATIOS];

        // Reel state
        this.reelLength = 0;        // Current reel length in samples
        this.spliceCount = 1;       // Number of splices
        this.currentSplice = 0;     // Currently selected splice

        // Sample loading
        this.loadedSampleName = null;

        // Parameter change callback
        this.onParamChange = null;

        // EOSG callback
        this.onEndOfSpliceGene = null;
    }

    // Initialize the AudioWorklet
    async initialize() {
        try {
            // Register the worklet module
            await this.ctx.audioWorklet.addModule(new URL('/worklets/morphagene-processor.js', import.meta.url).href);

            // Create the worklet node
            this.workletNode = new AudioWorkletNode(this.ctx, 'morphagene-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2], // Stereo output
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
            console.error('MorphageneNode: Failed to initialize:', error);
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

        // Send modes and states
        this._sendMessage({ type: 'setBPM', bpm: this.clockBPM });
        this._sendMessage({ type: 'setExternalClock', enabled: this.externalClock });
        this._sendMessage({ type: 'setMorphChordRatios', ratios: this.morphChordRatios });
        this._sendMessage({ type: 'setPlay', active: this.isPlaying });
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
            case 'eosg':
                // End of Splice/Gene trigger
                if (this.onEndOfSpliceGene) {
                    this.onEndOfSpliceGene();
                }
                break;

            case 'recordingStopped':
                this.isRecording = false;
                this.reelLength = data.reelLength;
                this.spliceCount = data.spliceCount;
                // Sync varispeed if processor auto-started playback
                if (data.varispeed !== undefined) {
                    this.params.varispeed = data.varispeed;
                    if (this.onParamChange) {
                        this.onParamChange('varispeed', data.varispeed);
                    }
                }
                if (this.onRecordingStopped) {
                    this.onRecordingStopped(data);
                }
                break;

            case 'meter':
                if (this.onMeter) {
                    this.onMeter(data.input, data.output);
                }
                break;
        }
    }

    // === PARAMETER SETTERS ===

    setParam(name, value) {
        if (!(name in this.params)) {
            console.warn(`MorphageneNode: Unknown param "${name}"`);
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

    // === VARI-SPEED CONTROL ===

    // Set varispeed with normalized 0-1 value
    setVarispeed(value) {
        this.setParam('varispeed', value);
    }

    // Get current varispeed
    getVarispeed() {
        return this.params.varispeed;
    }

    // Set to forward 1x speed (~2:30 position)
    setForward1x() {
        this.setParam('varispeed', 0.75);
    }

    // Set to reverse 1x speed (~9:30 position)
    setReverse1x() {
        this.setParam('varispeed', 0.25);
    }

    // Stop playback
    stop() {
        this.setParam('varispeed', 0.5);
    }

    // Check if currently at forward 1x
    isForward1x() {
        return Math.abs(this.params.varispeed - 0.75) < 0.05;
    }

    // Check if currently at reverse 1x
    isReverse1x() {
        return Math.abs(this.params.varispeed - 0.25) < 0.05;
    }

    // Check if stopped
    isStopped() {
        return Math.abs(this.params.varispeed - 0.5) < 0.05;
    }

    // === GENE SIZE CONTROL ===

    setGeneSize(value) {
        this.setParam('geneSize', value);
    }

    getGeneSize() {
        return this.params.geneSize;
    }

    // Set to full splice (no granulation)
    setFullSplice() {
        this.setParam('geneSize', 0);
    }

    // === SLIDE CONTROL ===

    setSlide(value) {
        this.setParam('slide', value);
    }

    getSlide() {
        return this.params.slide;
    }

    // === MORPH CONTROL ===

    setMorph(value) {
        this.setParam('morph', value);
    }

    getMorph() {
        return this.params.morph;
    }

    // Set to seamless loop (~8:30 position)
    setSeamlessLoop() {
        this.setParam('morph', 0.3);
    }

    // Set morph chord ratios
    setMorphChordRatios(ratios) {
        if (Array.isArray(ratios) && ratios.length === 4) {
            this.morphChordRatios = ratios.map(r => Math.max(0.0625, Math.min(16, r)));
            this._sendMessage({ type: 'setMorphChordRatios', ratios: this.morphChordRatios });
        }
    }

    getMorphChordRatios() {
        return [...this.morphChordRatios];
    }

    // === ORGANIZE CONTROL ===

    setOrganize(value) {
        this.setParam('organize', value);
    }

    getOrganize() {
        return this.params.organize;
    }

    // === SOUND ON SOUND CONTROL ===

    setSOS(value) {
        this.setParam('sos', value);
    }

    getSOS() {
        return this.params.sos;
    }

    // Set to input only (for monitoring before recording)
    setInputOnly() {
        this.setParam('sos', 0);
    }

    // Set to playback only
    setPlaybackOnly() {
        this.setParam('sos', 1);
    }

    // === RECORDING CONTROL ===

    // Start recording into current splice (Time Lag Accumulation)
    startRecording() {
        this.isRecording = true;
        this._sendMessage({ type: 'startRecording', newSplice: false });
    }

    // Start recording into new splice at end of reel
    startRecordingNewSplice() {
        this.isRecording = true;
        this._sendMessage({ type: 'startRecording', newSplice: true });
    }

    // Stop recording
    stopRecording() {
        this.isRecording = false;
        this._sendMessage({ type: 'stopRecording' });
    }

    // Toggle recording
    toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }

    // === SPLICE CONTROL ===

    // Create splice marker at current playback position
    createSplice() {
        this._sendMessage({ type: 'createSplice' });
    }

    // Shift to next splice
    shiftSplice() {
        this._sendMessage({ type: 'shiftSplice' });
    }

    // Delete current splice marker (merge with next)
    deleteSpliceMarker() {
        this._sendMessage({ type: 'deleteSpliceMarker' });
    }

    // Delete current splice audio
    deleteSpliceAudio() {
        this._sendMessage({ type: 'deleteSpliceAudio' });
    }

    // Delete all splice markers (single splice = full reel)
    deleteAllSpliceMarkers() {
        this._sendMessage({ type: 'deleteAllSpliceMarkers' });
    }

    // Clear entire reel
    clearReel() {
        this._sendMessage({ type: 'clearReel' });
        this.reelLength = 0;
        this.spliceCount = 1;
        this.loadedSampleName = null;
    }

    // === PLAY CONTROL ===

    setPlay(active) {
        this.isPlaying = !!active;
        this._sendMessage({ type: 'setPlay', active: this.isPlaying });
    }

    isPlayActive() {
        return this.isPlaying;
    }

    togglePlay() {
        this.setPlay(!this.isPlaying);
    }

    // Trigger/retrigger from start
    trigger() {
        this.setPlay(false);
        this.setPlay(true);
    }

    // === FREEZE CONTROL ===

    freeze(active) {
        this.freezeActive = active;
        this._sendMessage({ type: 'freeze', active });

        if (this.onParamChange) {
            this.onParamChange('freezeActive', this.freezeActive);
        }
    }

    isFreeze() {
        return this.freezeActive;
    }

    toggleFreeze() {
        this.freeze(!this.freezeActive);
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

    isExternalClockEnabled() {
        return this.externalClock;
    }

    // Send clock pulse (for external clock sync)
    clockPulse() {
        this._sendMessage({ type: 'clockPulse' });
    }

    syncToClock(clockSystem) {
        this.clockSource = clockSystem;
        this.setBPM(clockSystem.bpm);
    }

    // === SAMPLE LOADING ===

    // Load an audio buffer as a reel
    async loadSample(audioBuffer, name = 'sample') {
        // Convert AudioBuffer to Float32Arrays
        const bufferL = audioBuffer.getChannelData(0);
        const bufferR = audioBuffer.numberOfChannels > 1 ?
            audioBuffer.getChannelData(1) :
            audioBuffer.getChannelData(0);

        // Send to processor
        this._sendMessage({
            type: 'loadBuffer',
            bufferL: Array.from(bufferL),
            bufferR: Array.from(bufferR),
            splices: []
        });

        this.reelLength = bufferL.length;
        this.spliceCount = 1;
        this.loadedSampleName = name;

        if (this.onParamChange) {
            this.onParamChange('loadedSample', name);
        }
    }

    // Load sample from URL
    async loadSampleFromURL(url, name) {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
            await this.loadSample(audioBuffer, name || url.split('/').pop());
        } catch (error) {
            console.error('MorphageneNode: Failed to load sample:', error);
            throw error;
        }
    }

    // Load sample from File
    async loadSampleFromFile(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
            await this.loadSample(audioBuffer, file.name);
        } catch (error) {
            console.error('MorphageneNode: Failed to load file:', error);
            throw error;
        }
    }

    // === CONNECTION ===

    // Get input node for connecting sources
    get input() {
        return this.inputGain;
    }

    // Connect output to destination
    connect(destination) {
        this.outputGain.connect(destination);
        return this;
    }

    disconnect() {
        this.outputGain.disconnect();
    }

    // === INITIALIZATION SETTINGS ===
    // Set all params to "initialization" state for unmodulated 1/1 playback
    setInitializationState() {
        this.setParams({
            varispeed: 0.75,    // Forward 1x
            geneSize: 0,        // Full splice
            slide: 0,           // Start of splice
            morph: 0.3,         // Seamless loop
            organize: 0,        // First splice
            sos: 1,             // Playback only
            mix: 1              // 100% wet
        });
    }

    // === PRESETS ===

    // Get preset object for saving
    getPreset() {
        return {
            params: { ...this.params },
            morphChordRatios: [...this.morphChordRatios],
            clockBPM: this.clockBPM,
            externalClock: this.externalClock
        };
    }

    // Load preset
    loadPreset(preset) {
        if (preset.params) {
            this.setParams(preset.params);
        }
        if (preset.morphChordRatios) {
            this.setMorphChordRatios(preset.morphChordRatios);
        }
        if (preset.clockBPM !== undefined) {
            this.setBPM(preset.clockBPM);
        }
        if (preset.externalClock !== undefined) {
            this.setExternalClock(preset.externalClock);
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
export function createMorphageneNode(ctx) {
    return new MorphageneNode(ctx);
}
