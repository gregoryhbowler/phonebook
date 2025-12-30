// DATA BENDER NODE - Main Interface Class
// Wraps the AudioWorkletNode and provides high-level control API
// Emulates Qu-Bit Electronix Data Bender "Circuit Bent Digital Audio Buffer"

// Corrupt effect types
export const CORRUPT_TYPES = [
    { id: 0, name: 'Decimate', description: 'Bit crushing and downsampling', color: 'blue' },
    { id: 1, name: 'Dropout', description: 'Random audio dropouts', color: 'green' },
    { id: 2, name: 'Destroy', description: 'Saturation and hard clipping', color: 'gold' },
    { id: 3, name: 'DJ Filter', description: 'Resonant LP/HP filter', color: 'purple' },
    { id: 4, name: 'Vinyl Sim', description: 'Vinyl simulation with pops and noise', color: 'orange' }
];

// Clock division/multiplication values
export const CLOCK_DIV_MULT = [
    { value: 1/16, name: '/16' },
    { value: 1/8, name: '/8' },
    { value: 1/4, name: '/4' },
    { value: 1/2, name: '/2' },
    { value: 1, name: 'x1' },
    { value: 2, name: 'x2' },
    { value: 3, name: 'x3' },
    { value: 4, name: 'x4' },
    { value: 8, name: 'x8' }
];

export class DataBenderNode {
    constructor(ctx) {
        this.ctx = ctx;
        this.workletNode = null;
        this.isLoaded = false;

        // Input/output nodes for connection
        this.inputGain = ctx.createGain();
        this.outputGain = ctx.createGain();

        // All parameters with their ranges and defaults
        this.params = {
            // Core parameters
            time: 0.5,              // 0-1 (buffer period/clock div)
            repeats: 0,             // 0-1 (0=1 repeat, 1=max subdivisions)
            mix: 0.5,               // 0-1 dry/wet

            // Bend parameters
            bend: 0,                // 0-1 (macro: effect amount, micro: pitch)

            // Break parameters
            break: 0,               // 0-1 (macro: effect amount, micro: traverse/silence)

            // Corrupt parameters
            corrupt: 0,             // 0-1 corrupt amount

            // Advanced
            stereoWidth: 0,         // 0-1 stereo enhancement
            windowing: 0.02         // 0-1 glitch window fade (default 2%)
        };

        // Mode states
        this.mode = 'macro';        // 'macro' or 'micro'
        this.clockMode = 'internal'; // 'internal' or 'external'

        // Bend/Break enable states
        this.bendEnabled = false;
        this.breakEnabled = false;

        // Micro mode states
        this.microBendReverse = false;
        this.breakMicroMode = 'traverse'; // 'traverse' or 'silence'

        // Corrupt
        this.corruptType = 0;       // 0-4
        this.useExtendedCorrupt = true; // true = all 5 effects, false = original 3

        // Stereo behavior (macro mode)
        this.stereoBehavior = 'unique'; // 'unique' or 'shared'

        // Freeze state
        this.freezeActive = false;

        // Clock sync
        this.clockBPM = 120;
        this.clockDivMult = 1;      // Clock division/multiplication

        // Parameter change callback
        this.onParamChange = null;
    }

    // Initialize the AudioWorklet
    async initialize() {
        try {
            // Register the worklet module
            await this.ctx.audioWorklet.addModule(new URL('/worklets/databender-processor.js', import.meta.url).href);

            // Create the worklet node
            this.workletNode = new AudioWorkletNode(this.ctx, 'databender-processor', {
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
            console.error('DataBenderNode: Failed to initialize:', error);
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
        this._sendMessage({ type: 'setMode', mode: this.mode });
        this._sendMessage({ type: 'setClockMode', mode: this.clockMode });
        this._sendMessage({ type: 'setBPM', bpm: this.clockBPM });
        this._sendMessage({ type: 'setBend', enabled: this.bendEnabled });
        this._sendMessage({ type: 'setBreak', enabled: this.breakEnabled });
        this._sendMessage({ type: 'setBreakMicroMode', mode: this.breakMicroMode });
        this._sendMessage({ type: 'setCorruptType', value: this.corruptType });
        this._sendMessage({ type: 'setStereoBehavior', mode: this.stereoBehavior });
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
            case 'clockPulse':
                if (this.onClockPulse) {
                    this.onClockPulse();
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
            console.warn(`DataBenderNode: Unknown param "${name}"`);
            return;
        }

        // Validate and clamp based on param type
        switch (name) {
            case 'time':
            case 'repeats':
            case 'mix':
            case 'bend':
            case 'break':
            case 'corrupt':
            case 'stereoWidth':
            case 'windowing':
                value = Math.max(0, Math.min(1, value));
                break;
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

    // Set Macro/Micro mode
    setMode(mode) {
        const validModes = ['macro', 'micro'];
        if (!validModes.includes(mode)) {
            console.warn(`DataBenderNode: Invalid mode "${mode}"`);
            return;
        }

        this.mode = mode;
        this._sendMessage({ type: 'setMode', mode });

        if (this.onParamChange) {
            this.onParamChange('mode', mode);
        }
    }

    getMode() {
        return this.mode;
    }

    toggleMode() {
        this.setMode(this.mode === 'macro' ? 'micro' : 'macro');
    }

    // === CLOCK CONTROL ===

    // Set internal/external clock mode
    setClockMode(mode) {
        const validModes = ['internal', 'external'];
        if (!validModes.includes(mode)) {
            console.warn(`DataBenderNode: Invalid clock mode "${mode}"`);
            return;
        }

        this.clockMode = mode;
        this._sendMessage({ type: 'setClockMode', mode });

        if (this.onParamChange) {
            this.onParamChange('clockMode', mode);
        }
    }

    getClockMode() {
        return this.clockMode;
    }

    toggleClockMode() {
        this.setClockMode(this.clockMode === 'internal' ? 'external' : 'internal');
    }

    // Sync to clock system
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

    // Set clock division/multiplication (for external clock mode)
    setClockDivMult(value) {
        this.clockDivMult = value;
        this._sendMessage({ type: 'setClockDivMult', value });
    }

    getClockDivMult() {
        return this.clockDivMult;
    }

    // === BEND CONTROL ===

    setBendEnabled(enabled) {
        this.bendEnabled = !!enabled;
        this._sendMessage({ type: 'setBend', enabled: this.bendEnabled });

        if (this.onParamChange) {
            this.onParamChange('bendEnabled', this.bendEnabled);
        }
    }

    isBendEnabled() {
        return this.bendEnabled;
    }

    toggleBend() {
        this.setBendEnabled(!this.bendEnabled);
    }

    // Micro mode: toggle reverse playback
    setMicroBendReverse(reversed) {
        this.microBendReverse = !!reversed;
        this._sendMessage({ type: 'setParam', name: 'microBendReverse', value: this.microBendReverse });
    }

    isMicroBendReverse() {
        return this.microBendReverse;
    }

    toggleMicroBendReverse() {
        this.setMicroBendReverse(!this.microBendReverse);
    }

    // === BREAK CONTROL ===

    setBreakEnabled(enabled) {
        this.breakEnabled = !!enabled;
        this._sendMessage({ type: 'setBreak', enabled: this.breakEnabled });

        if (this.onParamChange) {
            this.onParamChange('breakEnabled', this.breakEnabled);
        }
    }

    isBreakEnabled() {
        return this.breakEnabled;
    }

    toggleBreak() {
        this.setBreakEnabled(!this.breakEnabled);
    }

    // Micro mode: set traverse/silence mode
    setBreakMicroMode(mode) {
        const validModes = ['traverse', 'silence'];
        if (!validModes.includes(mode)) {
            console.warn(`DataBenderNode: Invalid break micro mode "${mode}"`);
            return;
        }

        this.breakMicroMode = mode;
        this._sendMessage({ type: 'setBreakMicroMode', mode });

        if (this.onParamChange) {
            this.onParamChange('breakMicroMode', mode);
        }
    }

    getBreakMicroMode() {
        return this.breakMicroMode;
    }

    toggleBreakMicroMode() {
        this.setBreakMicroMode(this.breakMicroMode === 'traverse' ? 'silence' : 'traverse');
    }

    // === CORRUPT CONTROL ===

    setCorruptType(type) {
        const maxType = this.useExtendedCorrupt ? 4 : 2;
        type = Math.max(0, Math.min(maxType, Math.round(type)));

        this.corruptType = type;
        this._sendMessage({ type: 'setCorruptType', value: type });

        if (this.onParamChange) {
            this.onParamChange('corruptType', type);
        }
    }

    getCorruptType() {
        return this.corruptType;
    }

    // Cycle to next corrupt type
    nextCorruptType() {
        const maxType = this.useExtendedCorrupt ? 4 : 2;
        this.setCorruptType((this.corruptType + 1) % (maxType + 1));
    }

    // Toggle between original 3 and all 5 corrupt effects
    setExtendedCorrupt(enabled) {
        this.useExtendedCorrupt = !!enabled;
        // If current type is beyond the range, reset to 0
        if (!this.useExtendedCorrupt && this.corruptType > 2) {
            this.setCorruptType(0);
        }
    }

    isExtendedCorrupt() {
        return this.useExtendedCorrupt;
    }

    // === STEREO BEHAVIOR ===

    setStereoBehavior(mode) {
        const validModes = ['unique', 'shared'];
        if (!validModes.includes(mode)) {
            console.warn(`DataBenderNode: Invalid stereo behavior "${mode}"`);
            return;
        }

        this.stereoBehavior = mode;
        this._sendMessage({ type: 'setStereoBehavior', mode });

        if (this.onParamChange) {
            this.onParamChange('stereoBehavior', mode);
        }
    }

    getStereoBehavior() {
        return this.stereoBehavior;
    }

    toggleStereoBehavior() {
        this.setStereoBehavior(this.stereoBehavior === 'unique' ? 'shared' : 'unique');
    }

    // === SPECIAL CONTROLS ===

    // Freeze - lock current buffer
    freeze(active) {
        this.freezeActive = active;
        this._sendMessage({
            type: 'freeze',
            active
        });

        // If mix was at 0 (fully dry), set to fully wet when freezing
        if (active && this.params.mix === 0) {
            this.setParam('mix', 1);
        }
    }

    isFreeze() {
        return this.freezeActive;
    }

    toggleFreeze() {
        this.freeze(!this.freezeActive);
    }

    // Purge - clear all buffers
    purge() {
        this._sendMessage({ type: 'purge' });
    }

    // Reset - resync clock
    reset() {
        this._sendMessage({ type: 'reset' });
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
            mode: this.mode,
            clockMode: this.clockMode,
            bendEnabled: this.bendEnabled,
            breakEnabled: this.breakEnabled,
            microBendReverse: this.microBendReverse,
            breakMicroMode: this.breakMicroMode,
            corruptType: this.corruptType,
            useExtendedCorrupt: this.useExtendedCorrupt,
            stereoBehavior: this.stereoBehavior
        };
    }

    // Load preset
    loadPreset(preset) {
        if (preset.params) {
            this.setParams(preset.params);
        }
        if (preset.mode) {
            this.setMode(preset.mode);
        }
        if (preset.clockMode) {
            this.setClockMode(preset.clockMode);
        }
        if (preset.bendEnabled !== undefined) {
            this.setBendEnabled(preset.bendEnabled);
        }
        if (preset.breakEnabled !== undefined) {
            this.setBreakEnabled(preset.breakEnabled);
        }
        if (preset.microBendReverse !== undefined) {
            this.setMicroBendReverse(preset.microBendReverse);
        }
        if (preset.breakMicroMode) {
            this.setBreakMicroMode(preset.breakMicroMode);
        }
        if (preset.corruptType !== undefined) {
            this.setCorruptType(preset.corruptType);
        }
        if (preset.useExtendedCorrupt !== undefined) {
            this.setExtendedCorrupt(preset.useExtendedCorrupt);
        }
        if (preset.stereoBehavior) {
            this.setStereoBehavior(preset.stereoBehavior);
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
export function createDataBenderNode(ctx) {
    return new DataBenderNode(ctx);
}
