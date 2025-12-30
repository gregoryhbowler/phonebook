// ============================================================================
// MODULATION SHAPES
// LFO and complex envelope generators inspired by Zadar
// All shapes are free-running (cycling), 0.01Hz to 100Hz
// ============================================================================

/**
 * Shape categories:
 * - Basic LFO: sine, triangle, square, sawUp, sawDown, sampleHold
 * - Complex (Zadar-inspired): Various morphing, stepped, and organic shapes
 */

// Basic wave shape generators (phase 0-1 input, -1 to +1 output)
const BASIC_SHAPES = {
  sine: (phase) => Math.sin(phase * Math.PI * 2),

  triangle: (phase) => {
    return phase < 0.5 ? (phase * 4 - 1) : (3 - phase * 4);
  },

  square: (phase) => phase < 0.5 ? 1 : -1,

  sawUp: (phase) => phase * 2 - 1,

  sawDown: (phase) => 1 - phase * 2,

  sampleHold: (phase, generator) => {
    // Sample & hold needs state tracking - handled in LFOGenerator
    return generator._sampleHoldValue || 0;
  }
};

// Complex shapes inspired by Zadar banks
// Each returns -1 to +1 based on phase 0-1
const COMPLEX_SHAPES = {
  // Bank A style - smooth exponential curves
  expDecay: (phase) => {
    // Fast attack, exponential decay
    if (phase < 0.02) return phase / 0.02 * 2 - 1;
    return Math.exp(-(phase - 0.02) * 5) * 2 - 1;
  },

  // Bank B style - multiple peaks
  doubleBump: (phase) => {
    // Two smooth peaks
    const p1 = Math.sin(phase * Math.PI * 2);
    const p2 = Math.sin(phase * Math.PI * 4) * 0.5;
    return (p1 + p2) / 1.5;
  },

  // Bank C style - smooth morphing humps
  smoothHump: (phase) => {
    // Raised cosine window style
    return (1 - Math.cos(phase * Math.PI * 2)) / 2 * 2 - 1;
  },

  // Bank D style - asymmetric attack/decay
  sharpAttack: (phase) => {
    // Very fast attack, slow decay
    if (phase < 0.05) return (phase / 0.05) * 2 - 1;
    return (1 - ((phase - 0.05) / 0.95)) * 2 - 1;
  },

  // Bank E style - wobbly organic
  wobbly: (phase) => {
    return Math.sin(phase * Math.PI * 2) * (1 + Math.sin(phase * Math.PI * 7) * 0.3);
  },

  // Bank F style - stepped decay
  steppedDecay: (phase) => {
    const steps = 8;
    const stepped = Math.floor(phase * steps) / steps;
    return (1 - stepped) * 2 - 1;
  },

  // Bank G style - noise-like random walk
  randomWalk: (phase, generator) => {
    // Smooth random walk
    if (!generator._randomWalkState) {
      generator._randomWalkState = { target: 0, current: 0 };
    }
    const state = generator._randomWalkState;

    // Change target occasionally
    if (Math.random() < 0.02) {
      state.target = Math.random() * 2 - 1;
    }

    // Smooth towards target
    state.current += (state.target - state.current) * 0.1;
    return state.current;
  },

  // Bank H style - triangle with harmonics
  richTriangle: (phase) => {
    let v = 0;
    v += BASIC_SHAPES.triangle(phase);
    v += BASIC_SHAPES.triangle((phase * 3) % 1) * 0.33;
    v += BASIC_SHAPES.triangle((phase * 5) % 1) * 0.2;
    return v / 1.53;
  },

  // Bank I style - PWM-like
  pwmStyle: (phase, generator) => {
    const pw = 0.3 + Math.sin(phase * 0.2) * 0.2; // Modulating pulse width
    return phase < pw ? 1 : -1;
  },

  // Bank J style - bouncing decay
  bounce: (phase) => {
    // Bouncing ball effect
    const bounces = 4;
    const decay = Math.exp(-phase * 3);
    const freq = 1 + phase * bounces;
    return Math.abs(Math.sin(phase * freq * Math.PI * 2)) * decay * 2 - 1;
  },

  // Bank K style - staircase up
  staircaseUp: (phase) => {
    const steps = 6;
    return (Math.floor(phase * steps) / (steps - 1)) * 2 - 1;
  },

  // Bank L style - binary/digital pattern
  binaryPattern: (phase) => {
    // 8-bit pattern
    const pattern = [1, 0, 1, 1, 0, 1, 0, 0];
    const idx = Math.floor(phase * pattern.length) % pattern.length;
    return pattern[idx] * 2 - 1;
  },

  // Bank M style - morphing sine
  morphingSine: (phase) => {
    // Sine that morphs between shapes
    const morph = Math.sin(phase * Math.PI * 0.5);
    const sine = Math.sin(phase * Math.PI * 2);
    const square = phase < 0.5 ? 1 : -1;
    return sine * (1 - Math.abs(morph)) + square * Math.abs(morph);
  },

  // Bank N style - slow attack swell
  swell: (phase) => {
    // Exponential attack, instant release
    return (1 - Math.exp(-phase * 5)) * 2 - 1;
  },

  // Bank O style - chaotic
  chaotic: (phase, generator) => {
    // Lorenz-inspired chaotic motion
    if (!generator._chaoticState) {
      generator._chaoticState = { x: 0.1, y: 0, z: 0 };
    }
    const s = generator._chaoticState;
    const dt = 0.01;
    const sigma = 10, rho = 28, beta = 8/3;

    const dx = sigma * (s.y - s.x) * dt;
    const dy = (s.x * (rho - s.z) - s.y) * dt;
    const dz = (s.x * s.y - beta * s.z) * dt;

    s.x += dx; s.y += dy; s.z += dz;

    // Normalize to -1 to 1
    return Math.tanh(s.x * 0.1);
  },

  // Bank P style - plateau
  plateau: (phase) => {
    // Attack, hold at top, decay
    if (phase < 0.1) return (phase / 0.1) * 2 - 1;
    if (phase < 0.6) return 1;
    return (1 - (phase - 0.6) / 0.4) * 2 - 1;
  },

  // Bank Q style - tremolo bursts
  tremoloBurst: (phase) => {
    // Fast tremolo that fades
    const fade = 1 - phase;
    const tremolo = Math.sin(phase * Math.PI * 20);
    return tremolo * fade;
  },

  // Bank R style - hard gate sequence
  gateSequence: (phase) => {
    // 4 gates of different lengths
    const gates = [0.1, 0.15, 0.1, 0.2];
    const positions = [0, 0.25, 0.5, 0.75];

    for (let i = 0; i < gates.length; i++) {
      const start = positions[i];
      const end = start + gates[i];
      if (phase >= start && phase < end) return 1;
    }
    return -1;
  },

  // Bank S style - glitchy
  glitchy: (phase, generator) => {
    // Random glitches
    if (Math.random() < 0.05) {
      generator._glitchValue = Math.random() * 2 - 1;
    }
    const base = Math.sin(phase * Math.PI * 2);
    return base * 0.7 + (generator._glitchValue || 0) * 0.3;
  },

  // Bank T style - slow morph envelope
  slowMorph: (phase) => {
    // Very smooth, organic envelope
    const a = Math.sin(phase * Math.PI);
    const b = Math.pow(a, 2);
    return b * 2 - 1;
  },

  // Bank U style - percussive
  percussive: (phase) => {
    // Sharp attack, multi-stage decay
    if (phase < 0.01) return phase / 0.01 * 2 - 1;
    const decay1 = Math.exp(-(phase - 0.01) * 10);
    const decay2 = Math.exp(-(phase - 0.01) * 2) * 0.3;
    return (decay1 + decay2) / 1.3 * 2 - 1;
  },

  // Bank V style - wave folding
  foldedSine: (phase) => {
    // Sine run through wavefolder-like process
    let v = Math.sin(phase * Math.PI * 2) * 2;
    // Fold
    while (Math.abs(v) > 1) {
      if (v > 1) v = 2 - v;
      if (v < -1) v = -2 - v;
    }
    return v;
  },

  // Bank W style - asymmetric oscillation
  asymOsc: (phase) => {
    // Different shapes for up/down
    if (phase < 0.3) {
      return (phase / 0.3) * 2 - 1;
    } else {
      return 1 - ((phase - 0.3) / 0.7) * 2;
    }
  },

  // Bank X - Shackleton inspired - dark, evolving
  darkEvolving: (phase, generator) => {
    const base = Math.sin(phase * Math.PI * 2);
    const mod = Math.sin(phase * Math.PI * 3.7) * 0.5;
    const noise = (Math.random() - 0.5) * 0.1;
    return Math.tanh((base + mod + noise) * 1.5);
  },

  // Bank Y - Scanner inspired - stepped/quantized
  quantized: (phase) => {
    const sine = Math.sin(phase * Math.PI * 2);
    const steps = 12;
    return Math.round(sine * steps) / steps;
  },

  // Bank Z - Richard Devine inspired - complex digital
  complexDigital: (phase, generator) => {
    // Multiple overlapping patterns
    const p1 = phase < 0.5 ? 1 : -1;
    const p2 = Math.sin(phase * Math.PI * 8);
    const p3 = BASIC_SHAPES.triangle((phase * 3) % 1);
    const mix = Math.sin(phase * Math.PI) * 0.5 + 0.5;
    return (p1 * mix + p2 * (1-mix) * 0.5 + p3 * 0.3) / 1.3;
  }
};

// All available shapes
const ALL_SHAPES = {
  ...BASIC_SHAPES,
  ...COMPLEX_SHAPES
};

// Shape categories for UI
const SHAPE_CATEGORIES = {
  'Basic LFO': ['sine', 'triangle', 'square', 'sawUp', 'sawDown', 'sampleHold'],
  'Smooth': ['smoothHump', 'swell', 'slowMorph', 'expDecay'],
  'Percussive': ['sharpAttack', 'bounce', 'percussive', 'plateau'],
  'Stepped': ['steppedDecay', 'staircaseUp', 'binaryPattern', 'gateSequence', 'quantized'],
  'Complex': ['doubleBump', 'wobbly', 'richTriangle', 'morphingSine', 'foldedSine', 'asymOsc'],
  'Chaotic': ['randomWalk', 'chaotic', 'glitchy', 'tremoloBurst'],
  'Digital': ['pwmStyle', 'darkEvolving', 'complexDigital']
};

/**
 * LFO Generator class
 */
class LFOGenerator {
  constructor() {
    this.phase = 0;
    this.rate = 1;         // Hz (0.01 to 100)
    this.shape = 'sine';
    this.polarity = 'bipolar'; // 'bipolar' (-1 to 1) or 'unipolar' (0 to 1)
    this.smoothing = 0;    // 0-1, one-pole lowpass amount
    this.phaseOffset = 0;  // 0-1, starting phase offset

    this.lastValue = 0;
    this._sampleHoldValue = 0;
    this._lastPhase = 0;
  }

  /**
   * Reset phase
   */
  reset() {
    this.phase = this.phaseOffset;
    this.lastValue = 0;
  }

  /**
   * Advance and get value
   * @param {number} dt - Delta time in seconds
   * @returns {number} Current value (-1 to 1 or 0 to 1 depending on polarity)
   */
  tick(dt) {
    // Advance phase
    this.phase += this.rate * dt;

    // Handle phase wrap
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);

      // Sample & hold: sample new value on phase wrap
      if (this.shape === 'sampleHold') {
        this._sampleHoldValue = Math.random() * 2 - 1;
      }
    }

    // Get shape value
    const shapeFunc = ALL_SHAPES[this.shape];
    let value = shapeFunc ? shapeFunc(this.phase, this) : 0;

    // Apply smoothing (one-pole lowpass)
    if (this.smoothing > 0) {
      const coeff = Math.exp(-dt * (1 - this.smoothing) * 100);
      value = this.lastValue * coeff + value * (1 - coeff);
    }

    this.lastValue = value;
    this._lastPhase = this.phase;

    // Apply polarity
    if (this.polarity === 'unipolar') {
      return (value + 1) / 2;
    }

    return value;
  }

  /**
   * Get current value without advancing
   */
  getValue() {
    return this.polarity === 'unipolar' ? (this.lastValue + 1) / 2 : this.lastValue;
  }

  /**
   * Set parameters
   */
  setRate(hz) {
    this.rate = Math.max(0.01, Math.min(100, hz));
  }

  setShape(shape) {
    if (ALL_SHAPES[shape]) {
      this.shape = shape;
    }
  }

  setPolarity(polarity) {
    this.polarity = polarity === 'unipolar' ? 'unipolar' : 'bipolar';
  }

  setSmoothing(amount) {
    this.smoothing = Math.max(0, Math.min(1, amount));
  }

  setPhaseOffset(offset) {
    this.phaseOffset = offset % 1;
  }

  /**
   * Get all available shapes
   */
  static getShapes() {
    return Object.keys(ALL_SHAPES);
  }

  /**
   * Get shapes by category
   */
  static getShapeCategories() {
    return SHAPE_CATEGORIES;
  }
}

// Export
if (typeof window !== 'undefined') {
  window.LFOGenerator = LFOGenerator;
  window.MOD_SHAPES = ALL_SHAPES;
  window.MOD_SHAPE_CATEGORIES = SHAPE_CATEGORIES;
}

export { LFOGenerator, ALL_SHAPES, SHAPE_CATEGORIES };
