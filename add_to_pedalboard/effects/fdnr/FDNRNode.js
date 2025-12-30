// FDNR NODE - Main Interface Class
// Wraps the AudioWorkletNode and provides high-level control API
// Web Audio port of the FDNR VST3 plugin

// ============================================================================
// PRESET MODES (21 Zodiac/Constellation-themed presets)
// Directly ported from PluginProcessor::setParametersForMode
// ============================================================================

export const FDNR_MODES = {
    TwinStar: 0,      // Gemini - Balanced, dual nature, standard hall
    SeaSerpent: 1,    // Hydra - Deep, submerged, modulated tail
    HorseMan: 2,      // Centaurus - Strong, stable, room-like, woody
    Archer: 3,        // Sagittarius - Sharp, distant, bright attacks
    VoidMaker: 4,     // Great Annihilator - Massive, infinite, dark drone
    GalaxySpiral: 5,  // Andromeda - Swirling, vast, spacey
    HarpString: 6,    // Lyra - Resonant, metallic, comb-filtery
    GoatHorn: 7,      // Capricorn - Earthy, dry, distorted plate
    NebulaCloud: 8,   // Large Magellanic Cloud - Diffuse, soft, ambient
    Triangle: 9,      // Triangulum - Simple, geometric, sparse echoes
    CloudMajor: 10,   // Cirrus Major - Bright, airy, uplifting
    CloudMinor: 11,   // Cirrus Minor - Dark, moody, mysterious
    QueenChair: 12,   // Cassiopeia - Regal, wide, rich, complex
    HunterBelt: 13,   // Orion - Focused, punchy, tight
    WaterBearer: 14,  // Aquarius - Liquid, fluid, flowing
    TwoFish: 15,      // Pisces - Deep, dual delay lines feel
    ScorpionTail: 16, // Scorpio - Aggressive, stinging, intense
    BalanceScale: 17, // Libra - Perfectly neutral, reference room
    LionHeart: 18,    // Leo - Warm, bold, mid-forward
    Maiden: 19,       // Virgo - Clean, pure, pristine
    SevenSisters: 20  // Pleiades - Shimmering, multi-tap texture
};

export const MODE_NAMES = [
    'Twin Star',      // 0
    'Sea Serpent',    // 1
    'Horse Man',      // 2
    'Archer',         // 3
    'Void Maker',     // 4
    'Galaxy Spiral',  // 5
    'Harp String',    // 6
    'Goat Horn',      // 7
    'Nebula Cloud',   // 8
    'Triangle',       // 9
    'Cloud Major',    // 10
    'Cloud Minor',    // 11
    'Queen Chair',    // 12
    'Hunter Belt',    // 13
    'Water Bearer',   // 14
    'Two Fish',       // 15
    'Scorpion Tail',  // 16
    'Balance Scale',  // 17
    'Lion Heart',     // 18
    'Maiden',         // 19
    'Seven Sisters'   // 20
];

// Mode presets - exact port from setParametersForMode
const MODE_PRESETS = {
    // TwinStar (0) - Gemini - Balanced, dual nature, standard hall
    0: {
        mix: 40, delay: 350, feedback: 55, width: 100, density: 60,
        diffusion: 80, modRate: 0.6, modDepth: 25,
        eq3Low: 0, eq3Mid: 0, eq3High: 0,
        warp: 0, saturation: 0, ducking: 0, gateThresh: -100
    },

    // SeaSerpent (1) - Hydra - Deep, submerged, modulated tail
    1: {
        mix: 55, delay: 850, feedback: 88, width: 90, density: 85,
        diffusion: 50, modRate: 0.25, modDepth: 75,
        eq3Low: 4, eq3Mid: 0, eq3High: -6,
        warp: 20, saturation: 0, ducking: 0, gateThresh: -100
    },

    // HorseMan (2) - Centaurus - Strong, stable, room-like, woody
    2: {
        mix: 35, delay: 180, feedback: 40, width: 75, density: 95,
        diffusion: 100, modRate: 1.2, modDepth: 10,
        eq3Low: -1, eq3Mid: 2, eq3High: -2,
        warp: 0, saturation: 0, ducking: 0, gateThresh: -100
    },

    // Archer (3) - Sagittarius - Sharp, distant, bright attacks
    3: {
        mix: 45, delay: 550, feedback: 65, width: 100, density: 30,
        diffusion: 40, modRate: 0.8, modDepth: 35,
        eq3Low: 0, eq3Mid: 0, eq3High: 4,
        warp: 0, saturation: 10, ducking: 0, gateThresh: -100
    },

    // VoidMaker (4) - Great Annihilator - Massive, infinite, dark drone
    4: {
        mix: 100, delay: 1000, feedback: 98, width: 100, density: 100,
        diffusion: 100, modRate: 0.15, modDepth: 60,
        eq3Low: 8, eq3Mid: 0, eq3High: -12,
        warp: 0, saturation: 45, ducking: 0, gateThresh: -100
    },

    // GalaxySpiral (5) - Andromeda - Swirling, vast, spacey
    5: {
        mix: 50, delay: 600, feedback: 80, width: 100, density: 50,
        diffusion: 70, modRate: 2.8, modDepth: 65,
        eq3Low: 0, eq3Mid: 0, eq3High: 0,
        warp: 30, saturation: 0, ducking: 0, gateThresh: -100
    },

    // HarpString (6) - Lyra - Resonant, metallic, comb-filtery
    6: {
        mix: 40, delay: 60, feedback: 90, width: 60, density: 0,
        diffusion: 0, modRate: 0.4, modDepth: 15,
        eq3Low: 0, eq3Mid: 0, eq3High: 6,
        warp: 0, saturation: 0, ducking: 0, gateThresh: -100
    },

    // GoatHorn (7) - Capricorn - Earthy, dry, distorted plate
    7: {
        mix: 30, delay: 220, feedback: 45, width: 80, density: 80,
        diffusion: 90, modRate: 0.9, modDepth: 20,
        eq3Low: 2, eq3Mid: 3, eq3High: -4,
        warp: 0, saturation: 35, ducking: 0, gateThresh: -100
    },

    // NebulaCloud (8) - Large Magellanic Cloud - Diffuse, soft, ambient
    8: {
        mix: 65, delay: 900, feedback: 82, width: 100, density: 100,
        diffusion: 100, modRate: 0.3, modDepth: 40,
        eq3Low: 0, eq3Mid: 0, eq3High: -3,
        warp: 0, saturation: 0, ducking: 0, gateThresh: -100
    },

    // Triangle (9) - Triangulum - Simple, geometric, sparse echoes
    9: {
        mix: 40, delay: 450, feedback: 50, width: 100, density: 10,
        diffusion: 20, modRate: 0, modDepth: 0,
        eq3Low: 0, eq3Mid: 0, eq3High: 0,
        warp: 0, saturation: 0, ducking: 0, gateThresh: -100
    },

    // CloudMajor (10) - Cirrus Major - Bright, airy, uplifting
    10: {
        mix: 50, delay: 700, feedback: 75, width: 100, density: 90,
        diffusion: 95, modRate: 0.7, modDepth: 30,
        eq3Low: -5, eq3Mid: 0, eq3High: 6,
        warp: 0, saturation: 0, ducking: 0, gateThresh: -100
    },

    // CloudMinor (11) - Cirrus Minor - Dark, moody, mysterious
    11: {
        mix: 55, delay: 750, feedback: 78, width: 90, density: 90,
        diffusion: 95, modRate: 0.5, modDepth: 45,
        eq3Low: 3, eq3Mid: 0, eq3High: -8,
        warp: 0, saturation: 0, ducking: 0, gateThresh: -100
    },

    // QueenChair (12) - Cassiopeia - Regal, wide, rich, complex
    12: {
        mix: 60, delay: 650, feedback: 72, width: 100, density: 85,
        diffusion: 85, modRate: 1.5, modDepth: 55,
        eq3Low: 0, eq3Mid: 2, eq3High: 0,
        warp: 0, saturation: 0, ducking: 0, gateThresh: -100
    },

    // HunterBelt (13) - Orion - Focused, punchy, tight
    13: {
        mix: 35, delay: 150, feedback: 25, width: 60, density: 100,
        diffusion: 100, modRate: 0, modDepth: 0,
        eq3Low: 0, eq3Mid: 0, eq3High: 0,
        warp: 0, saturation: 0, ducking: 0, gateThresh: -30
    },

    // WaterBearer (14) - Aquarius - Liquid, fluid, flowing
    14: {
        mix: 70, delay: 500, feedback: 65, width: 100, density: 70,
        diffusion: 60, modRate: 3.0, modDepth: 85,
        eq3Low: 0, eq3Mid: 0, eq3High: 0,
        warp: 15, saturation: 0, ducking: 0, gateThresh: -100
    },

    // TwoFish (15) - Pisces - Deep, dual delay lines feel
    15: {
        mix: 50, delay: 600, feedback: 60, width: 100, density: 40,
        diffusion: 50, modRate: 0.4, modDepth: 60,
        eq3Low: 5, eq3Mid: 0, eq3High: -10,
        warp: 0, saturation: 0, ducking: 0, gateThresh: -100
    },

    // ScorpionTail (16) - Scorpio - Aggressive, stinging, intense
    16: {
        mix: 45, delay: 300, feedback: 55, width: 80, density: 80,
        diffusion: 80, modRate: 4.0, modDepth: 30,
        eq3Low: 0, eq3Mid: 0, eq3High: 5,
        warp: 0, saturation: 80, ducking: 0, gateThresh: -100
    },

    // BalanceScale (17) - Libra - Perfectly neutral, reference room
    17: {
        mix: 50, delay: 400, feedback: 50, width: 100, density: 50,
        diffusion: 50, modRate: 0.5, modDepth: 20,
        eq3Low: 0, eq3Mid: 0, eq3High: 0,
        warp: 0, saturation: 0, ducking: 0, gateThresh: -100
    },

    // LionHeart (18) - Leo - Warm, bold, mid-forward
    18: {
        mix: 55, delay: 500, feedback: 65, width: 90, density: 75,
        diffusion: 85, modRate: 0.8, modDepth: 25,
        eq3Low: 0, eq3Mid: 4, eq3High: -2,
        warp: 0, saturation: 25, ducking: 0, gateThresh: -100
    },

    // Maiden (19) - Virgo - Clean, pure, pristine
    19: {
        mix: 40, delay: 350, feedback: 45, width: 100, density: 80,
        diffusion: 90, modRate: 0.3, modDepth: 10,
        eq3Low: -2, eq3Mid: 0, eq3High: 0,
        warp: 0, saturation: 0, ducking: 0, gateThresh: -100
    },

    // SevenSisters (20) - Pleiades - Shimmering, multi-tap texture
    20: {
        mix: 60, delay: 777, feedback: 77, width: 100, density: 30,
        diffusion: 60, modRate: 2.0, modDepth: 50,
        eq3Low: 0, eq3Mid: 0, eq3High: 8,
        warp: 0, saturation: 0, ducking: 0, gateThresh: -100
    }
};

// Default parameter values
const DEFAULT_PARAMS = {
    mix: 50,
    width: 100,
    delay: 100,
    warp: 0,
    feedback: 50,
    density: 0,
    modRate: 0.5,
    modDepth: 50,
    dynFreq: 1000,
    dynQ: 1,
    dynGain: 0,
    dynDepth: 0,
    dynThresh: -20,
    ducking: 0,
    preDelaySync: 0,
    saturation: 0,
    diffusion: 100,
    gateThresh: -100,
    eq3Low: 0,
    eq3Mid: 0,
    eq3High: 0,
    msBalance: 50,
    limiterOn: true,
    bpm: 120,
    mode: 0
};

// Parameter ranges for validation
const PARAM_RANGES = {
    mix: { min: 0, max: 100 },
    width: { min: 0, max: 100 },
    delay: { min: 0, max: 1000 },
    warp: { min: 0, max: 100 },
    feedback: { min: 0, max: 100 },
    density: { min: 0, max: 100 },
    modRate: { min: 0, max: 5 },
    modDepth: { min: 0, max: 100 },
    dynFreq: { min: 20, max: 20000 },
    dynQ: { min: 0.1, max: 10 },
    dynGain: { min: -18, max: 18 },
    dynDepth: { min: -18, max: 18 },
    dynThresh: { min: -60, max: 0 },
    ducking: { min: 0, max: 100 },
    preDelaySync: { min: 0, max: 3 },
    saturation: { min: 0, max: 100 },
    diffusion: { min: 0, max: 100 },
    gateThresh: { min: -100, max: 0 },
    eq3Low: { min: -12, max: 12 },
    eq3Mid: { min: -12, max: 12 },
    eq3High: { min: -12, max: 12 },
    msBalance: { min: 0, max: 100 },
    bpm: { min: 20, max: 300 },
    mode: { min: 0, max: 20 }
};

export class FDNRNode {
    constructor(ctx) {
        this.ctx = ctx;
        this.workletNode = null;
        this.isLoaded = false;

        // Input/output nodes for connection
        this.inputGain = ctx.createGain();
        this.outputGain = ctx.createGain();

        // All parameters with their current values
        this.params = { ...DEFAULT_PARAMS };

        // Current mode
        this.currentMode = 0;

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
            await this.ctx.audioWorklet.addModule(new URL('/worklets/fdnr-processor.js', import.meta.url).href);

            // Create the worklet node
            this.workletNode = new AudioWorkletNode(this.ctx, 'fdnr-processor', {
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
            console.error('FDNRNode: Failed to initialize:', error);
            throw error;
        }
    }

    // Sync all parameters to the worklet
    _syncAllParams() {
        if (!this.workletNode) return;

        // Set all AudioParam values
        for (const [name, value] of Object.entries(this.params)) {
            this._setAudioParam(name, value);
        }
    }

    // Set an AudioParam on the worklet
    _setAudioParam(name, value) {
        if (!this.workletNode) return;

        const param = this.workletNode.parameters.get(name);
        if (param) {
            // Handle boolean conversion
            if (name === 'limiterOn') {
                param.setValueAtTime(value ? 1 : 0, this.ctx.currentTime);
            } else {
                param.setValueAtTime(value, this.ctx.currentTime);
            }
        }
    }

    // Send a message to the worklet
    _sendMessage(message) {
        this.workletNode?.port.postMessage(message);
    }

    // Handle messages from the worklet
    _handleMessage(data) {
        switch (data.type) {
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
            console.warn(`FDNRNode: Unknown param "${name}"`);
            return;
        }

        // Validate and clamp
        const range = PARAM_RANGES[name];
        if (range) {
            value = Math.max(range.min, Math.min(range.max, value));
        }

        // Handle boolean
        if (name === 'limiterOn') {
            value = !!value;
        }

        this.params[name] = value;
        this._setAudioParam(name, value);

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

    // === MODE/PRESET MANAGEMENT ===

    // Reset modifiers to clean state (from C++ resetModifiers)
    _resetModifiers() {
        this.setParam('warp', 0);
        this.setParam('saturation', 0);
        this.setParam('ducking', 0);
        this.setParam('gateThresh', -100);
        this.setParam('dynFreq', 1000);
        this.setParam('dynGain', 0);
    }

    // Set mode by index
    setMode(modeIndex) {
        const preset = MODE_PRESETS[modeIndex];
        if (!preset) {
            console.warn(`FDNRNode: Invalid mode index ${modeIndex}`);
            return;
        }

        // Reset modifiers first (as per C++ code)
        this._resetModifiers();

        // Apply preset parameters
        for (const [name, value] of Object.entries(preset)) {
            this.setParam(name, value);
        }

        this.currentMode = modeIndex;
        this.setParam('mode', modeIndex);

        if (this.onParamChange) {
            this.onParamChange('mode', modeIndex);
        }
    }

    // Set mode by name
    setModeByName(modeName) {
        const modeIndex = FDNR_MODES[modeName];
        if (modeIndex !== undefined) {
            this.setMode(modeIndex);
        } else {
            console.warn(`FDNRNode: Unknown mode name "${modeName}"`);
        }
    }

    getMode() {
        return this.currentMode;
    }

    getModeName() {
        return MODE_NAMES[this.currentMode];
    }

    // === CLOCK SYNC ===

    syncToClock(clockSystem) {
        this.clockSource = clockSystem;
        this.setBPM(clockSystem.bpm);
    }

    setBPM(bpm) {
        this.clockBPM = Math.max(20, Math.min(300, bpm));
        this.setParam('bpm', this.clockBPM);
    }

    getBPM() {
        return this.clockBPM;
    }

    // Set pre-delay sync mode
    setPreDelaySync(mode) {
        // 0 = Free, 1 = 1/4, 2 = 1/8, 3 = 1/16
        this.setParam('preDelaySync', Math.max(0, Math.min(3, Math.round(mode))));
    }

    // === SPECIAL CONTROLS ===

    // Reset all parameters to defaults
    resetAllParameters() {
        for (const [name, value] of Object.entries(DEFAULT_PARAMS)) {
            this.setParam(name, value);
        }
    }

    // Clear reverb buffers
    purge() {
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
            mode: this.currentMode
        };
    }

    // Load preset
    loadPreset(preset) {
        if (preset.mode !== undefined) {
            this.setMode(preset.mode);
        }
        if (preset.params) {
            this.setParams(preset.params);
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

// Sync options for reference
export const SYNC_OPTIONS = [
    { id: 0, name: 'Free', description: 'Manual delay time' },
    { id: 1, name: '1/4', description: 'Quarter note' },
    { id: 2, name: '1/8', description: 'Eighth note' },
    { id: 3, name: '1/16', description: 'Sixteenth note' }
];

// Factory function
export function createFDNRNode(ctx) {
    return new FDNRNode(ctx);
}
