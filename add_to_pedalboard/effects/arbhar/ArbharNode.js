// ARBHAR NODE - Main Interface Class
// Wraps the AudioWorkletNode and provides high-level control API
// Emulates Instruō Arbhar Granular Audio Processor
// Up to 88 polyphonic grains, six 10-second audio layers
// Two granular engines: Continuous (clock-based) and Strike (trigger-based)

// Grain window shapes
export const GRAIN_WINDOWS = [
    { id: 0, name: 'Gaussian', description: 'Smooth bell curve (default)' },
    { id: 1, name: 'Square', description: 'Sharp edges, clicks at boundaries' },
    { id: 2, name: 'Sawtooth', description: 'Asymmetric attack/decay' }
];

// Layer names (Greek letters)
export const LAYERS = [
    { id: 0, name: 'Alpha', shortName: 'α' },
    { id: 1, name: 'Beta', shortName: 'β' },
    { id: 2, name: 'Gamma', shortName: 'γ' },
    { id: 3, name: 'Delta', shortName: 'δ' },
    { id: 4, name: 'Epsilon', shortName: 'ε' },
    { id: 5, name: 'Zeta', shortName: 'ζ' }
];

// Operating modes
export const SCAN_MODES = [
    { id: 0, name: 'Scan', description: 'Fixed scan position, Scan knob controls grain spawn point' },
    { id: 1, name: 'Follow', description: 'Playhead follows buffer, Scan knob controls playback speed' },
    { id: 2, name: 'Wavetable', description: 'Treats audio as wavetable, pitch-quantized grains' }
];

// Pitch quantization scales
export const PITCH_SCALES = [
    { id: 0, name: 'Chromatic', notes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    { id: 1, name: 'Major', notes: [0, 2, 4, 5, 7, 9, 11] },
    { id: 2, name: 'Minor', notes: [0, 2, 3, 5, 7, 8, 10] },
    { id: 3, name: 'Pentatonic', notes: [0, 2, 4, 7, 9] },
    { id: 4, name: 'Whole Tone', notes: [0, 2, 4, 6, 8, 10] },
    { id: 5, name: 'Fifths', notes: [0, 7] },
    { id: 6, name: 'Octaves', notes: [0] }
];

export class ArbharNode {
    constructor(ctx) {
        this.ctx = ctx;
        this.workletNode = null;
        this.isLoaded = false;

        // Input/output nodes for connection
        this.inputGain = ctx.createGain();
        this.outputGain = ctx.createGain();

        // All parameters with their ranges and defaults
        // Based on Arbhar hardware: 48kHz, 32-bit, 10-second buffers
        this.params = {
            // === GRAIN PARAMETERS ===
            scan: 0.5,              // 0-1: Position in buffer where grains spawn (Scan mode)
                                    // or playback speed multiplier (Follow mode: -2x to +2x)
            spray: 0,               // 0-1: Random offset from scan position (0 = precise, 1 = full buffer)
            intensity: 0.25,        // 0-1: Number of grains (1-44 per engine, exponential)
            length: 0.3,            // 0-1: Grain duration (~4ms to ~3s, logarithmic)
            pitch: 0.5,             // 0-1: Grain pitch (-2 to +2 octaves, center = unity)
            pitchSpray: 0,          // 0-1: Random pitch deviation per grain

            // === GRAIN SHAPE ===
            grainWindow: 0,         // 0-2: Window shape (Gaussian, Square, Sawtooth)
            tilt: 0.5,              // 0-1: Sawtooth asymmetry (0=instant attack, 1=instant decay)
            direction: 0.5,         // 0-1: Grain playback direction probability
                                    // 0=all reverse, 0.5=50/50, 1=all forward

            // === EFFECTS ===
            reverbMix: 0,           // 0-1: Stereo reverb amount
            reverbDecay: 0.5,       // 0-1: Reverb decay time
            feedback: 0,            // 0-1: Feedback/delay amount
            feedbackDelay: 0.3,     // 0-1: Delay time (grain-synced at low values)
            pan: 0.5,               // 0-1: Stereo pan position (0=L, 0.5=center, 1=R)
            panSpray: 0.5,          // 0-1: Random pan per grain (coin-toss default)

            // === MIX ===
            mix: 0.5,               // 0-1: Dry/wet mix
            grainLevel: 1,          // 0-1: Output level of grain engine
            directLevel: 0          // 0-1: Direct monitoring level
        };

        // Mode states
        this.scanMode = 0;              // 0=Scan, 1=Follow, 2=Wavetable
        this.activeLayer = 0;           // 0-5 (alpha through zeta)
        this.continuousEngine = true;   // true = Continuous engine, false = Strike engine
        this.strikeEngine = false;      // Strike engine enabled

        // Recording state
        this.isRecording = false;       // Currently capturing audio
        this.autoCapture = true;        // Onset detection enabled
        this.captureThreshold = 0.1;    // Onset detection threshold

        // Freeze state
        this.freezeActive = false;

        // Pitch quantization
        this.pitchQuantize = false;     // Enable pitch quantization
        this.pitchScale = 0;            // Scale index for quantization

        // Clock sync
        this.clockBPM = 120;
        this.externalClock = false;

        // Parameter change callback
        this.onParamChange = null;
    }

    // Initialize the AudioWorklet
    async initialize() {
        try {
            // Register the worklet module
            await this.ctx.audioWorklet.addModule(new URL('/worklets/arbhar-processor.js', import.meta.url).href);

            // Create the worklet node
            this.workletNode = new AudioWorkletNode(this.ctx, 'arbhar-processor', {
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
            console.error('ArbharNode: Failed to initialize:', error);
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
        this._sendMessage({ type: 'setScanMode', mode: this.scanMode });
        this._sendMessage({ type: 'setActiveLayer', layer: this.activeLayer });
        this._sendMessage({ type: 'setContinuousEngine', enabled: this.continuousEngine });
        this._sendMessage({ type: 'setStrikeEngine', enabled: this.strikeEngine });
        this._sendMessage({ type: 'setAutoCapture', enabled: this.autoCapture });
        this._sendMessage({ type: 'setCaptureThreshold', threshold: this.captureThreshold });
        this._sendMessage({ type: 'setPitchQuantize', enabled: this.pitchQuantize });
        this._sendMessage({ type: 'setPitchScale', scale: this.pitchScale });
        this._sendMessage({ type: 'setBPM', bpm: this.clockBPM });
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
            case 'grainTrigger':
                if (this.onGrainTrigger) {
                    this.onGrainTrigger(data.count);
                }
                break;

            case 'onsetDetected':
                if (this.onOnsetDetected) {
                    this.onOnsetDetected();
                }
                break;

            case 'bufferFull':
                if (this.onBufferFull) {
                    this.onBufferFull(data.layer);
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
            console.warn(`ArbharNode: Unknown param "${name}"`);
            return;
        }

        // Validate and clamp
        value = Math.max(0, Math.min(1, value));

        // Special handling for discrete params
        if (name === 'grainWindow') {
            value = Math.floor(value * 2.99); // 0, 1, or 2
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

    // === MODE CONTROL ===

    // Set Scan/Follow/Wavetable mode
    setScanMode(mode) {
        if (mode < 0 || mode > 2) {
            console.warn(`ArbharNode: Invalid scan mode ${mode}`);
            return;
        }

        this.scanMode = mode;
        this._sendMessage({ type: 'setScanMode', mode });

        if (this.onParamChange) {
            this.onParamChange('scanMode', mode);
        }
    }

    getScanMode() {
        return this.scanMode;
    }

    cycleScanMode() {
        this.setScanMode((this.scanMode + 1) % 3);
    }

    // === LAYER CONTROL ===

    setActiveLayer(layer) {
        if (layer < 0 || layer > 5) {
            console.warn(`ArbharNode: Invalid layer ${layer}`);
            return;
        }

        this.activeLayer = layer;
        this._sendMessage({ type: 'setActiveLayer', layer });

        if (this.onParamChange) {
            this.onParamChange('activeLayer', layer);
        }
    }

    getActiveLayer() {
        return this.activeLayer;
    }

    cycleLayer() {
        this.setActiveLayer((this.activeLayer + 1) % 6);
    }

    // === ENGINE CONTROL ===

    // Continuous engine (clock-based grain generation)
    setContinuousEngine(enabled) {
        this.continuousEngine = !!enabled;
        this._sendMessage({ type: 'setContinuousEngine', enabled: this.continuousEngine });

        if (this.onParamChange) {
            this.onParamChange('continuousEngine', this.continuousEngine);
        }
    }

    isContinuousEngineEnabled() {
        return this.continuousEngine;
    }

    toggleContinuousEngine() {
        this.setContinuousEngine(!this.continuousEngine);
    }

    // Strike engine (trigger-based grain generation)
    setStrikeEngine(enabled) {
        this.strikeEngine = !!enabled;
        this._sendMessage({ type: 'setStrikeEngine', enabled: this.strikeEngine });

        if (this.onParamChange) {
            this.onParamChange('strikeEngine', this.strikeEngine);
        }
    }

    isStrikeEngineEnabled() {
        return this.strikeEngine;
    }

    toggleStrikeEngine() {
        this.setStrikeEngine(!this.strikeEngine);
    }

    // Trigger strike engine manually
    strike() {
        this._sendMessage({ type: 'strike' });
    }

    // === RECORDING CONTROL ===

    // Start manual recording to active layer
    startRecording() {
        this.isRecording = true;
        this._sendMessage({ type: 'startRecording' });
    }

    stopRecording() {
        this.isRecording = false;
        this._sendMessage({ type: 'stopRecording' });
    }

    toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }

    // Auto-capture (onset detection)
    setAutoCapture(enabled) {
        this.autoCapture = !!enabled;
        this._sendMessage({ type: 'setAutoCapture', enabled: this.autoCapture });

        if (this.onParamChange) {
            this.onParamChange('autoCapture', this.autoCapture);
        }
    }

    isAutoCaptureEnabled() {
        return this.autoCapture;
    }

    toggleAutoCapture() {
        this.setAutoCapture(!this.autoCapture);
    }

    setCaptureThreshold(threshold) {
        this.captureThreshold = Math.max(0, Math.min(1, threshold));
        this._sendMessage({ type: 'setCaptureThreshold', threshold: this.captureThreshold });
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

    // === PITCH QUANTIZATION ===

    setPitchQuantize(enabled) {
        this.pitchQuantize = !!enabled;
        this._sendMessage({ type: 'setPitchQuantize', enabled: this.pitchQuantize });

        if (this.onParamChange) {
            this.onParamChange('pitchQuantize', this.pitchQuantize);
        }
    }

    isPitchQuantizeEnabled() {
        return this.pitchQuantize;
    }

    togglePitchQuantize() {
        this.setPitchQuantize(!this.pitchQuantize);
    }

    setPitchScale(scale) {
        if (scale < 0 || scale >= PITCH_SCALES.length) {
            console.warn(`ArbharNode: Invalid pitch scale ${scale}`);
            return;
        }

        this.pitchScale = scale;
        this._sendMessage({ type: 'setPitchScale', scale });

        if (this.onParamChange) {
            this.onParamChange('pitchScale', scale);
        }
    }

    getPitchScale() {
        return this.pitchScale;
    }

    cyclePitchScale() {
        this.setPitchScale((this.pitchScale + 1) % PITCH_SCALES.length);
    }

    // === BUFFER MANAGEMENT ===

    // Clear specific layer
    clearLayer(layer) {
        this._sendMessage({ type: 'clearLayer', layer });
    }

    // Clear all layers
    clearAllLayers() {
        this._sendMessage({ type: 'clearAllLayers' });
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

    syncToClock(clockSystem) {
        this.clockSource = clockSystem;
        this.setBPM(clockSystem.bpm);
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
            scanMode: this.scanMode,
            activeLayer: this.activeLayer,
            continuousEngine: this.continuousEngine,
            strikeEngine: this.strikeEngine,
            autoCapture: this.autoCapture,
            captureThreshold: this.captureThreshold,
            pitchQuantize: this.pitchQuantize,
            pitchScale: this.pitchScale
        };
    }

    // Load preset
    loadPreset(preset) {
        if (preset.params) {
            this.setParams(preset.params);
        }
        if (preset.scanMode !== undefined) {
            this.setScanMode(preset.scanMode);
        }
        if (preset.activeLayer !== undefined) {
            this.setActiveLayer(preset.activeLayer);
        }
        if (preset.continuousEngine !== undefined) {
            this.setContinuousEngine(preset.continuousEngine);
        }
        if (preset.strikeEngine !== undefined) {
            this.setStrikeEngine(preset.strikeEngine);
        }
        if (preset.autoCapture !== undefined) {
            this.setAutoCapture(preset.autoCapture);
        }
        if (preset.captureThreshold !== undefined) {
            this.setCaptureThreshold(preset.captureThreshold);
        }
        if (preset.pitchQuantize !== undefined) {
            this.setPitchQuantize(preset.pitchQuantize);
        }
        if (preset.pitchScale !== undefined) {
            this.setPitchScale(preset.pitchScale);
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
export function createArbharNode(ctx) {
    return new ArbharNode(ctx);
}
