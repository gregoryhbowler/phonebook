// NAUTILUS NODE - Main Interface Class
// Wraps the AudioWorkletNode and provides high-level control API

export class NautilusNode {
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
            mix: 0.5,               // 0-1 dry/wet
            resolution: 0.4,        // 0-1 maps to divisions (default ~quarter note)
            feedback: 0.5,          // 0-1 (careful at high values!)
            sensors: 1,             // 1-8 active delay lines per channel
            dispersal: 0,           // 0-1 spacing between lines
            reversal: 0,            // 0-1 which lines are reversed

            // Chroma (feedback effect)
            chroma: 0,              // 0-5 effect selector
            depth: 0,               // 0-1 effect amount

            // Shimmer intervals
            shimmerSemitones: 12,   // 1-12 semitones up
            deshimmerSemitones: 12, // 1-12 semitones down

            // End-of-chain reverb
            reverbMix: 0,           // 0-1
            reverbPreset: 0         // 0=normal, 1=bright, 2=dark
        };

        // Mode states
        this.delayMode = 'fade';      // fade, doppler, shimmer, deshimmer
        this.feedbackMode = 'normal'; // normal, pingPong, cascade, adrift

        // Freeze state
        this.freezeActive = false;

        // Clock sync
        this.clockBPM = 120;
        this.clockSource = null;

        // Parameter change callback
        this.onParamChange = null;
    }

    // Initialize the AudioWorklet
    async initialize() {
        try {
            // Register the worklet module
            await this.ctx.audioWorklet.addModule(new URL('/worklets/nautilus-processor.js', import.meta.url).href);

            // Create the worklet node
            this.workletNode = new AudioWorkletNode(this.ctx, 'nautilus-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2], // Stereo output
                processorOptions: {
                    sampleRate: this.ctx.sampleRate,
                    maxDelayTime: 10 // 10 seconds max
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
            console.error('NautilusNode: Failed to initialize:', error);
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
        this._sendMessage({ type: 'setDelayMode', mode: this.delayMode });
        this._sendMessage({ type: 'setFeedbackMode', mode: this.feedbackMode });
        this._sendMessage({ type: 'setBPM', bpm: this.clockBPM });
    }

    // Send a parameter to the worklet
    _sendParam(name, value, smoothTime = 0.02) {
        this._sendMessage({
            type: 'setParam',
            name,
            value,
            smoothTime
        });
    }

    // Send a message to the worklet
    _sendMessage(message) {
        this.workletNode?.port.postMessage(message);
    }

    // Handle messages from the worklet
    _handleMessage(data) {
        switch (data.type) {
            case 'sonar':
                // Sonar output for visualization or CV generation
                if (this.onSonarOutput) {
                    this.onSonarOutput(data.value);
                }
                break;

            case 'meter':
                // Level metering
                if (this.onMeter) {
                    this.onMeter(data.left, data.right);
                }
                break;

            case 'freezeComplete':
                // Freeze buffer captured
                if (this.onFreezeComplete) {
                    this.onFreezeComplete();
                }
                break;
        }
    }

    // === PARAMETER SETTERS ===

    setParam(name, value) {
        if (!(name in this.params)) {
            console.warn(`NautilusNode: Unknown param "${name}"`);
            return;
        }

        // Validate and clamp based on param type
        switch (name) {
            case 'sensors':
                value = Math.max(1, Math.min(8, Math.round(value)));
                break;
            case 'chroma':
                value = Math.max(0, Math.min(5, Math.round(value)));
                break;
            case 'shimmerSemitones':
            case 'deshimmerSemitones':
                value = Math.max(1, Math.min(12, Math.round(value)));
                break;
            case 'reverbPreset':
                value = Math.max(0, Math.min(2, Math.round(value)));
                break;
            default:
                // Most params are 0-1
                if (typeof value === 'number') {
                    value = Math.max(0, Math.min(1, value));
                }
        }

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

    // === MODE SETTERS ===

    setDelayMode(mode) {
        const validModes = ['fade', 'doppler', 'shimmer', 'deshimmer'];
        if (!validModes.includes(mode)) {
            console.warn(`NautilusNode: Invalid delay mode "${mode}"`);
            return;
        }

        this.delayMode = mode;
        this._sendMessage({ type: 'setDelayMode', mode });

        if (this.onParamChange) {
            this.onParamChange('delayMode', mode);
        }
    }

    getDelayMode() {
        return this.delayMode;
    }

    setFeedbackMode(mode) {
        const validModes = ['normal', 'pingPong', 'cascade', 'adrift'];
        if (!validModes.includes(mode)) {
            console.warn(`NautilusNode: Invalid feedback mode "${mode}"`);
            return;
        }

        this.feedbackMode = mode;
        this._sendMessage({ type: 'setFeedbackMode', mode });

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

    // === SPECIAL CONTROLS ===

    // Freeze - lock current buffer as beat repeat
    freeze(active) {
        this.freezeActive = active;
        this._sendMessage({
            type: 'freeze',
            active,
            resolution: this.params.resolution
        });
    }

    isFreeze() {
        return this.freezeActive;
    }

    // Purge - clear all delay buffers
    purge() {
        this._sendMessage({ type: 'purge' });
    }

    // Tap tempo
    tap(timestamp) {
        this._sendMessage({ type: 'tap', timestamp });
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
            delayMode: this.delayMode,
            feedbackMode: this.feedbackMode
        };
    }

    // Load preset
    loadPreset(preset) {
        if (preset.params) {
            this.setParams(preset.params);
        }
        if (preset.delayMode) {
            this.setDelayMode(preset.delayMode);
        }
        if (preset.feedbackMode) {
            this.setFeedbackMode(preset.feedbackMode);
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

// Resolution divisions for reference (0-1 maps to these)
export const RESOLUTION_DIVISIONS = [
    { name: '2 Bars', beats: 8 },
    { name: '1 Bar', beats: 4 },
    { name: 'Dotted Half', beats: 3 },
    { name: 'Half', beats: 2 },
    { name: 'Dotted Quarter', beats: 1.5 },
    { name: 'Quarter', beats: 1 },
    { name: 'Dotted Eighth', beats: 0.75 },
    { name: 'Eighth', beats: 0.5 },
    { name: 'Eighth Triplet', beats: 0.333 },
    { name: 'Sixteenth', beats: 0.25 },
    { name: 'Sixteenth Triplet', beats: 0.167 },
    { name: '32nd', beats: 0.125 },
    { name: '64th', beats: 0.0625 },
    { name: '128th', beats: 0.03125 },
    { name: '256th', beats: 0.015625 },
    { name: '512th', beats: 0.0078125 }
];

// Chroma effect names
export const CHROMA_EFFECTS = [
    { id: 0, name: 'Oceanic Absorption', description: 'Lowpass filter' },
    { id: 1, name: 'White Water', description: 'Highpass filter' },
    { id: 2, name: 'Refraction', description: 'Bitcrusher' },
    { id: 3, name: 'Pulse Amp', description: 'Saturation' },
    { id: 4, name: 'Receptor', description: 'Wavefolder' },
    { id: 5, name: 'SOS', description: 'Distortion' }
];

// Delay mode names
export const DELAY_MODES = [
    { id: 'fade', name: 'Fade', description: 'Smooth crossfade' },
    { id: 'doppler', name: 'Doppler', description: 'Pitch shift on time change' },
    { id: 'shimmer', name: 'Shimmer', description: 'Pitch up in feedback' },
    { id: 'deshimmer', name: 'De-Shimmer', description: 'Pitch down in feedback' }
];

// Feedback mode names
export const FEEDBACK_MODES = [
    { id: 'normal', name: 'Normal', description: 'Standard feedback' },
    { id: 'pingPong', name: 'Ping Pong', description: 'L/R bounce' },
    { id: 'cascade', name: 'Cascade', description: 'Serial delay chain' },
    { id: 'adrift', name: 'Adrift', description: 'Cross-channel cascade' }
];

// Factory function
export function createNautilusNode(ctx) {
    return new NautilusNode(ctx);
}
