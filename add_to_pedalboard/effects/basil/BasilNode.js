// BASIL NODE - Main Interface Class
// Wraps the AudioWorkletNode and provides high-level control API
// Emulates Bastl Instruments Basil "Flexible Stereo Space Delay"

export class BasilNode {
    constructor(ctx) {
        this.ctx = ctx;
        this.workletNode = null;
        this.isLoaded = false;

        // Input/output nodes for connection
        this.inputGain = ctx.createGain();
        this.outputGain = ctx.createGain();

        // All parameters with their ranges and defaults
        this.params = {
            // Core delay parameters
            time: 0.5,              // 0-1 (0=longest/CCW, 1=shortest/CW)
            stereo: 0,              // 0-1 stereo spread
            fine: 0,                // -1 to 1 fine tuning
            mix: 0.5,               // 0-1 dry/wet (constant power curve)

            // Feedback (-1 to 1)
            // Negative = ping-pong mode, Positive = normal
            // Absolute value is the feedback amount
            feedback: 0.3,

            // SPACE section
            blur: 0,                // -1 to 1 (-1=pre-feedback, +1=in feedback)
            filter: 0,              // -1 to 1 (-1=LP darkening, +1=HP brightening)
            taps: 0,                // -1 to 1 (-1=odd+even, +1=even only)

            // Input gain
            inputGain: 1            // 0-2 input level
        };

        // Mode states
        this.speedMode = 0;         // 0=1x, 1=1/2, 2=1/4, 3=1/8
        this.lofiMode = false;      // Anti-aliasing filter bypass
        this.feedbackMode = 'normal'; // 'normal' or 'pingPong'

        // Freeze state
        this.freezeActive = false;

        // Clock sync
        this.clockBPM = 120;
        this.syncEnabled = false;
        this.clockDivision = 1;
        this.clockSource = null;

        // Parameter change callback
        this.onParamChange = null;
    }

    // Initialize the AudioWorklet
    async initialize() {
        try {
            // Register the worklet module
            await this.ctx.audioWorklet.addModule(new URL('/worklets/basil-processor.js', import.meta.url).href);

            // Create the worklet node
            this.workletNode = new AudioWorkletNode(this.ctx, 'basil-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2], // Stereo output
                processorOptions: {
                    sampleRate: this.ctx.sampleRate,
                    maxDelayTime: 4 // 4 seconds max at 1/8 speed
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
            console.error('BasilNode: Failed to initialize:', error);
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

        // Send modes
        this._sendMessage({ type: 'setSpeedMode', mode: this.speedMode });
        this._sendMessage({ type: 'setLoFi', active: this.lofiMode });
        this._sendMessage({ type: 'setFeedbackMode', mode: this.feedbackMode });
        this._sendMessage({ type: 'setBPM', bpm: this.clockBPM });
        this._sendMessage({
            type: 'setSync',
            enabled: this.syncEnabled,
            division: this.clockDivision
        });
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
            case 'freezeComplete':
                if (this.onFreezeComplete) {
                    this.onFreezeComplete();
                }
                break;

            case 'meter':
                if (this.onMeter) {
                    this.onMeter(data.left, data.right);
                }
                break;
        }
    }

    // === PARAMETER SETTERS ===

    setParam(name, value) {
        if (!(name in this.params)) {
            console.warn(`BasilNode: Unknown param "${name}"`);
            return;
        }

        // Validate and clamp based on param type
        switch (name) {
            case 'time':
            case 'stereo':
            case 'mix':
                value = Math.max(0, Math.min(1, value));
                break;
            case 'fine':
            case 'feedback':
            case 'blur':
            case 'filter':
            case 'taps':
                value = Math.max(-1, Math.min(1, value));
                break;
            case 'inputGain':
                value = Math.max(0, Math.min(2, value));
                break;
        }

        this.params[name] = value;
        this._sendParam(name, value);

        // Update feedback mode based on feedback sign
        if (name === 'feedback') {
            this.feedbackMode = value < 0 ? 'pingPong' : 'normal';
        }

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

    // === SPEED MODE ===

    setSpeedMode(mode) {
        const validModes = [0, 1, 2, 3];
        if (!validModes.includes(mode)) {
            console.warn(`BasilNode: Invalid speed mode "${mode}"`);
            return;
        }

        this.speedMode = mode;
        this._sendMessage({ type: 'setSpeedMode', mode });

        if (this.onParamChange) {
            this.onParamChange('speedMode', mode);
        }
    }

    getSpeedMode() {
        return this.speedMode;
    }

    // Toggle between normal and long range speed modes
    toggleSpeedRange() {
        // Normal: 0 (1x) <-> 1 (1/2)
        // Long range: 2 (1/4) <-> 3 (1/8)
        if (this.speedMode < 2) {
            this.setSpeedMode(this.speedMode === 0 ? 1 : 0);
        } else {
            this.setSpeedMode(this.speedMode === 2 ? 3 : 2);
        }
    }

    // Switch to long range mode (1/4, 1/8)
    setLongRange(enabled) {
        if (enabled) {
            this.setSpeedMode(this.speedMode < 2 ? 2 : this.speedMode);
        } else {
            this.setSpeedMode(this.speedMode >= 2 ? 0 : this.speedMode);
        }
    }

    isLongRange() {
        return this.speedMode >= 2;
    }

    // === LO-FI MODE ===

    setLoFi(active) {
        this.lofiMode = !!active;
        this._sendMessage({ type: 'setLoFi', active: this.lofiMode });

        if (this.onParamChange) {
            this.onParamChange('lofiMode', this.lofiMode);
        }
    }

    isLoFi() {
        return this.lofiMode;
    }

    toggleLoFi() {
        this.setLoFi(!this.lofiMode);
    }

    // === FEEDBACK MODE ===

    setFeedbackMode(mode) {
        const validModes = ['normal', 'pingPong'];
        if (!validModes.includes(mode)) {
            console.warn(`BasilNode: Invalid feedback mode "${mode}"`);
            return;
        }

        this.feedbackMode = mode;
        this._sendMessage({ type: 'setFeedbackMode', mode });

        // Update feedback sign to match mode
        const fbAbs = Math.abs(this.params.feedback);
        this.params.feedback = mode === 'pingPong' ? -fbAbs : fbAbs;

        if (this.onParamChange) {
            this.onParamChange('feedbackMode', mode);
        }
    }

    getFeedbackMode() {
        return this.feedbackMode;
    }

    // === CLOCK SYNC ===

    syncToClock(clockSystem) {
        this.clockSource = clockSystem;
        this.setBPM(clockSystem.bpm);
    }

    setBPM(bpm) {
        this.clockBPM = Math.max(20, Math.min(300, bpm));
        this._sendMessage({ type: 'setBPM', bpm: this.clockBPM });
    }

    getBPM() {
        return this.clockBPM;
    }

    setSync(enabled, division = 1) {
        this.syncEnabled = enabled;
        this.clockDivision = division;
        this._sendMessage({
            type: 'setSync',
            enabled,
            division
        });

        if (this.onParamChange) {
            this.onParamChange('syncEnabled', enabled);
        }
    }

    isSync() {
        return this.syncEnabled;
    }

    // Set sync division (in beats)
    setSyncDivision(division) {
        this.clockDivision = division;
        if (this.syncEnabled) {
            this._sendMessage({
                type: 'setSync',
                enabled: true,
                division
            });
        }
    }

    // === SPECIAL CONTROLS ===

    // Freeze - lock current buffer as loop
    freeze(active) {
        this.freezeActive = active;
        this._sendMessage({
            type: 'freeze',
            active
        });
    }

    isFreeze() {
        return this.freezeActive;
    }

    toggleFreeze() {
        this.freeze(!this.freezeActive);
    }

    // Purge - clear all delay buffers
    purge() {
        this._sendMessage({ type: 'purge' });
    }

    // === SPACE SECTION CONVENIENCE METHODS ===

    // Set blur with mode selection
    // mode: 'pre' (before feedback), 'post' (in feedback), 'off'
    setBlur(amount, mode = 'post') {
        let value = Math.abs(Math.max(0, Math.min(1, amount)));
        if (mode === 'pre') {
            value = -value;
        } else if (mode === 'off') {
            value = 0;
        }
        this.setParam('blur', value);
    }

    // Set filter with mode selection
    // mode: 'lowpass', 'highpass', 'off'
    setFilter(amount, mode = 'lowpass') {
        let value = Math.abs(Math.max(0, Math.min(1, amount)));
        if (mode === 'lowpass') {
            value = -value;
        } else if (mode === 'off') {
            value = 0;
        }
        this.setParam('filter', value);
    }

    // Set taps with mode selection
    // mode: 'all' (odd+even), 'even', 'off'
    setTaps(amount, mode = 'all') {
        let value = Math.abs(Math.max(0, Math.min(1, amount)));
        if (mode === 'all') {
            value = -value;
        } else if (mode === 'off') {
            value = 0;
        }
        this.setParam('taps', value);
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

    // === PRESETS ===

    // Get preset object for saving
    getPreset() {
        return {
            params: { ...this.params },
            speedMode: this.speedMode,
            lofiMode: this.lofiMode,
            feedbackMode: this.feedbackMode,
            syncEnabled: this.syncEnabled,
            clockDivision: this.clockDivision
        };
    }

    // Load preset
    loadPreset(preset) {
        if (preset.params) {
            this.setParams(preset.params);
        }
        if (preset.speedMode !== undefined) {
            this.setSpeedMode(preset.speedMode);
        }
        if (preset.lofiMode !== undefined) {
            this.setLoFi(preset.lofiMode);
        }
        if (preset.feedbackMode) {
            this.setFeedbackMode(preset.feedbackMode);
        }
        if (preset.syncEnabled !== undefined) {
            this.setSync(preset.syncEnabled, preset.clockDivision || 1);
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

// Speed mode names
export const SPEED_MODES = [
    { id: 0, name: '1x', description: 'Full speed (0.5s max)', factor: 1 },
    { id: 1, name: '1/2', description: 'Half speed (1s max)', factor: 2 },
    { id: 2, name: '1/4', description: 'Quarter speed (2s max)', factor: 4 },
    { id: 3, name: '1/8', description: 'Eighth speed (4s max)', factor: 8 }
];

// Sync division options (matching hardware)
export const SYNC_DIVISIONS = [
    { name: '32 bars', beats: 32 },
    { name: '24 bars', beats: 24 },
    { name: '16 bars', beats: 16 },
    { name: '12 bars', beats: 12 },
    { name: '8 bars', beats: 8 },
    { name: '6 bars', beats: 6 },
    { name: '4 bars', beats: 4 },
    { name: '3 bars', beats: 3 },
    { name: '2 bars', beats: 2 },
    { name: '1 bar', beats: 1 },
    { name: '3/4', beats: 0.75 },
    { name: '1/2', beats: 0.5 },
    { name: '1/3', beats: 0.333 },
    { name: '1/4', beats: 0.25 },
    { name: '1/6', beats: 0.167 },
    { name: '1/8', beats: 0.125 }
];

// SPACE section parameter info
export const SPACE_PARAMS = {
    blur: {
        name: 'Blur',
        description: 'Diffusion/smearing effect',
        leftMode: 'Pre-feedback (first delays diffused)',
        rightMode: 'In feedback (more lush/resonant)'
    },
    filter: {
        name: 'Filter',
        description: 'Filter in feedback path',
        leftMode: 'Lowpass (darker)',
        rightMode: 'Highpass (brighter)'
    },
    taps: {
        name: 'Taps',
        description: 'Multi-tap delay for density',
        leftMode: 'Odd + even divisions',
        rightMode: 'Even divisions only'
    }
};

// Feedback mode info
export const FEEDBACK_MODES = [
    { id: 'normal', name: 'Normal', description: 'Standard feedback (knob right of center)' },
    { id: 'pingPong', name: 'Ping Pong', description: 'Cross-channel feedback (knob left of center)' }
];

// Factory function
export function createBasilNode(ctx) {
    return new BasilNode(ctx);
}
