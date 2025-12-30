// ============================================================================
// PEDALBOARD EFFECTS LIBRARY
// Web Audio DSP implementations of the Pedalboard effect collection
// Translated from SuperCollider to JavaScript AudioWorklet
// ============================================================================

const PedalboardEffectsCode = `
// ============================================================================
// UTILITY CLASSES
// ============================================================================

// --- Parameter Mapping Functions ---
function linlin(x, inMin, inMax, outMin, outMax) {
  return outMin + (x - inMin) * (outMax - outMin) / (inMax - inMin);
}

function linexp(x, inMin, inMax, outMin, outMax) {
  if (x <= inMin) return outMin;
  if (x >= inMax) return outMax;
  return outMin * Math.pow(outMax / outMin, (x - inMin) / (inMax - inMin));
}

function explin(x, inMin, inMax, outMin, outMax) {
  if (x <= inMin) return outMin;
  if (x >= inMax) return outMax;
  return outMin + (Math.log(x / inMin) / Math.log(inMax / inMin)) * (outMax - outMin);
}

// --- Clipping/Saturation Functions ---
function softclip(x) {
  const absX = Math.abs(x);
  if (absX <= 0.5) return x;
  return Math.sign(x) * (absX - 0.25) / absX;
}

function distort(x) {
  return x / (1 + Math.abs(x));
}

// --- Delay Line ---
class DelayLine {
  constructor(maxSamples) {
    this.buffer = new Float32Array(Math.ceil(maxSamples));
    this.writeIdx = 0;
    this.length = this.buffer.length;
  }

  write(sample) {
    this.buffer[this.writeIdx] = sample;
    this.writeIdx = (this.writeIdx + 1) % this.length;
  }

  read(delaySamples) {
    const readIdx = (this.writeIdx - Math.floor(delaySamples) + this.length) % this.length;
    return this.buffer[readIdx];
  }

  readLinear(delaySamples) {
    const delay = Math.max(0, Math.min(delaySamples, this.length - 1));
    const readPos = this.writeIdx - delay;
    const idx0 = Math.floor(readPos);
    const frac = readPos - idx0;
    const i0 = ((idx0 % this.length) + this.length) % this.length;
    const i1 = ((idx0 + 1) % this.length + this.length) % this.length;
    return this.buffer[i0] * (1 - frac) + this.buffer[i1] * frac;
  }

  readCubic(delaySamples) {
    const delay = Math.max(1, Math.min(delaySamples, this.length - 2));
    const readPos = this.writeIdx - delay;
    const idx = Math.floor(readPos);
    const frac = readPos - idx;

    const getIdx = (i) => ((i % this.length) + this.length) % this.length;
    const y0 = this.buffer[getIdx(idx - 1)];
    const y1 = this.buffer[getIdx(idx)];
    const y2 = this.buffer[getIdx(idx + 1)];
    const y3 = this.buffer[getIdx(idx + 2)];

    const c0 = y1;
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);

    return ((c3 * frac + c2) * frac + c1) * frac + c0;
  }

  clear() {
    this.buffer.fill(0);
    this.writeIdx = 0;
  }
}

// --- Biquad Filter ---
class Biquad {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
    this.z1 = 0; this.z2 = 0;
  }

  setLowpass(freq, q, sampleRate) {
    const w0 = 2 * Math.PI * Math.min(freq, sampleRate * 0.49) / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = ((1 - cosW0) / 2) / a0;
    this.b1 = (1 - cosW0) / a0;
    this.b2 = ((1 - cosW0) / 2) / a0;
    this.a1 = (-2 * cosW0) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  setHighpass(freq, q, sampleRate) {
    const w0 = 2 * Math.PI * Math.min(freq, sampleRate * 0.49) / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = ((1 + cosW0) / 2) / a0;
    this.b1 = (-(1 + cosW0)) / a0;
    this.b2 = ((1 + cosW0) / 2) / a0;
    this.a1 = (-2 * cosW0) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  setBandpass(freq, q, sampleRate) {
    const w0 = 2 * Math.PI * Math.min(freq, sampleRate * 0.49) / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b1 = 0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * cosW0) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  setNotch(freq, q, sampleRate) {
    const w0 = 2 * Math.PI * Math.min(freq, sampleRate * 0.49) / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = 1 / a0;
    this.b1 = (-2 * cosW0) / a0;
    this.b2 = 1 / a0;
    this.a1 = (-2 * cosW0) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  setPeaking(freq, q, dbGain, sampleRate) {
    // Safety: ensure valid Q and gain
    q = Math.max(0.1, q);
    dbGain = Math.max(-60, Math.min(60, dbGain || 0));
    freq = Math.max(20, Math.min(freq, sampleRate * 0.49));

    const A = Math.pow(10, dbGain / 40);
    const w0 = 2 * Math.PI * freq / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * q);

    // Safety: prevent division by zero
    const a0 = 1 + alpha / Math.max(0.0001, A);
    if (a0 === 0) { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; return; }

    this.b0 = (1 + alpha * A) / a0;
    this.b1 = (-2 * cosW0) / a0;
    this.b2 = (1 - alpha * A) / a0;
    this.a1 = (-2 * cosW0) / a0;
    this.a2 = (1 - alpha / Math.max(0.0001, A)) / a0;

    // Validate coefficients
    if (!isFinite(this.b0)) this.b0 = 1;
    if (!isFinite(this.b1)) this.b1 = 0;
    if (!isFinite(this.b2)) this.b2 = 0;
    if (!isFinite(this.a1)) this.a1 = 0;
    if (!isFinite(this.a2)) this.a2 = 0;
  }

  // Alias for setPeaking
  setPeakEQ(freq, q, dbGain, sampleRate) {
    this.setPeaking(freq, q, dbGain, sampleRate);
  }

  setLowShelf(freq, dbGain, sampleRate) {
    // Safety: ensure valid parameters
    dbGain = Math.max(-60, Math.min(60, dbGain || 0));
    freq = Math.max(20, Math.min(freq, sampleRate * 0.49));

    const A = Math.pow(10, dbGain / 40);
    const w0 = 2 * Math.PI * freq / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / 2 * Math.sqrt(2);
    const sqrtA = Math.sqrt(Math.max(0.0001, A));

    const a0 = (A + 1) + (A - 1) * cosW0 + 2 * sqrtA * alpha;
    if (a0 === 0) { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; return; }

    this.b0 = (A * ((A + 1) - (A - 1) * cosW0 + 2 * sqrtA * alpha)) / a0;
    this.b1 = (2 * A * ((A - 1) - (A + 1) * cosW0)) / a0;
    this.b2 = (A * ((A + 1) - (A - 1) * cosW0 - 2 * sqrtA * alpha)) / a0;
    this.a1 = (-2 * ((A - 1) + (A + 1) * cosW0)) / a0;
    this.a2 = ((A + 1) + (A - 1) * cosW0 - 2 * sqrtA * alpha) / a0;

    // Validate coefficients
    if (!isFinite(this.b0)) this.b0 = 1;
    if (!isFinite(this.b1)) this.b1 = 0;
    if (!isFinite(this.b2)) this.b2 = 0;
    if (!isFinite(this.a1)) this.a1 = 0;
    if (!isFinite(this.a2)) this.a2 = 0;
  }

  setHighShelf(freq, dbGain, sampleRate) {
    // Safety: ensure valid parameters
    dbGain = Math.max(-60, Math.min(60, dbGain || 0));
    freq = Math.max(20, Math.min(freq, sampleRate * 0.49));

    const A = Math.pow(10, dbGain / 40);
    const w0 = 2 * Math.PI * freq / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / 2 * Math.sqrt(2);
    const sqrtA = Math.sqrt(Math.max(0.0001, A));

    const a0 = (A + 1) - (A - 1) * cosW0 + 2 * sqrtA * alpha;
    if (a0 === 0) { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; return; }

    this.b0 = (A * ((A + 1) + (A - 1) * cosW0 + 2 * sqrtA * alpha)) / a0;
    this.b1 = (-2 * A * ((A - 1) + (A + 1) * cosW0)) / a0;
    this.b2 = (A * ((A + 1) + (A - 1) * cosW0 - 2 * sqrtA * alpha)) / a0;
    this.a1 = (2 * ((A - 1) - (A + 1) * cosW0)) / a0;
    this.a2 = ((A + 1) - (A - 1) * cosW0 - 2 * sqrtA * alpha) / a0;

    // Validate coefficients
    if (!isFinite(this.b0)) this.b0 = 1;
    if (!isFinite(this.b1)) this.b1 = 0;
    if (!isFinite(this.b2)) this.b2 = 0;
    if (!isFinite(this.a1)) this.a1 = 0;
    if (!isFinite(this.a2)) this.a2 = 0;
  }

  process(input) {
    // Safety check input
    if (!isFinite(input)) input = 0;

    const output = this.b0 * input + this.z1;
    this.z1 = this.b1 * input - this.a1 * output + this.z2;
    this.z2 = this.b2 * input - this.a2 * output;

    // Safety check state
    if (!isFinite(this.z1)) this.z1 = 0;
    if (!isFinite(this.z2)) this.z2 = 0;

    return isFinite(output) ? output : input;
  }

  reset() {
    this.z1 = 0;
    this.z2 = 0;
  }
}

// --- One-Pole Filter (simple lowpass/highpass) ---
class OnePole {
  constructor() {
    this.z1 = 0;
    this.coef = 0.5;
  }

  setLowpass(freq, sampleRate) {
    this.coef = Math.exp(-2 * Math.PI * freq / sampleRate);
  }

  setHighpass(freq, sampleRate) {
    this.coef = Math.exp(-2 * Math.PI * freq / sampleRate);
  }

  processLowpass(input) {
    this.z1 = input * (1 - this.coef) + this.z1 * this.coef;
    return this.z1;
  }

  processHighpass(input) {
    const lp = input * (1 - this.coef) + this.z1 * this.coef;
    this.z1 = lp;
    return input - lp;
  }

  reset() {
    this.z1 = 0;
  }
}

// --- Allpass Filter ---
class AllpassFilter {
  constructor(maxDelay) {
    this.delay = new DelayLine(maxDelay);
    this.delaySamples = maxDelay;
    this.feedback = 0.5;
  }

  setDelay(samples) {
    this.delaySamples = Math.min(samples, this.delay.length - 1);
  }

  setFeedback(fb) {
    this.feedback = fb;
  }

  process(input, delaySamples, feedback) {
    // Support both 1-arg and 3-arg signatures
    const delay = (delaySamples !== undefined) ? delaySamples : this.delaySamples;
    const fb = (feedback !== undefined) ? feedback : this.feedback;
    const delayed = this.delay.readLinear(delay);
    const output = -input + delayed;
    this.delay.write(input + delayed * fb);
    return output;
  }

  clear() {
    this.delay.clear();
  }

  reset() {
    this.delay.clear();
  }
}

// --- Moog Ladder Filter (4-pole) ---
// Simplified Stilson/Smith implementation - reliable and stable
class MoogLadder {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.y = [0, 0, 0, 0]; // filter stages
    this.oldY = [0, 0, 0, 0]; // previous outputs for trapezoidal integration
    this.cutoff = 1000;
    this.targetCutoff = 1000;
    this.resonance = 0;
  }

  setCutoff(freq) {
    this.targetCutoff = Math.max(20, Math.min(freq, this.sampleRate * 0.45));
  }

  setResonance(res) {
    this.resonance = Math.max(0, Math.min(res, 0.95));
  }

  process(input) {
    // Smooth cutoff changes
    this.cutoff += (this.targetCutoff - this.cutoff) * 0.01;

    // Normalized frequency (0 to 1, clamped for stability)
    const fc = Math.min(this.cutoff / this.sampleRate, 0.45);

    // Filter coefficient - simple and stable
    const f = fc * 1.16;
    const fb = this.resonance * (1.0 - 0.15 * f * f);

    // Input with feedback
    let x = input - fb * this.y[3];

    // Prevent NaN/Infinity
    if (!isFinite(x)) x = 0;

    // Soft clip to prevent blowup
    x = Math.tanh(x * 0.5) * 2;

    // 4 cascaded one-pole sections
    // Using simple one-pole: y = y + f * (x - y)
    const f2 = f * f;
    const fComp = 1 - f; // Compensation

    this.y[0] = this.y[0] + f * (x - this.y[0]);
    this.y[1] = this.y[1] + f * (this.y[0] - this.y[1]);
    this.y[2] = this.y[2] + f * (this.y[1] - this.y[2]);
    this.y[3] = this.y[3] + f * (this.y[2] - this.y[3]);

    // Clamp output to prevent runaway
    const out = Math.max(-4, Math.min(4, this.y[3]));

    return out;
  }

  reset() {
    this.y = [0, 0, 0, 0];
    this.oldY = [0, 0, 0, 0];
    this.cutoff = this.targetCutoff;
  }
}

// --- DC Blocker ---
class DCBlocker {
  constructor() {
    this.x1 = 0;
    this.y1 = 0;
    this.coef = 0.995;
  }

  process(input) {
    const output = input - this.x1 + this.coef * this.y1;
    this.x1 = input;
    this.y1 = output;
    return output;
  }

  reset() {
    this.x1 = 0;
    this.y1 = 0;
  }
}

// --- Envelope Follower ---
class EnvelopeFollower {
  constructor(sampleRate, attackTime = 0.001, releaseTime = 0.1) {
    this.sampleRate = sampleRate;
    this.value = 0;
    // Convert time to coefficients
    // SC's EnvFollow uses a single coefficient approach
    // attackCoef: how quickly we rise (smaller = faster attack)
    // releaseCoef: how quickly we fall (larger = slower release)
    this.attackCoef = Math.exp(-1 / (attackTime * sampleRate));
    this.releaseCoef = Math.exp(-1 / (releaseTime * sampleRate));
  }

  process(input) {
    const absIn = Math.abs(input);
    if (absIn > this.value) {
      // Attack: quickly follow rising signal
      this.value = absIn + (this.value - absIn) * this.attackCoef;
    } else {
      // Release: slowly decay
      this.value = absIn + (this.value - absIn) * this.releaseCoef;
    }
    return this.value;
  }

  reset() {
    this.value = 0;
  }
}

// --- LFO ---
class LFO {
  constructor() {
    this.phase = 0;
  }

  process(freq, waveform, sampleRate) {
    this.phase += freq / sampleRate;
    if (this.phase >= 1) this.phase -= 1;

    switch (waveform) {
      case 'sine':
        return Math.sin(this.phase * 2 * Math.PI);
      case 'triangle':
        return this.phase < 0.5 ? 4 * this.phase - 1 : 3 - 4 * this.phase;
      case 'saw':
        return 2 * this.phase - 1;
      case 'square':
        return this.phase < 0.5 ? 1 : -1;
      case 'parabolic':
        // LFPar approximation
        const p = this.phase * 2 - 1;
        return 1 - p * p;
      default:
        return Math.sin(this.phase * 2 * Math.PI);
    }
  }

  reset() {
    this.phase = 0;
  }
}

// --- Compressor ---
class Compressor {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.envelope = 0;
    this.threshold = 0.5;
    this.ratio = 4;
    this.attack = 0.005;
    this.release = 0.1;
    this.makeupGain = 1;
  }

  setParams(threshold, ratio, attackMs, releaseMs, makeupGain) {
    this.threshold = threshold;
    this.ratio = ratio;
    this.attack = 1 - Math.exp(-1 / (attackMs * this.sampleRate / 1000));
    this.release = 1 - Math.exp(-1 / (releaseMs * this.sampleRate / 1000));
    this.makeupGain = makeupGain;
  }

  process(input) {
    const absIn = Math.abs(input);

    // Envelope detection
    if (absIn > this.envelope) {
      this.envelope += this.attack * (absIn - this.envelope);
    } else {
      this.envelope += this.release * (absIn - this.envelope);
    }

    // Gain computation
    let gain = 1;
    if (this.envelope > this.threshold) {
      const overDb = 20 * Math.log10(this.envelope / this.threshold);
      const compressedDb = overDb / this.ratio;
      gain = Math.pow(10, (compressedDb - overDb) / 20);
    }

    return input * gain * this.makeupGain;
  }

  reset() {
    this.envelope = 0;
  }
}

// --- Decimator (bit/sample rate crusher) ---
class Decimator {
  constructor() {
    this.phaseL = 0;
    this.phaseR = 0;
    this.lastSampleL = 0;
    this.lastSampleR = 0;
    this.bits = 16;
    this.rate = 1; // ratio of target to sample rate
  }

  setBits(bits) {
    this.bits = Math.max(1, Math.min(24, bits));
  }

  setRate(rate) {
    this.rate = Math.max(0.001, Math.min(1, rate));
  }

  process(inputL, inputR) {
    // Advance phase for left channel
    this.phaseL += this.rate;
    if (this.phaseL >= 1) {
      this.phaseL -= Math.floor(this.phaseL);
      // Bit reduction
      const scale = Math.pow(2, this.bits - 1);
      if (scale > 0 && isFinite(scale)) {
        this.lastSampleL = Math.round(inputL * scale) / scale;
      } else {
        this.lastSampleL = inputL;
      }
    }

    // Advance phase for right channel
    this.phaseR += this.rate;
    if (this.phaseR >= 1) {
      this.phaseR -= Math.floor(this.phaseR);
      const scale = Math.pow(2, this.bits - 1);
      if (scale > 0 && isFinite(scale)) {
        this.lastSampleR = Math.round(inputR * scale) / scale;
      } else {
        this.lastSampleR = inputR;
      }
    }

    // Safety checks
    if (!isFinite(this.lastSampleL)) this.lastSampleL = 0;
    if (!isFinite(this.lastSampleR)) this.lastSampleR = 0;

    return [this.lastSampleL, this.lastSampleR];
  }

  reset() {
    this.phaseL = 0;
    this.phaseR = 0;
    this.lastSampleL = 0;
    this.lastSampleR = 0;
  }
}

// --- Wavefolder ---
// Based on SmoothFoldS from SuperCollider miSCellaneous library
function wavefold(input, lo, hi) {
  if (!isFinite(input)) return 0;
  const range = hi - lo;
  if (range <= 0) return Math.max(lo, Math.min(hi, input));

  let x = input;
  let iterations = 0;
  const maxIterations = 20; // Safety limit

  while ((x > hi || x < lo) && iterations < maxIterations) {
    if (x > hi) x = 2 * hi - x;
    if (x < lo) x = 2 * lo - x;
    iterations++;
  }

  // Clamp if we hit iteration limit
  return Math.max(lo, Math.min(hi, x));
}

// Smooth wave folding with sine-smoothed corners (matches SmoothFoldS)
function smoothFoldS(input, lo, hi, foldRange, smoothAmount) {
  if (!isFinite(input)) return 0;

  const range = hi - lo;
  if (range <= 0) return 0;

  // Determine which case: 0=in range, 1=below lo, 2=above hi
  let result;
  if (input >= lo && input <= hi) {
    // In range - apply smooth clipping
    result = smoothClipS(input, lo, hi, smoothAmount);
  } else if (input < lo) {
    // Below range - fold in lower region
    const foldRangeAbs = range * foldRange;
    const thr1 = lo + foldRangeAbs;
    const folded = wavefold(input, lo, thr1);
    result = smoothClipS(folded, lo, thr1, smoothAmount);
  } else {
    // Above range - fold in upper region
    const foldRangeAbs = range * foldRange;
    const thr2 = hi - foldRangeAbs;
    const folded = wavefold(input, thr2, hi);
    result = smoothClipS(folded, thr2, hi, smoothAmount);
  }

  return isFinite(result) ? result : 0;
}

// Smooth clipping with sine corners (matches SmoothClipS)
function smoothClipS(input, lo, hi, smoothAmount) {
  if (!isFinite(input)) return 0;
  if (input <= lo) return lo;
  if (input >= hi) return hi;

  const range = hi - lo;
  const mid = (lo + hi) / 2;
  const normalized = (input - lo) / range; // 0 to 1

  // Apply sine smoothing near edges
  const edge = smoothAmount * 0.5;
  let result;

  if (normalized < edge && edge > 0) {
    // Near lower edge
    const t = normalized / edge;
    result = lo + edge * range * (1 - Math.cos(t * Math.PI / 2));
  } else if (normalized > 1 - edge && edge > 0) {
    // Near upper edge
    const t = (1 - normalized) / edge;
    result = hi - edge * range * (1 - Math.cos(t * Math.PI / 2));
  } else {
    result = input;
  }

  return Math.max(lo, Math.min(hi, result));
}


// ============================================================================
// EFFECT CLASSES
// ============================================================================

// --- Base Effect Class ---
class Effect {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.bypassed = false;
    this.mix = 1;
    this.inGain = 1;
    this.outGain = 1;
  }

  setParam(name, value) {
    if (this[name] !== undefined) {
      this[name] = value;
    }
  }

  processStereo(inL, inR) {
    if (this.bypassed) return [inL, inR];

    const dryL = inL;
    const dryR = inR;

    let wetL = inL * this.inGain;
    let wetR = inR * this.inGain;

    [wetL, wetR] = this.processEffect(wetL, wetR);

    wetL *= this.outGain;
    wetR *= this.outGain;

    // Wet/dry mix
    const outL = dryL * (1 - this.mix) + wetL * this.mix;
    const outR = dryR * (1 - this.mix) + wetR * this.mix;

    return [outL, outR];
  }

  processEffect(inL, inR) {
    // Override in subclass
    return [inL, inR];
  }

  reset() {
    // Override in subclass
  }
}


// ============================================================================
// DELAY EFFECT
// ============================================================================
class DelayEffect extends Effect {
  static get id() { return 'delay'; }
  static get name() { return 'Delay'; }
  static get params() {
    return {
      time: { min: 0.03, max: 2, default: 0.5, label: 'Time' },
      feedback: { min: 0, max: 1, default: 0.4, label: 'Feedback' },
      quality: { min: 0, max: 3, default: 0, step: 1, label: 'Quality' },
      mode: { min: 0, max: 2, default: 0, step: 1, label: 'Mode' },
      mix: { min: 0, max: 1, default: 0.5, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    const maxDelay = sampleRate * 5; // 5 seconds max
    this.delayL = new DelayLine(maxDelay);
    this.delayR = new DelayLine(maxDelay);
    this.altDelayL = new DelayLine(maxDelay);
    this.altDelayR = new DelayLine(maxDelay);

    // Filters for quality modes
    this.lpfL = new Biquad();
    this.lpfR = new Biquad();
    this.hpfL = new Biquad();
    this.hpfR = new Biquad();
    this.moogL = new MoogLadder(sampleRate);
    this.moogR = new MoogLadder(sampleRate);

    // LFO for tape warble
    this.lfo = new LFO();

    // Feedback samples
    this.feedbackL = 0;
    this.feedbackR = 0;

    // Parameters
    this.time = 0.5;
    this.feedback = 0.4;
    this.quality = 0; // 0=digital, 1=analog, 2=tape, 3=lofi
    this.mode = 0; // 0=normal, 1=ping-pong, 2=slapback
    this.mix = 0.5;

    // For crossfade on time change
    this.lastTime = 0.5;
    this.crossfade = 0;
    this.crossfading = false;
  }

  processEffect(inL, inR) {
    // Input safety check
    if (!isFinite(inL)) inL = 0;
    if (!isFinite(inR)) inR = 0;

    const delaySamples = Math.max(1, this.time * this.sampleRate);
    // Feedback amount (0.95 max to prevent runaway)
    const fb = Math.min(0.95, this.feedback);

    const q = Math.floor(this.quality);

    // Apply tape warble for tape/lofi modes
    let actualDelayL = delaySamples;
    let actualDelayR = delaySamples;
    if (q >= 2) {
      const warble = this.lfo.process(1, 'sine', this.sampleRate);
      const warbleAmount = linexp(this.time, 0.03, 5, 0.00004, 0.0006) * this.sampleRate;
      actualDelayL += warble * warbleAmount;
      actualDelayR += warble * warbleAmount;
    }

    // Clamp delay to valid range
    actualDelayL = Math.max(1, Math.min(actualDelayL, this.delayL.length - 2));
    actualDelayR = Math.max(1, Math.min(actualDelayR, this.delayR.length - 2));

    // Read from delay lines FIRST (before writing new samples)
    let delayedL = this.delayL.readCubic(actualDelayL);
    let delayedR = this.delayR.readCubic(actualDelayR);

    // Apply feedback based on mode
    let feedbackSignalL, feedbackSignalR;
    if (this.mode === 2) { // Slapback - no feedback
      feedbackSignalL = 0;
      feedbackSignalR = 0;
    } else if (this.mode === 1) { // Ping-pong - cross feedback
      feedbackSignalL = delayedR * fb;
      feedbackSignalR = delayedL * fb;
    } else { // Normal - same channel feedback
      feedbackSignalL = delayedL * fb;
      feedbackSignalR = delayedR * fb;
    }

    // Apply quality processing to feedback signal
    switch (q) {
      case 0: // Digital - clean passthrough
        break;

      case 1: // Analog - warmth and saturation
        this.hpfL.setHighpass(25, 0.707, this.sampleRate);
        this.hpfR.setHighpass(25, 0.707, this.sampleRate);
        this.lpfL.setLowpass(4500, 0.707, this.sampleRate);
        this.lpfR.setLowpass(4500, 0.707, this.sampleRate);
        feedbackSignalL = this.lpfL.process(softclip(this.hpfL.process(feedbackSignalL) * 1.4)) * 0.73;
        feedbackSignalR = this.lpfR.process(softclip(this.hpfR.process(feedbackSignalR) * 1.4)) * 0.73;
        break;

      case 2: // Tape - warm filter + subtle noise
        this.moogL.setCutoff(5000);
        this.moogR.setCutoff(5000);
        const pinkNoise = (Math.random() * 2 - 1) * 0.003;
        feedbackSignalL = Math.tanh(this.moogL.process(feedbackSignalL) + pinkNoise) * 0.9;
        feedbackSignalR = Math.tanh(this.moogR.process(feedbackSignalR) + pinkNoise) * 0.9;
        break;

      case 3: // Lo-fi - bit crush + filtering
        this.lpfL.setLowpass(3500, 0.707, this.sampleRate);
        this.lpfR.setLowpass(3500, 0.707, this.sampleRate);
        this.hpfL.setHighpass(260, 0.707, this.sampleRate);
        this.hpfR.setHighpass(260, 0.707, this.sampleRate);
        this.moogL.setCutoff(5000);
        this.moogR.setCutoff(5000);
        const lofiNoise = (Math.random() * 2 - 1) * 0.002;
        feedbackSignalL = this.lpfL.process(feedbackSignalL + lofiNoise);
        feedbackSignalR = this.lpfR.process(feedbackSignalR + lofiNoise);
        feedbackSignalL = Math.round(feedbackSignalL * 2048) / 2048;
        feedbackSignalR = Math.round(feedbackSignalR * 2048) / 2048;
        feedbackSignalL = this.moogL.process(this.hpfL.process(feedbackSignalL));
        feedbackSignalR = this.moogR.process(this.hpfR.process(feedbackSignalR));
        break;
    }

    // Write input + feedback to delay line
    this.delayL.write(inL + feedbackSignalL);
    this.delayR.write(inR + feedbackSignalR);

    // Mix dry and wet
    const outL = inL * (1 - this.mix) + delayedL * this.mix;
    const outR = inR * (1 - this.mix) + delayedR * this.mix;

    // Safety check
    if (!isFinite(outL) || !isFinite(outR)) {
      return [inL, inR];
    }

    return [
      Math.max(-2, Math.min(2, outL)),
      Math.max(-2, Math.min(2, outR))
    ];
  }

  reset() {
    this.delayL.clear();
    this.delayR.clear();
    this.feedbackL = 0;
    this.feedbackR = 0;
    this.lpfL.reset();
    this.lpfR.reset();
    this.hpfL.reset();
    this.hpfR.reset();
    this.moogL.reset();
    this.moogR.reset();
  }
}


// ============================================================================
// REVERB EFFECT
// ============================================================================
class ReverbEffect extends Effect {
  static get id() { return 'reverb'; }
  static get name() { return 'Reverb'; }
  static get params() {
    return {
      size: { min: 0, max: 1, default: 0.5, label: 'Size' },
      decay: { min: 0, max: 1, default: 0.5, label: 'Decay' },
      damping: { min: 0, max: 1, default: 0.5, label: 'Damping' },
      mix: { min: 0, max: 1, default: 0.3, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    this.sampleRate = sampleRate;

    // Base delay times in ms - longer and more spread for lush sound
    // Using prime-ish numbers to avoid metallic resonance
    this.baseCombTimesMs = [29.7, 37.1, 41.1, 43.7, 53.1, 56.3, 61.7, 67.3];
    this.baseAllpassTimesMs = [5.0, 12.6, 10.0, 7.7];

    // Allocate buffers large enough for max size (3x base times)
    const maxCombMs = 70 * 3; // ~210ms max
    const maxCombSamples = Math.ceil(maxCombMs * sampleRate / 1000) + 10;

    const maxApMs = 15 * 3; // ~45ms max
    const maxApSamples = Math.ceil(maxApMs * sampleRate / 1000) + 10;

    // 8 comb filters
    this.combL = [];
    this.combR = [];
    this.combFilterL = [];
    this.combFilterR = [];

    for (let i = 0; i < this.baseCombTimesMs.length; i++) {
      this.combL.push({ buffer: new Float32Array(maxCombSamples), idx: 0 });
      this.combR.push({ buffer: new Float32Array(maxCombSamples), idx: 0 });
      this.combFilterL.push(0);
      this.combFilterR.push(0);
    }

    // 4 allpass filters
    this.allpassL = [];
    this.allpassR = [];

    for (let i = 0; i < this.baseAllpassTimesMs.length; i++) {
      this.allpassL.push({ buffer: new Float32Array(maxApSamples), idx: 0 });
      this.allpassR.push({ buffer: new Float32Array(maxApSamples), idx: 0 });
    }

    // Parameters
    this.size = 0.5;
    this.decay = 0.5;
    this.damping = 0.5;
    this.mix = 0.3;
  }

  processEffect(inL, inR) {
    const input = (inL + inR) * 0.5;

    // Size scales delay times: 0.5x to 3x
    const sizeMultiplier = 0.5 + this.size * 2.5;

    // Decay controls feedback: 0.8 to 0.98
    const feedback = 0.8 + this.decay * 0.18;

    // Damping: higher = darker (more lowpass in feedback)
    const damp1 = this.damping * 0.4;
    const damp2 = 1 - damp1;

    // Stereo spread in ms
    const stereoSpreadMs = 1.7;

    let outL = 0;
    let outR = 0;

    // Process 8 parallel comb filters
    for (let i = 0; i < this.baseCombTimesMs.length; i++) {
      const timeMs = this.baseCombTimesMs[i] * sizeMultiplier;
      const samplesL = Math.floor((timeMs / 1000) * this.sampleRate);
      const samplesR = Math.floor(((timeMs + stereoSpreadMs) / 1000) * this.sampleRate);

      const combL = this.combL[i];
      const combR = this.combR[i];
      const bufLen = combL.buffer.length;

      // Read delayed samples
      const readIdxL = (combL.idx - samplesL + bufLen * 2) % bufLen;
      const readIdxR = (combR.idx - samplesR + bufLen * 2) % bufLen;
      const delL = combL.buffer[readIdxL];
      const delR = combR.buffer[readIdxR];

      // Damping lowpass in feedback path
      this.combFilterL[i] = delL * damp2 + this.combFilterL[i] * damp1;
      this.combFilterR[i] = delR * damp2 + this.combFilterR[i] * damp1;

      // Write input + feedback
      combL.buffer[combL.idx] = input + this.combFilterL[i] * feedback;
      combR.buffer[combR.idx] = input + this.combFilterR[i] * feedback;

      combL.idx = (combL.idx + 1) % bufLen;
      combR.idx = (combR.idx + 1) % bufLen;

      outL += delL;
      outR += delR;
    }

    // Scale comb output
    outL *= 0.125;
    outR *= 0.125;

    // Process 4 series allpass filters
    for (let i = 0; i < this.baseAllpassTimesMs.length; i++) {
      const timeMs = this.baseAllpassTimesMs[i] * sizeMultiplier;
      const samplesL = Math.floor((timeMs / 1000) * this.sampleRate);
      const samplesR = Math.floor(((timeMs + stereoSpreadMs * 0.5) / 1000) * this.sampleRate);

      const apL = this.allpassL[i];
      const apR = this.allpassR[i];
      const bufLen = apL.buffer.length;

      // Read
      const readIdxL = (apL.idx - samplesL + bufLen * 2) % bufLen;
      const readIdxR = (apR.idx - samplesR + bufLen * 2) % bufLen;
      const delL = apL.buffer[readIdxL];
      const delR = apR.buffer[readIdxR];

      // Allpass: out = delayed - g*in, write = in + g*delayed
      const g = 0.5;
      const newOutL = delL - g * outL;
      const newOutR = delR - g * outR;

      apL.buffer[apL.idx] = outL + g * delL;
      apR.buffer[apR.idx] = outR + g * delR;

      apL.idx = (apL.idx + 1) % bufLen;
      apR.idx = (apR.idx + 1) % bufLen;

      outL = newOutL;
      outR = newOutR;
    }

    return [outL, outR];
  }

  reset() {
    for (let i = 0; i < this.combL.length; i++) {
      this.combL[i].buffer.fill(0);
      this.combL[i].idx = 0;
      this.combR[i].buffer.fill(0);
      this.combR[i].idx = 0;
      this.combFilterL[i] = 0;
      this.combFilterR[i] = 0;
    }
    for (let i = 0; i < this.allpassL.length; i++) {
      this.allpassL[i].buffer.fill(0);
      this.allpassL[i].idx = 0;
      this.allpassR[i].buffer.fill(0);
      this.allpassR[i].idx = 0;
    }
  }
}


// ============================================================================
// CHORUS EFFECT
// ============================================================================
class ChorusEffect extends Effect {
  static get id() { return 'chorus'; }
  static get name() { return 'Chorus'; }
  static get params() {
    return {
      rate: { min: 0, max: 1, default: 0.5, label: 'Rate' },
      depth: { min: 0, max: 1, default: 0.5, label: 'Depth' },
      mix: { min: 0, max: 1, default: 0.5, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    const numVoices = 4;
    const maxDelayMs = 60;
    const maxDelaySamples = (maxDelayMs / 1000) * sampleRate;

    this.delays = [];
    this.lfos = [];
    this.lfoDetuning = [];

    for (let i = 0; i < numVoices; i++) {
      this.delays.push(new DelayLine(maxDelaySamples));
      this.lfos.push(new LFO());
      this.lfoDetuning.push(0.95 + Math.random() * 0.1); // 0.95-1.05
    }

    this.phaseDiff = 0.9;
    this.rate = 0.5;
    this.depth = 0.5;
    this.mix = 0.5;
  }

  processEffect(inL, inR) {
    // Calculate rate
    const rate = this.rate <= 0.5
      ? linexp(this.rate, 0, 0.5, 0.025, 0.125)
      : linexp(this.rate, 0.5, 1, 0.125, 2);

    // Calculate delay range
    const maxDelayTime = linlin(this.depth, 0, 1, 0.016, 0.052);
    const minDelayTime = linlin(this.depth, 0, 1, 0.012, 0.022);
    const centerDelay = (maxDelayTime + minDelayTime) / 2;
    const modDepth = (maxDelayTime - minDelayTime) / 2;

    // Mix input
    const monoIn = (inL + inR) / 2;

    // Process each voice
    let outL = 0;
    let outR = 0;

    for (let i = 0; i < this.delays.length; i++) {
      // LFO with phase offset
      this.lfos[i].phase = (this.lfos[i].phase || 0) + (rate * this.lfoDetuning[i]) / this.sampleRate;
      if (this.lfos[i].phase >= 1) this.lfos[i].phase -= 1;

      const lfoPhase = (this.lfos[i].phase + this.phaseDiff * i) % 1;
      // Parabolic LFO
      const p = lfoPhase * 2 - 1;
      const lfo = 1 - p * p;

      const delayTime = centerDelay + lfo * modDepth;
      const delaySamples = delayTime * this.sampleRate;

      this.delays[i].write(monoIn);
      const delayed = this.delays[i].readLinear(delaySamples);

      // Spread voices L/R
      if (i % 2 === 0) {
        outL += delayed;
      } else {
        outR += delayed;
      }
    }

    // Normalize
    outL /= this.delays.length / 2;
    outR /= this.delays.length / 2;

    return [
      inL * (1 - this.mix) + outL * this.mix,
      inR * (1 - this.mix) + outR * this.mix
    ];
  }

  reset() {
    this.delays.forEach(d => d.clear());
    this.lfos.forEach(l => l.phase = 0);
  }
}


// ============================================================================
// TREMOLO EFFECT
// ============================================================================
class TremoloEffect extends Effect {
  static get id() { return 'tremolo'; }
  static get name() { return 'Tremolo'; }
  static get params() {
    return {
      time: { min: 0.05, max: 2, default: 0.5, label: 'Time' },
      depth: { min: 0, max: 1, default: 0.5, label: 'Depth' },
      shape: { min: 0, max: 1, default: 0.33, label: 'Shape' },
      mix: { min: 0, max: 1, default: 1, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    this.phase = 0;
    this.time = 0.5;
    this.depth = 0.5;
    this.shape = 0.33;
    this.mix = 1;
  }

  processEffect(inL, inR) {
    const rate = 1 / this.time;
    this.phase += rate / this.sampleRate;
    if (this.phase >= 1) this.phase -= 1;

    // Wavetable mixing (sin->tri->saw->sqr)
    let sinMix = 0, triMix = 0, sawMix = 0, sqrMix = 0;
    const s = this.shape;

    if (s < 0.33) {
      sinMix = linlin(s, 0, 0.33, 1, 0);
      triMix = linlin(s, 0, 0.33, 0, 1);
    } else if (s < 0.67) {
      triMix = linlin(s, 0.33, 0.67, 1, 0);
      sawMix = linlin(s, 0.33, 0.67, 0, 1);
    } else {
      sawMix = linlin(s, 0.67, 1, 1, 0);
      sqrMix = linlin(s, 0.67, 1, 0, 1);
    }

    // Generate waveforms (unipolar 0-1)
    const p2 = this.phase * 2 * Math.PI;
    const sinVal = (Math.sin(p2) + 1) / 2;
    const triVal = this.phase < 0.5 ? this.phase * 2 : 2 - this.phase * 2;
    const sawVal = this.phase;
    const sqrVal = this.phase < 0.5 ? 1 : 0;

    // Mix waveforms (0-1 range)
    const lfo = sinVal * sinMix + triVal * triMix + sawVal * sawMix + sqrVal * sqrMix;

    // Apply depth: at depth=0, ampMod=1 (no effect)
    // At depth=1, ampMod goes from 0 to 1 (full tremolo)
    const ampMod = 1 - this.depth + lfo * this.depth;

    return [inL * ampMod, inR * ampMod];
  }

  reset() {
    this.phase = 0;
  }
}


// ============================================================================
// FLANGER EFFECT
// ============================================================================
class FlangerEffect extends Effect {
  static get id() { return 'flanger'; }
  static get name() { return 'Flanger'; }
  static get params() {
    return {
      rate: { min: 0, max: 1, default: 0.5, label: 'Rate' },
      depth: { min: 0, max: 1, default: 0.5, label: 'Depth' },
      feedback: { min: 0, max: 1, default: 0.5, label: 'Feedback' },
      predelay: { min: 0, max: 1, default: 0.5, label: 'Pre-delay' },
      mix: { min: 0, max: 1, default: 0.5, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    const maxDelayMs = 10.5;
    const maxDelaySamples = (maxDelayMs / 1000) * sampleRate;

    this.delayL = new DelayLine(maxDelaySamples);
    this.delayR = new DelayLine(maxDelaySamples);
    this.lfo = new LFO();
    this.feedbackL = 0;
    this.feedbackR = 0;

    this.maxDelay = maxDelayMs / 1000;
    this.rate = 0.5;
    this.depth = 0.5;
    this.feedback = 0.5;
    this.predelay = 0.5;
    this.mix = 0.5;
  }

  processEffect(inL, inR) {
    const rate = linexp(this.rate, 0, 1, 0.1, 8);
    const depth = linexp(this.depth, 0, 1, 0.00025, this.maxDelay * 0.45);
    const preDelay = linlin(this.predelay, 0, 1, depth, this.maxDelay - depth);
    const fb = linlin(this.feedback, 0, 1, 0, 1.1);

    // LFO
    const lfo = this.lfo.process(rate, 'parabolic', this.sampleRate);
    const delayTime = preDelay + lfo * depth;
    const delaySamples = delayTime * this.sampleRate;

    // Apply feedback with softclip if beyond unity
    let fbL = this.feedbackL * fb;
    let fbR = this.feedbackR * fb;
    if (fb >= 1) {
      fbL = softclip(fbL);
      fbR = softclip(fbR);
    }

    // Write to delay
    this.delayL.write(inL + fbL);
    this.delayR.write(inR + fbR);

    // Read from delay
    const delayedL = this.delayL.readLinear(delaySamples);
    const delayedR = this.delayR.readLinear(delaySamples);

    // Store for feedback
    this.feedbackL = delayedL;
    this.feedbackR = delayedR;

    // Mix dry + delayed
    const outL = inL + delayedL;
    const outR = inR + delayedR;

    return [
      inL * (1 - this.mix) + outL * this.mix,
      inR * (1 - this.mix) + outR * this.mix
    ];
  }

  reset() {
    this.delayL.clear();
    this.delayR.clear();
    this.lfo.reset();
    this.feedbackL = 0;
    this.feedbackR = 0;
  }
}


// ============================================================================
// PHASER EFFECT
// ============================================================================
class PhaserEffect extends Effect {
  static get id() { return 'phaser'; }
  static get name() { return 'Phaser'; }
  static get params() {
    return {
      rate: { min: 0, max: 1, default: 0.5, label: 'Rate' },
      depth: { min: 0, max: 1, default: 0.5, label: 'Depth' },
      mix: { min: 0, max: 1, default: 0.5, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    const numStages = 4;
    const maxDelayMs = 10;
    const maxDelaySamples = (maxDelayMs / 1000) * sampleRate / numStages;

    this.allpassL = [];
    this.allpassR = [];
    this.lfos = [];

    for (let i = 0; i < numStages; i++) {
      this.allpassL.push(new AllpassFilter(maxDelaySamples));
      this.allpassR.push(new AllpassFilter(maxDelaySamples));
      this.lfos.push(new LFO());
      this.lfos[i].phase = 0.5 * Math.random() + i * 0.25; // Phase offset
    }

    this.maxDelay = maxDelayMs / 1000 / numStages;
    this.rate = 0.5;
    this.depth = 0.5;
    this.mix = 0.5;
  }

  processEffect(inL, inR) {
    const rate = linexp(this.rate, 0, 1, 0.275, 16);
    // SC divides depth by numAllPasses for proper multi-stage phasing
    const numStages = this.allpassL.length;
    const baseDepth = linexp(this.depth, 0, 1, 0.0005, this.maxDelay * 0.5);
    const depth = baseDepth / numStages;

    let phasedL = inL;
    let phasedR = inR;

    for (let i = 0; i < numStages; i++) {
      // LFO with phase offset - LFPar.kr(rate, i + 0.5.rand, depth, depth)
      // The SC code uses LFPar (parabolic) with depth as both mul and add
      const lfo = this.lfos[i].process(rate, 'parabolic', this.sampleRate);
      // LFPar output [-1,1] * depth + depth = [0, 2*depth]
      const delayTime = (lfo + 1) * depth;
      const delaySamples = Math.max(1, delayTime * this.sampleRate);

      // Allpass with decay time = 0 (no feedback)
      phasedL = this.allpassL[i].process(phasedL, delaySamples, 0);
      phasedR = this.allpassR[i].process(phasedR, delaySamples, 0);
    }

    // SC: wet + delayedSignal (simple sum, then we apply mix)
    const wetL = inL + phasedL;
    const wetR = inR + phasedR;

    // Apply mix control (at mix=1, full phaser; at mix=0, dry signal)
    return [
      inL * (1 - this.mix) + wetL * this.mix * 0.5,
      inR * (1 - this.mix) + wetR * this.mix * 0.5
    ];
  }

  reset() {
    this.allpassL.forEach(a => a.reset());
    this.allpassR.forEach(a => a.reset());
    this.lfos.forEach(l => l.reset());
  }
}


// ============================================================================
// OVERDRIVE EFFECT
// ============================================================================
class OverdriveEffect extends Effect {
  static get id() { return 'overdrive'; }
  static get name() { return 'Overdrive'; }
  static get params() {
    return {
      drive: { min: 0, max: 1, default: 0.5, label: 'Drive' },
      tone: { min: 0, max: 1, default: 0.5, label: 'Tone' },
      mix: { min: 0, max: 1, default: 1, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    this.hpfL = new Biquad();
    this.hpfR = new Biquad();
    this.toneL = new MoogLadder(sampleRate);
    this.toneR = new MoogLadder(sampleRate);
    this.toneHpfL = new Biquad();
    this.toneHpfR = new Biquad();

    this.drive = 0.5;
    this.tone = 0.5;
    this.mix = 1;
  }

  processEffect(inL, inR) {
    // Input safety check
    if (!isFinite(inL)) inL = 0;
    if (!isFinite(inR)) inR = 0;

    // HPF to remove DC and sub-bass (matches SC: HPF.ar(wet, 25))
    this.hpfL.setHighpass(25, 0.707, this.sampleRate);
    this.hpfR.setHighpass(25, 0.707, this.sampleRate);
    let wetL = this.hpfL.process(inL);
    let wetR = this.hpfR.process(inR);

    // Drive with soft clipping (matches SC: (wet * LinLin.kr(drive, 0, 1, 1, 3)).softclip)
    const gain = linlin(this.drive, 0, 1, 1, 3);
    wetL = softclip(wetL * gain);
    wetR = softclip(wetR * gain);

    // Tone filter (matches SC DFM1 - uses MoogLadder for lowpass, Biquad for highpass)
    // The key fix: ensure minimum cutoff of 100Hz to prevent signal loss at low tone settings
    // SC uses DFM1 which doesn't kill signal at low frequencies like MoogLadder does
    if (this.tone <= 0.75) {
      // Lowpass mode: 100Hz-20kHz (adjusted from SC's 10Hz minimum to prevent signal loss)
      const freq = this.tone <= 0.2
        ? linexp(this.tone, 0, 0.2, 100, 800)     // Adjusted: 100-800Hz for very low tone
        : linexp(this.tone, 0.2, 0.75, 800, 20000); // 800Hz-20kHz for mid-high tone
      this.toneL.setCutoff(Math.max(100, freq));
      this.toneR.setCutoff(Math.max(100, freq));
      this.toneL.setResonance(0.1);
      this.toneR.setResonance(0.1);
      wetL = softclip(this.toneL.process(wetL));
      wetR = softclip(this.toneR.process(wetR));
    } else {
      // Highpass mode (tone > 0.75): 20Hz-21kHz
      const freq = linexp(this.tone, 0.75, 1, 20, 10000);
      this.toneHpfL.setHighpass(Math.max(20, freq), 0.707, this.sampleRate);
      this.toneHpfR.setHighpass(Math.max(20, freq), 0.707, this.sampleRate);
      wetL = softclip(this.toneHpfL.process(wetL));
      wetR = softclip(this.toneHpfR.process(wetR));
    }

    // Output safety check
    if (!isFinite(wetL) || !isFinite(wetR)) {
      return [inL, inR];
    }

    return [
      Math.max(-2, Math.min(2, wetL)),
      Math.max(-2, Math.min(2, wetR))
    ];
  }

  reset() {
    this.hpfL.reset();
    this.hpfR.reset();
    this.toneL.reset();
    this.toneR.reset();
    this.toneHpfL.reset();
    this.toneHpfR.reset();
  }
}


// ============================================================================
// DISTORTION EFFECT
// ============================================================================
class DistortionEffect extends Effect {
  static get id() { return 'distortion'; }
  static get name() { return 'Distortion'; }
  static get params() {
    return {
      drive: { min: 0, max: 1, default: 0.5, label: 'Drive' },
      tone: { min: 0, max: 1, default: 0.5, label: 'Tone' },
      mix: { min: 0, max: 1, default: 1, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    this.hpfL = new Biquad();
    this.hpfR = new Biquad();
    this.toneL = new MoogLadder(sampleRate);
    this.toneR = new MoogLadder(sampleRate);
    this.toneHpfL = new Biquad();
    this.toneHpfR = new Biquad();

    this.drive = 0.5;
    this.tone = 0.5;
    this.mix = 1;
  }

  processEffect(inL, inR) {
    // HPF to remove DC and sub-bass
    this.hpfL.setHighpass(25, 0.707, this.sampleRate);
    this.hpfR.setHighpass(25, 0.707, this.sampleRate);
    let wetL = this.hpfL.process(inL);
    let wetR = this.hpfR.process(inR);

    // Drive with hard clipping (1-5x gain, exponential)
    const gain = linexp(this.drive, 0, 1, 1, 5);
    wetL = distort(wetL * gain);
    wetR = distort(wetR * gain);

    // Tone filter (same as overdrive)
    if (this.tone <= 0.75) {
      const freq = this.tone <= 0.2
        ? linexp(this.tone, 0, 0.2, 100, 800)
        : linexp(this.tone, 0.2, 0.75, 800, 20000);
      this.toneL.setCutoff(freq);
      this.toneR.setCutoff(freq);
      this.toneL.setResonance(0.1);
      this.toneR.setResonance(0.1);
      wetL = softclip(this.toneL.process(wetL));
      wetR = softclip(this.toneR.process(wetR));
    } else {
      const freq = linexp(this.tone, 0.75, 1, 20, 21000);
      this.toneHpfL.setHighpass(freq, 0.707, this.sampleRate);
      this.toneHpfR.setHighpass(freq, 0.707, this.sampleRate);
      wetL = softclip(this.toneHpfL.process(wetL));
      wetR = softclip(this.toneHpfR.process(wetR));
    }

    return [wetL, wetR];
  }

  reset() {
    this.hpfL.reset();
    this.hpfR.reset();
    this.toneL.reset();
    this.toneR.reset();
    this.toneHpfL.reset();
    this.toneHpfR.reset();
  }
}


// ============================================================================
// COMPRESSOR EFFECT
// ============================================================================
class CompressorEffect extends Effect {
  static get id() { return 'compressor'; }
  static get name() { return 'Compressor'; }
  static get params() {
    return {
      threshold: { min: -60, max: 0, default: -20, label: 'Threshold' },
      ratio: { min: 1, max: 20, default: 4, label: 'Ratio' },
      attack: { min: 0.1, max: 100, default: 10, label: 'Attack' },
      release: { min: 10, max: 1000, default: 100, label: 'Release' },
      makeup: { min: 0, max: 24, default: 0, label: 'Makeup' },
      mix: { min: 0, max: 1, default: 1, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    this.hpfL = new Biquad();
    this.hpfR = new Biquad();

    // Envelope followers for sidechain
    this.envL = 0;
    this.envR = 0;

    // Parameters
    this.threshold = -20;  // dB
    this.ratio = 4;
    this.attack = 10;      // ms
    this.release = 100;    // ms
    this.makeup = 0;       // dB
    this.mix = 1;

    // Pre-calculate coefficients
    this._updateCoeffs();
  }

  _updateCoeffs() {
    // Convert ms to coefficients
    this.attackCoef = Math.exp(-1 / (this.attack * this.sampleRate / 1000));
    this.releaseCoef = Math.exp(-1 / (this.release * this.sampleRate / 1000));
    // Convert dB threshold to linear
    this.thresholdLin = Math.pow(10, this.threshold / 20);
    // Makeup gain
    this.makeupLin = Math.pow(10, this.makeup / 20);
  }

  processEffect(inL, inR) {
    this._updateCoeffs();

    // HPF to remove DC and sub-bass from sidechain
    this.hpfL.setHighpass(80, 0.707, this.sampleRate);
    this.hpfR.setHighpass(80, 0.707, this.sampleRate);
    const scL = this.hpfL.process(inL);
    const scR = this.hpfR.process(inR);

    // Peak detection (take max of L/R for linked compression)
    const inputLevel = Math.max(Math.abs(scL), Math.abs(scR));

    // Envelope follower with attack/release
    if (inputLevel > this.envL) {
      this.envL = inputLevel + (this.envL - inputLevel) * this.attackCoef;
    } else {
      this.envL = inputLevel + (this.envL - inputLevel) * this.releaseCoef;
    }

    // Compute gain reduction in dB
    let gainReduction = 0;
    if (this.envL > this.thresholdLin && this.envL > 0.0001) {
      const overDb = 20 * Math.log10(this.envL / this.thresholdLin);
      gainReduction = overDb * (1 - 1/this.ratio);
    }

    // Convert gain reduction to linear and apply
    const gain = Math.pow(10, -gainReduction / 20) * this.makeupLin;

    const wetL = inL * gain;
    const wetR = inR * gain;

    return [wetL, wetR];
  }

  reset() {
    this.hpfL.reset();
    this.hpfR.reset();
    this.envL = 0;
    this.envR = 0;
  }
}


// ============================================================================
// VIBRATO EFFECT
// Pitch modulation via modulated delay
// ============================================================================
class VibratoEffect extends Effect {
  static get id() { return 'vibrato'; }
  static get name() { return 'Vibrato'; }
  static get params() {
    return {
      rate: { min: 0, max: 1, default: 0.5, label: 'Rate' },
      depth: { min: 0, max: 1, default: 0.5, label: 'Depth' },
      expression: { min: 0, max: 1, default: 0.5, label: 'Expression' },
      mix: { min: 0, max: 1, default: 1, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    // Max depth = 30 cents, min rate = 0.75 Hz
    const maxDepth = 30;
    const minRate = 0.75;
    const maxDelay = (((Math.pow(2, maxDepth / 1200)) - 1) / (4 * minRate)) * 2.5;
    this.delayL = new DelayLine(Math.ceil(maxDelay * sampleRate) + 128);
    this.delayR = new DelayLine(Math.ceil(maxDelay * sampleRate) + 128);
    this.envFollowerL = new EnvelopeFollower(sampleRate, 0.001, 0.14);
    this.envFollowerR = new EnvelopeFollower(sampleRate, 0.001, 0.14);
    this.envDelayL = new DelayLine(Math.ceil(0.1 * sampleRate));
    this.envDelayR = new DelayLine(Math.ceil(0.1 * sampleRate));
    this.lfoPhase = 0;

    this.rate = 0.5;
    this.depth = 0.5;
    this.expression = 0.5;
    this.mix = 1;
    this.maxDepth = maxDepth;
    this.minRate = minRate;
  }

  processEffect(inL, inR) {
    // Envelope follower
    const clippedL = Math.max(-1, Math.min(1, inL * 6));
    const clippedR = Math.max(-1, Math.min(1, inR * 6));
    let envL = this.envFollowerL.process(Math.abs(clippedL));
    let envR = this.envFollowerR.process(Math.abs(clippedR));

    // Delay envelope by 70ms
    this.envDelayL.write(envL);
    this.envDelayR.write(envR);
    envL = this.envDelayL.readLinear(0.07 * this.sampleRate);
    envR = this.envDelayR.readLinear(0.07 * this.sampleRate);

    // Expression scales envelope influence
    const envMulL = (1 - this.expression) + (envL * this.expression);
    const envMulR = (1 - this.expression) + (envR * this.expression);

    // Rate and depth modulated by envelope
    const rateL = linexp(this.rate * envMulL, 0, 1, this.minRate, 60);
    const rateR = linexp(this.rate * envMulR, 0, 1, this.minRate, 60);
    const depthL = linexp(this.depth * envMulL, 0, 1, 3.3, this.maxDepth);
    const depthR = linexp(this.depth * envMulR, 0, 1, 3.3, this.maxDepth);

    // Calculate delay modulation
    const mulL = ((Math.pow(2, depthL / 1200)) - 1) / (4 * rateL);
    const mulR = ((Math.pow(2, depthR / 1200)) - 1) / (4 * rateR);

    // LFO - SC uses phase offset of 2 radians
    const lfo = Math.sin(this.lfoPhase * 2 * Math.PI + 2);
    this.lfoPhase += rateL / this.sampleRate;
    if (this.lfoPhase >= 1) this.lfoPhase -= 1;

    // Modulated delay
    // SC uses ControlRate.ir.reciprocal as base delay (typically sampleRate/64)
    // This ensures delay never goes to 0 and provides smoother modulation
    const controlRateRecip = 64 / this.sampleRate;  // Approx 1.45ms at 44100Hz
    const delaySamplesL = (lfo * mulL + mulL + controlRateRecip) * this.sampleRate;
    const delaySamplesR = (lfo * mulR + mulR + controlRateRecip) * this.sampleRate;

    this.delayL.write(inL);
    this.delayR.write(inR);

    const wetL = this.delayL.readCubic(delaySamplesL);
    const wetR = this.delayR.readCubic(delaySamplesR);

    return [wetL, wetR];
  }

  reset() {
    this.delayL.clear();
    this.delayR.clear();
    this.envDelayL.clear();
    this.envDelayR.clear();
    this.envFollowerL.reset();
    this.envFollowerR.reset();
    this.lfoPhase = 0;
  }
}


// ============================================================================
// AUTOWAH EFFECT
// Envelope-controlled bandpass filter
// ============================================================================
class AutoWahEffect extends Effect {
  static get id() { return 'autowah'; }
  static get name() { return 'AutoWah'; }
  static get params() {
    return {
      rate: { min: 0, max: 1, default: 0.5, label: 'Rate' },
      depth: { min: 0, max: 1, default: 0.5, label: 'Depth' },
      sensitivity: { min: 0, max: 1, default: 0.5, label: 'Sensitivity' },
      resonance: { min: 0, max: 1, default: 0.5, label: 'Resonance' },
      mode: { min: 0, max: 2, default: 0, label: 'Mode', type: 'select', options: ['Lowpass', 'Bandpass', 'Highpass'] },
      mix: { min: 0, max: 1, default: 1, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    this.envFollowerL = new EnvelopeFollower(sampleRate, 0.001, 0.1);
    this.envFollowerR = new EnvelopeFollower(sampleRate, 0.001, 0.1);
    this.filter1L = new Biquad();
    this.filter1R = new Biquad();
    this.filter2L = new Biquad();
    this.filter2R = new Biquad();
    this.envSmoothL = 0;
    this.envSmoothR = 0;

    this.rate = 0.5;
    this.depth = 0.5;
    this.sensitivity = 0.5;
    this.resonance = 0.5;
    this.mode = 0;
    this.mix = 1;
  }

  processEffect(inL, inR) {
    // Sensitivity multiplier
    const sensMultiplier = linlin(this.sensitivity, 0, 1, 3, 9);

    // Envelope follower with smoothing based on rate
    const clippedL = Math.max(-1, Math.min(1, inL * sensMultiplier));
    const clippedR = Math.max(-1, Math.min(1, inR * sensMultiplier));
    let envL = this.envFollowerL.process(Math.abs(clippedL));
    let envR = this.envFollowerR.process(Math.abs(clippedR));

    // Smooth envelope based on rate
    const lagTime = linexp(this.rate, 0, 1, 0.4, 0.0375);
    const lagCoef = Math.exp(-1 / (lagTime * this.sampleRate));
    this.envSmoothL = this.envSmoothL * lagCoef + envL * (1 - lagCoef);
    this.envSmoothR = this.envSmoothR * lagCoef + envR * (1 - lagCoef);

    // Calculate filter frequencies (two formants)
    const minCutoff1 = linexp(this.depth, 0, 1, 440, 85);
    const maxCutoff1 = linexp(this.depth, 0, 1, 1100, 1750);
    const cutoff1L = linexp(this.envSmoothL, 0, 1, minCutoff1, maxCutoff1);
    const cutoff1R = linexp(this.envSmoothR, 0, 1, minCutoff1, maxCutoff1);

    const minCutoff2 = linexp(this.depth, 0, 1, 1450, 900);
    const maxCutoff2 = linexp(this.depth, 0, 1, 2175, 2750);
    const cutoff2L = linexp(this.envSmoothL, 0, 1, minCutoff2, maxCutoff2);
    const cutoff2R = linexp(this.envSmoothR, 0, 1, minCutoff2, maxCutoff2);

    // Resonance
    const rq = linexp(this.resonance, 0, 1, 0.325, 0.01925);
    const Q = 1 / rq;
    const bpMul = linlin(this.resonance, 0, 1, 2.5, 7.5);

    // Set filter coefficients based on mode
    const mode = Math.floor(this.mode);
    let wetL, wetR;

    if (mode === 0) { // Lowpass
      this.filter1L.setLowpass(cutoff1L, Q, this.sampleRate);
      this.filter1R.setLowpass(cutoff1R, Q, this.sampleRate);
      this.filter2L.setLowpass(cutoff2L, Q, this.sampleRate);
      this.filter2R.setLowpass(cutoff2R, Q, this.sampleRate);
      wetL = (this.filter1L.process(inL) * 0.75 + this.filter2L.process(inL) * 0.25) * 0.67;
      wetR = (this.filter1R.process(inR) * 0.75 + this.filter2R.process(inR) * 0.25) * 0.67;
    } else if (mode === 1) { // Bandpass
      this.filter1L.setBandpass(cutoff1L, Q * 0.5, this.sampleRate);
      this.filter1R.setBandpass(cutoff1R, Q * 0.5, this.sampleRate);
      this.filter2L.setBandpass(cutoff2L, Q * 0.5, this.sampleRate);
      this.filter2R.setBandpass(cutoff2R, Q * 0.5, this.sampleRate);
      wetL = softclip((this.filter1L.process(inL) * 0.75 + this.filter2L.process(inL) * 0.25) * bpMul);
      wetR = softclip((this.filter1R.process(inR) * 0.75 + this.filter2R.process(inR) * 0.25) * bpMul);
    } else { // Highpass
      this.filter1L.setHighpass(cutoff1L, Q, this.sampleRate);
      this.filter1R.setHighpass(cutoff1R, Q, this.sampleRate);
      this.filter2L.setHighpass(cutoff2L, Q, this.sampleRate);
      this.filter2R.setHighpass(cutoff2R, Q, this.sampleRate);
      wetL = (this.filter1L.process(inL) * 0.75 + this.filter2L.process(inL) * 0.25) * 0.75;
      wetR = (this.filter1R.process(inR) * 0.75 + this.filter2R.process(inR) * 0.25) * 0.75;
    }

    return [wetL, wetR];
  }

  reset() {
    this.envFollowerL.reset();
    this.envFollowerR.reset();
    this.filter1L.reset();
    this.filter1R.reset();
    this.filter2L.reset();
    this.filter2R.reset();
    this.envSmoothL = 0;
    this.envSmoothR = 0;
  }
}


// ============================================================================
// WAVEFOLDER EFFECT
// Wave folding with symmetry and smoothing
// ============================================================================
class WavefolderEffect extends Effect {
  static get id() { return 'wavefolder'; }
  static get name() { return 'Wavefolder'; }
  static get params() {
    return {
      amount: { min: 0, max: 1, default: 0.5, label: 'Amount' },
      symmetry: { min: 0, max: 1, default: 1, label: 'Symmetry' },
      smoothing: { min: 0, max: 1, default: 0.5, label: 'Smoothing' },
      expression: { min: 0, max: 1, default: 0.5, label: 'Expression' },
      mix: { min: 0, max: 1, default: 1, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    this.envFollowerL = new EnvelopeFollower(sampleRate, 0.0001, 0.01);
    this.envFollowerR = new EnvelopeFollower(sampleRate, 0.0001, 0.01);
    this.dcBlockerL = new DCBlocker();
    this.dcBlockerR = new DCBlocker();

    this.amount = 0.5;
    this.symmetry = 1;
    this.smoothing = 0.5;
    this.expression = 0.5;
    this.mix = 1;
  }

  processEffect(inL, inR) {
    // Input safety check
    if (!isFinite(inL)) inL = 0;
    if (!isFinite(inR)) inR = 0;

    const gain = linlin(this.amount, 0, 1, 1, 20);
    const compensationGain = 1 / Math.max(gain * 0.75, 1);

    // Envelope follower for expression control
    const envL = this.envFollowerL.process(Math.abs(softclip(inL * 2)));
    const envR = this.envFollowerR.process(Math.abs(softclip(inR * 2)));

    // Amplitude mix between fixed compensation and envelope following
    const ampL = compensationGain * (1 - this.expression) + envL * this.expression;
    const ampR = compensationGain * (1 - this.expression) + envR * this.expression;

    // Symmetry offset (0 = asymmetric with DC offset, 1 = symmetric)
    const symOffset = linlin(this.symmetry, 0, 1, 0.5, 0);

    // Apply gain and fold using smoothFoldS (matches SmoothFoldS from SC)
    // foldRange = 1 means full fold range
    let wetL = smoothFoldS((inL + symOffset) * gain, -1, 1, 1, this.smoothing);
    let wetR = smoothFoldS((inR + symOffset) * gain, -1, 1, 1, this.smoothing);

    // DC blocking (essential after asymmetric folding)
    wetL = this.dcBlockerL.process(wetL);
    wetR = this.dcBlockerR.process(wetR);

    // Apply amplitude compensation
    wetL *= ampL;
    wetR *= ampR;

    // Output safety check
    if (!isFinite(wetL) || !isFinite(wetR)) {
      return [inL, inR];
    }

    return [
      Math.max(-2, Math.min(2, wetL)),
      Math.max(-2, Math.min(2, wetR))
    ];
  }

  reset() {
    this.envFollowerL.reset();
    this.envFollowerR.reset();
    this.dcBlockerL.reset();
    this.dcBlockerR.reset();
  }
}


// ============================================================================
// BITCRUSHER EFFECT
// Sample rate and bit depth reduction
// ============================================================================
class BitcrusherEffect extends Effect {
  static get id() { return 'bitcrusher'; }
  static get name() { return 'Bitcrusher'; }
  static get params() {
    return {
      bitrate: { min: 1, max: 16, default: 12, label: 'Bit Depth' },
      samplerate: { min: 0, max: 1, default: 1, label: 'Sample Rate' },
      tone: { min: 0, max: 1, default: 0.5, label: 'Tone' },
      gate: { min: 0, max: 1, default: 0.5, label: 'Gate' },
      mix: { min: 0, max: 1, default: 1, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    this.hpfL = new Biquad();
    this.hpfR = new Biquad();
    this.antiAliasL = new Biquad();
    this.antiAliasR = new Biquad();
    this.toneL = new MoogLadder(sampleRate);
    this.toneR = new MoogLadder(sampleRate);
    this.toneHpfL = new Biquad();
    this.toneHpfR = new Biquad();
    this.decimator = new Decimator();
    this.gateL = new Compressor(sampleRate);
    this.gateR = new Compressor(sampleRate);

    this.bitrate = 12;
    this.samplerate = 1;
    this.tone = 0.5;
    this.gate = 0.5;
    this.mix = 1;
  }

  processEffect(inL, inR) {
    // Input safety check
    if (!isFinite(inL)) inL = 0;
    if (!isFinite(inR)) inR = 0;

    // HPF to remove sub-20Hz
    this.hpfL.setHighpass(25, 0.707, this.sampleRate);
    this.hpfR.setHighpass(25, 0.707, this.sampleRate);
    let wetL = this.hpfL.process(inL);
    let wetR = this.hpfR.process(inR);

    // Noise gate (matches SC Compander with high ratio)
    const gateThreshold = this.gate <= 0.5
      ? linexp(this.gate, 0, 0.5, 0.001, 0.015)
      : linexp(this.gate, 0.5, 1, 0.015, 0.05);
    this.gateL.setParams(gateThreshold, 6, 100, 10, 1);
    this.gateR.setParams(gateThreshold, 6, 100, 10, 1);
    wetL = this.gateL.process(wetL);
    wetR = this.gateR.process(wetR);

    // Anti-aliasing filter before decimation (matches SC: LPF.ar(wet, 5.66.reciprocal * samplerate))
    const targetSR = linexp(this.samplerate, 0, 1, 1000, this.sampleRate);
    const antiAliasFreq = Math.max(20, Math.min(targetSR / 5.66, this.sampleRate * 0.45));
    this.antiAliasL.setLowpass(antiAliasFreq, 0.707, this.sampleRate);
    this.antiAliasR.setLowpass(antiAliasFreq, 0.707, this.sampleRate);
    wetL = this.antiAliasL.process(wetL);
    wetR = this.antiAliasR.process(wetR);

    // Bit reduction and sample rate reduction
    this.decimator.setBits(this.bitrate);
    this.decimator.setRate(Math.max(0.01, targetSR / this.sampleRate));
    const [decL, decR] = this.decimator.process(wetL, wetR);
    wetL = decL;
    wetR = decR;

    // Tone filter - simple lowpass from 200Hz to 16kHz
    const toneFreq = linexp(this.tone, 0, 1, 200, 16000);
    this.toneL.setCutoff(toneFreq);
    this.toneR.setCutoff(toneFreq);
    this.toneL.setResonance(0);
    this.toneR.setResonance(0);
    wetL = this.toneL.process(wetL);
    wetR = this.toneR.process(wetR);

    // Output safety check
    if (!isFinite(wetL) || !isFinite(wetR)) {
      return [inL, inR];
    }

    return [
      Math.max(-2, Math.min(2, wetL)),
      Math.max(-2, Math.min(2, wetR))
    ];
  }

  reset() {
    this.hpfL.reset();
    this.hpfR.reset();
    this.antiAliasL.reset();
    this.antiAliasR.reset();
    this.toneL.reset();
    this.toneR.reset();
    this.toneHpfL.reset();
    this.toneHpfR.reset();
    this.decimator.reset();
    this.gateL.reset();
    this.gateR.reset();
  }
}


// ============================================================================
// SUSTAIN EFFECT
// Infinite sustain via upward compression (matches SC Sustain.sc)
// Signal flow: HPF -> Noise Gate -> CompanderD (sustainer) -> Tone Filter
// ============================================================================
class SustainEffect extends Effect {
  static get id() { return 'sustain'; }
  static get name() { return 'Sustain'; }
  static get params() {
    return {
      drive: { min: 0, max: 1, default: 0.5, label: 'Drive' },
      gate: { min: 0, max: 1, default: 0.5, label: 'Gate' },
      tone: { min: 0, max: 1, default: 0.5, label: 'Tone' },
      mix: { min: 0, max: 1, default: 1, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    // HPF to remove sub-20Hz (matches SC: HPF.ar(wet, 25))
    this.hpfL = new Biquad();
    this.hpfR = new Biquad();

    // Envelope followers for gate and sustainer
    this.gateEnvL = 0;
    this.gateEnvR = 0;
    this.sustainEnvL = 0;
    this.sustainEnvR = 0;

    // Attack/release coefficients (fast for sustainer as in SC: 0.01s attack/release)
    const gateAttack = 1 - Math.exp(-1 / (100 * sampleRate / 1000));  // 100ms
    const gateRelease = 1 - Math.exp(-1 / (10 * sampleRate / 1000));  // 10ms
    const sustainAttack = 1 - Math.exp(-1 / (10 * sampleRate / 1000)); // 10ms (matches SC)
    const sustainRelease = 1 - Math.exp(-1 / (10 * sampleRate / 1000)); // 10ms (matches SC)
    this.gateAttack = gateAttack;
    this.gateRelease = gateRelease;
    this.sustainAttack = sustainAttack;
    this.sustainRelease = sustainRelease;

    // Tone filter (matches SC DFM1/MoogFF)
    this.toneL = new MoogLadder(sampleRate);
    this.toneR = new MoogLadder(sampleRate);
    this.toneHpfL = new Biquad();
    this.toneHpfR = new Biquad();

    // Parameters
    this.drive = 0.5;
    this.gate = 0.5;
    this.tone = 0.5;
    this.mix = 1;
  }

  processEffect(inL, inR) {
    // Input safety check
    if (!isFinite(inL)) inL = 0;
    if (!isFinite(inR)) inR = 0;

    // HPF to remove sub-20Hz
    this.hpfL.setHighpass(25, 0.707, this.sampleRate);
    this.hpfR.setHighpass(25, 0.707, this.sampleRate);
    let wetL = this.hpfL.process(inL);
    let wetR = this.hpfR.process(inR);

    // Noise gate (matches SC Compander with high ratio)
    // SC: gate = LinExp.kr(gate, 0, 0.5, 0.0001, 0.00075) or LinExp.kr(gate, 0.5, 1, 0.00075, 0.05)
    const gateThreshold = this.gate <= 0.5
      ? linexp(this.gate, 0, 0.5, 0.0001, 0.00075)
      : linexp(this.gate, 0.5, 1, 0.00075, 0.05);

    // Update gate envelope
    const absL = Math.abs(wetL);
    const absR = Math.abs(wetR);
    this.gateEnvL += (absL > this.gateEnvL ? this.gateAttack : this.gateRelease) * (absL - this.gateEnvL);
    this.gateEnvR += (absR > this.gateEnvR ? this.gateAttack : this.gateRelease) * (absR - this.gateEnvR);

    // Apply noise gate (downward expansion)
    const gateGainL = this.gateEnvL > gateThreshold ? 1 : Math.pow(this.gateEnvL / Math.max(gateThreshold, 0.0001), 5);
    const gateGainR = this.gateEnvR > gateThreshold ? 1 : Math.pow(this.gateEnvR / Math.max(gateThreshold, 0.0001), 5);
    wetL *= gateGainL;
    wetR *= gateGainR;

    // Sustainer (upward compression via CompanderD)
    // SC: ratio = LinExp.kr(drive, 0, 1, 0.8, 0.1) - lower ratio = more compression
    // SC: threshold = LinLin.kr(drive, 0, 1, 0, 1)
    const ratio = linexp(this.drive, 0, 1, 0.8, 0.1);
    const threshold = linlin(this.drive, 0, 1, 0.001, 0.5);

    // Update sustain envelope (fast attack/release)
    const wetAbsL = Math.abs(wetL);
    const wetAbsR = Math.abs(wetR);
    this.sustainEnvL += (wetAbsL > this.sustainEnvL ? this.sustainAttack : this.sustainRelease) * (wetAbsL - this.sustainEnvL);
    this.sustainEnvR += (wetAbsR > this.sustainEnvR ? this.sustainAttack : this.sustainRelease) * (wetAbsR - this.sustainEnvR);

    // CompanderD-style compression: below threshold, boost; above threshold, normal behavior
    // In SC, CompanderD with ratio < 1 and slopeAbove = 1 creates upward compression
    let gainL = 1;
    let gainR = 1;

    if (this.sustainEnvL > 0.0001) {
      if (this.sustainEnvL < threshold) {
        // Below threshold: boost signal (upward compression)
        // Target level = threshold * (env/threshold)^ratio
        const targetL = threshold * Math.pow(this.sustainEnvL / threshold, ratio);
        gainL = targetL / this.sustainEnvL;
        gainL = Math.min(gainL, 20); // Limit boost to prevent explosion
      }
      // Above threshold: pass through with slight compression
    }

    if (this.sustainEnvR > 0.0001) {
      if (this.sustainEnvR < threshold) {
        const targetR = threshold * Math.pow(this.sustainEnvR / threshold, ratio);
        gainR = targetR / this.sustainEnvR;
        gainR = Math.min(gainR, 20);
      }
    }

    wetL = softclip(wetL * gainL);
    wetR = softclip(wetR * gainR);

    // Tone filter - simple lowpass from 200Hz to 16kHz
    const toneFreq = linexp(this.tone, 0, 1, 200, 16000);
    this.toneL.setCutoff(toneFreq);
    this.toneR.setCutoff(toneFreq);
    this.toneL.setResonance(0);
    this.toneR.setResonance(0);
    wetL = this.toneL.process(wetL);
    wetR = this.toneR.process(wetR);

    // Output safety check
    if (!isFinite(wetL) || !isFinite(wetR)) {
      return [inL, inR];
    }

    return [
      Math.max(-2, Math.min(2, wetL)),
      Math.max(-2, Math.min(2, wetR))
    ];
  }

  reset() {
    this.hpfL.reset();
    this.hpfR.reset();
    this.toneL.reset();
    this.toneR.reset();
    this.toneHpfL.reset();
    this.toneHpfR.reset();
    this.gateEnvL = 0;
    this.gateEnvR = 0;
    this.sustainEnvL = 0;
    this.sustainEnvR = 0;
  }
}


// ============================================================================
// RING MODULATOR EFFECT
// Carrier frequency modulation with waveform morphing
// ============================================================================
class RingModEffect extends Effect {
  static get id() { return 'ringmod'; }
  static get name() { return 'Ring Mod'; }
  static get params() {
    return {
      freq: { min: 20, max: 2000, default: 220, label: 'Frequency' },
      shape: { min: 0, max: 1, default: 0.33, label: 'Shape' },
      tone: { min: 0, max: 1, default: 0.5, label: 'Tone' },
      mix: { min: 0, max: 1, default: 1, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    this.phase = 0;
    this.toneL = new MoogLadder(sampleRate);
    this.toneR = new MoogLadder(sampleRate);
    this.toneHpfL = new Biquad();
    this.toneHpfR = new Biquad();

    this.freq = 220;
    this.shape = 0.33;
    this.tone = 0.5;
    this.mix = 1;
  }

  // Morphing wavetable: sin -> tri -> saw -> square
  getModulator(phase, shape) {
    const twoPi = 2 * Math.PI;

    // Calculate individual waveforms
    const sin = Math.sin(phase * twoPi);
    const tri = 4 * Math.abs((phase % 1) - 0.5) - 1;
    const saw = 2 * (phase % 1) - 1;
    const sqr = phase % 1 < 0.5 ? 1 : -1;

    // Morph based on shape
    if (shape < 0.33) {
      const t = shape / 0.33;
      return sin * (1 - t) + tri * t;
    } else if (shape < 0.67) {
      const t = (shape - 0.33) / 0.34;
      return tri * (1 - t) + saw * t;
    } else {
      const t = (shape - 0.67) / 0.33;
      return saw * (1 - t) + sqr * t;
    }
  }

  processEffect(inL, inR) {
    // Generate modulator
    const mod = this.getModulator(this.phase, this.shape);
    this.phase += this.freq / this.sampleRate;
    if (this.phase >= 1) this.phase -= 1;

    // Ring modulate
    let wetL = inL * mod;
    let wetR = inR * mod;

    // Tone filter (same as overdrive/distortion)
    if (this.tone <= 0.75) {
      const freq = this.tone <= 0.2
        ? linexp(this.tone, 0, 0.2, 100, 800)
        : linexp(this.tone, 0.2, 0.75, 800, 20000);
      this.toneL.setCutoff(freq);
      this.toneR.setCutoff(freq);
      this.toneL.setResonance(0.1);
      this.toneR.setResonance(0.1);
      wetL = softclip(this.toneL.process(wetL));
      wetR = softclip(this.toneR.process(wetR));
    } else {
      const freq = linexp(this.tone, 0.75, 1, 20, 21000);
      this.toneHpfL.setHighpass(freq, 0.707, this.sampleRate);
      this.toneHpfR.setHighpass(freq, 0.707, this.sampleRate);
      wetL = softclip(this.toneHpfL.process(wetL));
      wetR = softclip(this.toneHpfR.process(wetR));
    }

    return [wetL, wetR];
  }

  reset() {
    this.phase = 0;
    this.toneL.reset();
    this.toneR.reset();
    this.toneHpfL.reset();
    this.toneHpfR.reset();
  }
}


// ============================================================================
// PITCH SHIFTER EFFECT
// Granular pitch shifting
// ============================================================================
class PitchShifterEffect extends Effect {
  static get id() { return 'pitchshifter'; }
  static get name() { return 'Pitch Shifter'; }
  static get params() {
    return {
      shift: { min: -12, max: 12, default: 0, label: 'Semitones' },
      drift: { min: 0, max: 1, default: 0.5, label: 'Drift' },
      mix: { min: 0, max: 1, default: 1, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    this.windowSize = 0.25; // 250ms window
    const bufferSize = Math.ceil(this.windowSize * 2 * sampleRate);
    this.bufferL = new Float32Array(bufferSize);
    this.bufferR = new Float32Array(bufferSize);
    this.writeIdx = 0;
    this.grain1Phase = 0;
    this.grain2Phase = 0.5;

    // Smooth noise generators (band-limited random)
    // Use slow LFOs with random offsets for smooth dispersion
    this.noisePhase1 = Math.random();
    this.noisePhase2 = Math.random();
    this.noisePhase3 = Math.random();
    this.noisePhase4 = Math.random();
    this.noiseFreq = 3; // Hz - slow modulation rate

    this.shift = 0;
    this.drift = 0.5;
    this.mix = 1;
  }

  // Generate smooth noise using multiple slow oscillators
  _smoothNoise(phases, freq) {
    const p1 = phases[0] * 2 * Math.PI;
    const p2 = phases[1] * 2 * Math.PI * 1.31; // Irrational ratio
    const p3 = phases[2] * 2 * Math.PI * 1.73; // Different ratio
    return (Math.sin(p1) + Math.sin(p2) * 0.5 + Math.sin(p3) * 0.25) / 1.75;
  }

  processEffect(inL, inR) {
    const bufLen = this.bufferL.length;

    // Write to buffer
    this.bufferL[this.writeIdx] = inL;
    this.bufferR[this.writeIdx] = inR;
    this.writeIdx = (this.writeIdx + 1) % bufLen;

    // Calculate pitch ratio
    const ratio = Math.pow(2, this.shift / 12);

    // Pitch and time dispersion based on drift
    const pitchDisp = this.drift > 0 ? linexp(this.drift, 0, 1, 0.0001, 0.1) : 0;
    const timeDisp = this.drift > 0 ? linexp(this.drift, 0, 1, 0.0001, this.windowSize) : 0;

    // Advance smooth noise phases
    const noiseInc = this.noiseFreq / this.sampleRate;
    this.noisePhase1 = (this.noisePhase1 + noiseInc) % 1;
    this.noisePhase2 = (this.noisePhase2 + noiseInc * 1.13) % 1;
    this.noisePhase3 = (this.noisePhase3 + noiseInc * 0.87) % 1;
    this.noisePhase4 = (this.noisePhase4 + noiseInc * 1.41) % 1;

    // Get smooth noise values for time and pitch jitter
    const timeNoise1 = this._smoothNoise([this.noisePhase1, this.noisePhase2, this.noisePhase3], this.noiseFreq);
    const timeNoise2 = this._smoothNoise([this.noisePhase2, this.noisePhase3, this.noisePhase4], this.noiseFreq);
    const pitchNoise = this._smoothNoise([this.noisePhase3, this.noisePhase4, this.noisePhase1], this.noiseFreq);

    // Process two overlapping grains
    const windowSamples = this.windowSize * this.sampleRate;

    // Grain 1 - use smooth noise instead of Math.random()
    const grain1Offset = Math.floor(this.grain1Phase * windowSamples);
    const jitter1 = timeNoise1 * timeDisp * this.sampleRate;
    const idx1 = (this.writeIdx - windowSamples + grain1Offset + jitter1 + bufLen) % bufLen;
    const idx1Floor = Math.floor(idx1);
    const idx1Frac = idx1 - idx1Floor;
    const env1 = Math.sin(this.grain1Phase * Math.PI);
    const i1 = ((idx1Floor % bufLen) + bufLen) % bufLen;
    const i1next = (i1 + 1) % bufLen;
    const sampleL1 = this.bufferL[i1] * (1 - idx1Frac) + this.bufferL[i1next] * idx1Frac;
    const sampleR1 = this.bufferR[i1] * (1 - idx1Frac) + this.bufferR[i1next] * idx1Frac;

    // Grain 2
    const grain2Offset = Math.floor(this.grain2Phase * windowSamples);
    const jitter2 = timeNoise2 * timeDisp * this.sampleRate;
    const idx2 = (this.writeIdx - windowSamples + grain2Offset + jitter2 + bufLen) % bufLen;
    const idx2Floor = Math.floor(idx2);
    const idx2Frac = idx2 - idx2Floor;
    const env2 = Math.sin(this.grain2Phase * Math.PI);
    const i2 = ((idx2Floor % bufLen) + bufLen) % bufLen;
    const i2next = (i2 + 1) % bufLen;
    const sampleL2 = this.bufferL[i2] * (1 - idx2Frac) + this.bufferL[i2next] * idx2Frac;
    const sampleR2 = this.bufferR[i2] * (1 - idx2Frac) + this.bufferR[i2next] * idx2Frac;

    // Advance grain phases with smooth pitch dispersion
    const phaseIncrement = (ratio - 1) / windowSamples + 1 / windowSamples;
    const pitchJitter = 1 + pitchNoise * pitchDisp;
    this.grain1Phase += phaseIncrement * pitchJitter;
    this.grain2Phase += phaseIncrement * pitchJitter;
    if (this.grain1Phase >= 1) this.grain1Phase -= 1;
    if (this.grain2Phase >= 1) this.grain2Phase -= 1;

    // Mix grains
    const wetL = (sampleL1 * env1 + sampleL2 * env2) / (env1 + env2 + 0.001);
    const wetR = (sampleR1 * env1 + sampleR2 * env2) / (env1 + env2 + 0.001);

    return [wetL, wetR];
  }

  reset() {
    this.bufferL.fill(0);
    this.bufferR.fill(0);
    this.writeIdx = 0;
    this.grain1Phase = 0;
    this.grain2Phase = 0.5;
    this.noisePhase1 = Math.random();
    this.noisePhase2 = Math.random();
    this.noisePhase3 = Math.random();
    this.noisePhase4 = Math.random();
  }
}


// ============================================================================
// SUB BOOST EFFECT
// Sub-octave generator
// ============================================================================
class SubBoostEffect extends Effect {
  static get id() { return 'subboost'; }
  static get name() { return 'Sub Boost'; }
  static get params() {
    return {
      octaves: { min: 1, max: 3, default: 2, label: 'Octaves Down', type: 'select', options: ['1 Oct', '2 Oct', '3 Oct'] },
      shape: { min: 0, max: 1, default: 0.33, label: 'Shape' },
      level: { min: 0, max: 1, default: 0.5, label: 'Level' },
      mix: { min: 0, max: 1, default: 0.5, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    this.sampleRate = sampleRate;
    this.phase = 0;
    this.currentFreq = 110; // Start at A2

    // Pitch detection state
    this.lastSample = 0;
    this.samplesSinceZC = 0;
    this.periodBuffer = new Float32Array(8);
    this.periodIdx = 0;
    this.periodCount = 0;

    // Envelope follower state
    this.envelope = 0;
    this.attackCoef = Math.exp(-1 / (0.005 * sampleRate));
    this.releaseCoef = Math.exp(-1 / (0.1 * sampleRate));

    // Simple lowpass for sub output
    this.lpState = 0;

    this.octaves = 2;
    this.shape = 0.33;
    this.level = 0.5;
    this.mix = 0.5;
  }

  processEffect(inL, inR) {
    const mono = (inL + inR) * 0.5;

    // Simple envelope follower
    const absIn = Math.abs(mono);
    if (absIn > this.envelope) {
      this.envelope = absIn + (this.envelope - absIn) * this.attackCoef;
    } else {
      this.envelope = absIn + (this.envelope - absIn) * this.releaseCoef;
    }

    // Zero-crossing pitch detection
    this.samplesSinceZC++;
    if (this.lastSample < 0 && mono >= 0) {
      // Positive zero crossing
      if (this.samplesSinceZC > 20 && this.samplesSinceZC < this.sampleRate / 20) {
        // Valid period (20Hz to sampleRate/20)
        this.periodBuffer[this.periodIdx] = this.samplesSinceZC;
        this.periodIdx = (this.periodIdx + 1) % this.periodBuffer.length;
        if (this.periodCount < this.periodBuffer.length) this.periodCount++;

        // Calculate average period
        if (this.periodCount >= 3) {
          let sum = 0;
          for (let i = 0; i < this.periodCount; i++) {
            sum += this.periodBuffer[i];
          }
          const avgPeriod = sum / this.periodCount;
          const detectedFreq = this.sampleRate / avgPeriod;

          // Smooth frequency tracking
          if (detectedFreq > 30 && detectedFreq < 2000) {
            this.currentFreq = this.currentFreq * 0.95 + detectedFreq * 0.05;
          }
        }
      }
      this.samplesSinceZC = 0;
    }
    this.lastSample = mono;

    // Calculate sub frequency (drop by octaves)
    const octaveDiv = Math.pow(2, Math.floor(this.octaves));
    let subFreq = this.currentFreq / octaveDiv;

    // Ensure sub is audible (bump up if too low)
    while (subFreq < 25 && subFreq > 0) {
      subFreq *= 2;
    }
    subFreq = Math.max(25, Math.min(subFreq, 150));

    // Generate sub oscillator with shape morphing
    const shape = this.shape;
    let sub;

    // Simple waveform generation
    const p = this.phase;
    const sin = Math.sin(p * 2 * Math.PI);
    const tri = 4 * Math.abs(p - 0.5) - 1;
    const saw = 2 * p - 1;
    const sqr = p < 0.5 ? 1 : -1;

    if (shape < 0.33) {
      const t = shape / 0.33;
      sub = sin * (1 - t) + tri * t;
    } else if (shape < 0.67) {
      const t = (shape - 0.33) / 0.34;
      sub = tri * (1 - t) + saw * t;
    } else {
      const t = (shape - 0.67) / 0.33;
      sub = saw * (1 - t) + sqr * t;
    }

    // Advance phase
    this.phase += subFreq / this.sampleRate;
    if (this.phase >= 1) this.phase -= 1;

    // Simple one-pole lowpass at 200Hz
    const lpCoef = Math.exp(-2 * Math.PI * 200 / this.sampleRate);
    this.lpState = sub * (1 - lpCoef) + this.lpState * lpCoef;
    sub = this.lpState;

    // Apply envelope and level
    // Shape compensation (saw/square are louder)
    const shapeComp = 1 - shape * 0.3;
    const subOut = sub * this.envelope * this.level * shapeComp * 3;

    return [inL + subOut, inR + subOut];
  }

  reset() {
    this.phase = 0;
    this.currentFreq = 110;
    this.lastSample = 0;
    this.samplesSinceZC = 0;
    this.periodBuffer.fill(0);
    this.periodIdx = 0;
    this.periodCount = 0;
    this.envelope = 0;
    this.lpState = 0;
  }
}


// ============================================================================
// LOFI EFFECT
// Combined degradation (noise, wow/flutter, filtering)
// ============================================================================
class LoFiEffect extends Effect {
  static get id() { return 'lofi'; }
  static get name() { return 'Lo-Fi'; }
  static get params() {
    return {
      drive: { min: 0, max: 1, default: 0.5, label: 'Drive' },
      wow: { min: 0, max: 1, default: 0.5, label: 'Wow' },
      noise: { min: 0, max: 1, default: 0.5, label: 'Noise' },
      tone: { min: 0, max: 1, default: 0.5, label: 'Tone' },
      mix: { min: 0, max: 1, default: 1, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    this.hpf = new Biquad();
    this.compL = new Compressor(sampleRate);
    this.compR = new Compressor(sampleRate);

    // Wow/flutter delay
    const maxWowDepth = 35;
    const minWowRate = 0.5;
    const maxDelay = (((Math.pow(2, maxWowDepth / 1200)) - 1) / (4 * minWowRate)) * 2.5;
    this.delayL = new DelayLine(Math.ceil(maxDelay * sampleRate) + 128);
    this.delayR = new DelayLine(Math.ceil(maxDelay * sampleRate) + 128);
    this.wowPhase = 0;
    this.depthLfoPhase = 0;

    // Decimator
    this.decimator = new Decimator();

    // Tone filters
    this.lpfL = new Biquad();
    this.lpfR = new Biquad();
    this.hpfToneL = new Biquad();
    this.hpfToneR = new Biquad();
    this.moogL = new MoogLadder(sampleRate);
    this.moogR = new MoogLadder(sampleRate);

    // Noise state
    this.noiseL = 0;
    this.noiseR = 0;
    this.crackleState = 1.5;

    this.drive = 0.5;
    this.wow = 0.5;
    this.noise = 0.5;
    this.tone = 0.5;
    this.mix = 1;
  }

  // Pink noise approximation
  pinkNoise() {
    return (Math.random() * 2 - 1) * 0.5;
  }

  // Crackle noise (based on SC Crackle)
  crackle() {
    const y = Math.abs(1.95 * this.crackleState - 1.95 * this.crackleState * this.crackleState - 0.05);
    this.crackleState = y;
    return y * 0.1;
  }

  processEffect(inL, inR) {
    // Input safety check
    if (!isFinite(inL)) inL = 0;
    if (!isFinite(inR)) inR = 0;

    // HPF to remove sub-20Hz
    this.hpf.setHighpass(25, 0.707, this.sampleRate);
    let wetL = this.hpf.process(inL);
    let wetR = this.hpf.process(inR);

    // Compression (matches SC: slow attack/release, aggressive ratio)
    const ratio = linexp(this.drive, 0, 1, 0.15, 0.01);
    const threshold = linlin(this.drive, 0, 1, 0.8, 0.33);
    // Gain calculation to maintain level (matches SC)
    const denominator = ((1 - threshold) * ratio) + threshold;
    const gain = denominator > 0 ? 1 / denominator : 1;
    this.compL.setParams(threshold, 1/Math.max(0.01, ratio), 100, 1000, gain);
    this.compR.setParams(threshold, 1/Math.max(0.01, ratio), 100, 1000, gain);
    wetL = Math.max(-1, Math.min(1, this.compL.process(wetL)));
    wetR = Math.max(-1, Math.min(1, this.compR.process(wetR)));

    // Wow/flutter (matches SC DelayC with modulated delay time)
    const minWowRate = 0.5;
    const wowRate = linexp(this.wow, 0, 1, minWowRate, 4);
    const maxDepth = 35;
    const maxLfoDepth = 5;
    let depth = linexp(this.wow, 0, 1, 1, maxDepth - maxLfoDepth);
    const depthLfoAmount = Math.floor(linlin(this.wow, 0, 1, 1, maxLfoDepth));

    // Depth modulation (matches SC: LFPar for depth LFO)
    const depthMod = Math.sin(this.depthLfoPhase * 2 * Math.PI) * depthLfoAmount;
    this.depthLfoPhase += (depthLfoAmount * 0.1) / this.sampleRate;
    if (this.depthLfoPhase >= 1) this.depthLfoPhase -= 1;
    depth += depthMod;

    // Calculate wow modulation (matches SC formula)
    const wowMulDenom = 4 * wowRate;
    const wowMul = wowMulDenom > 0 ? ((Math.pow(2, depth / 1200)) - 1) / wowMulDenom : 0;
    const wowLfo = Math.sin(this.wowPhase * 2 * Math.PI);
    this.wowPhase += wowRate / this.sampleRate;
    if (this.wowPhase >= 1) this.wowPhase -= 1;

    // Calculate delay samples with safety bounds
    let delaySamples = (wowLfo * wowMul + wowMul + 1 / this.sampleRate) * this.sampleRate;
    if (!isFinite(delaySamples) || delaySamples < 1) delaySamples = 1;
    delaySamples = Math.min(delaySamples, this.delayL.length - 3);

    this.delayL.write(wetL);
    this.delayR.write(wetR);
    wetL = this.delayL.readCubic(delaySamples);
    wetR = this.delayR.readCubic(delaySamples);

    // Noise (matches SC: Dust2 + Crackle + filtered PinkNoise)
    const noiseLevel = linexp(this.noise, 0, 1, 0.01, 1);
    const dustRate = linlin(this.noise, 0, 1, 1, 5);
    const dust = Math.random() < dustRate / this.sampleRate ? (Math.random() * 2 - 1) : 0;
    const crackle = this.crackle();
    const hum = Math.sin(this.wowPhase * 40 * 2 * Math.PI) * 0.006;
    const noiseSignal = (dust + crackle + hum + this.pinkNoise() * 0.1) * noiseLevel;

    // Saturation with noise (matches SC: tanh)
    wetL = Math.tanh((wetL * linexp(this.drive, 0, 1, 1, 2.5)) + noiseSignal);
    wetR = Math.tanh((wetR * linexp(this.drive, 0, 1, 1, 2.5)) + noiseSignal);

    // LPF based on tone
    const lpfFreq = linexp(this.tone, 0, 1, 2500, 10000);
    this.lpfL.setLowpass(Math.max(20, lpfFreq), 0.707, this.sampleRate);
    this.lpfR.setLowpass(Math.max(20, lpfFreq), 0.707, this.sampleRate);
    wetL = this.lpfL.process(wetL);
    wetR = this.lpfR.process(wetR);

    // Bit crushing based on noise (matches SC: Decimator)
    const bitRate = Math.ceil(linlin(this.noise, 0, 1, 0, 3));
    if (bitRate > 0) {
      const targetSR = 48000 / bitRate;
      const rate = Math.max(0.01, Math.min(1, targetSR / this.sampleRate));
      this.decimator.setRate(rate);
      this.decimator.setBits(linexp(this.noise, 0, 1, 24, 6));
      const [decL, decR] = this.decimator.process(wetL, wetR);
      if (isFinite(decL) && isFinite(decR)) {
        wetL = decL * 0.3 + wetL * 0.7;
        wetR = decR * 0.3 + wetR * 0.7;
      }
    }

    // HPF based on tone
    const hpfFreq = linexp(this.tone, 0, 1, 40, 1690);
    this.hpfToneL.setHighpass(Math.max(20, hpfFreq), 0.707, this.sampleRate);
    this.hpfToneR.setHighpass(Math.max(20, hpfFreq), 0.707, this.sampleRate);
    wetL = this.hpfToneL.process(wetL);
    wetR = this.hpfToneR.process(wetR);

    // Moog filter (matches SC: MoogFF)
    const moogFreq = linexp(this.tone, 0, 1, 1000, 10000);
    this.moogL.setCutoff(Math.max(20, moogFreq));
    this.moogR.setCutoff(Math.max(20, moogFreq));
    wetL = this.moogL.process(wetL);
    wetR = this.moogR.process(wetR);

    // Output level compensation
    wetL *= linlin(this.drive, 0, 1, 1, 0.66);
    wetR *= linlin(this.drive, 0, 1, 1, 0.66);

    // Output safety check
    if (!isFinite(wetL) || !isFinite(wetR)) {
      return [inL, inR];
    }

    return [
      Math.max(-2, Math.min(2, wetL)),
      Math.max(-2, Math.min(2, wetR))
    ];
  }

  reset() {
    this.hpf.reset();
    this.compL.reset();
    this.compR.reset();
    this.delayL.clear();
    this.delayR.clear();
    this.decimator.reset();
    this.lpfL.reset();
    this.lpfR.reset();
    this.hpfToneL.reset();
    this.hpfToneR.reset();
    this.moogL.reset();
    this.moogR.reset();
    this.wowPhase = 0;
    this.depthLfoPhase = 0;
    this.crackleState = 1.5;
  }
}


// ============================================================================
// EQUALIZER EFFECT
// 3-band parametric EQ
// ============================================================================
class EqualizerEffect extends Effect {
  static get id() { return 'equalizer'; }
  static get name() { return 'Equalizer'; }
  static get params() {
    return {
      lowFreq: { min: 40, max: 400, default: 70, label: 'Low Freq' },
      lowGain: { min: -12, max: 12, default: 0, label: 'Low Gain' },
      midFreq: { min: 200, max: 5000, default: 1000, label: 'Mid Freq' },
      midQ: { min: 0.5, max: 4, default: 1, label: 'Mid Q' },
      midGain: { min: -12, max: 12, default: 0, label: 'Mid Gain' },
      highFreq: { min: 2000, max: 12000, default: 5000, label: 'High Freq' },
      highGain: { min: -12, max: 12, default: 0, label: 'High Gain' },
      mix: { min: 0, max: 1, default: 1, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    this.lowShelfL = new Biquad();
    this.lowShelfR = new Biquad();
    this.midPeakL = new Biquad();
    this.midPeakR = new Biquad();
    this.highShelfL = new Biquad();
    this.highShelfR = new Biquad();

    this.lowFreq = 70;
    this.lowGain = 0;
    this.midFreq = 1000;
    this.midQ = 1;
    this.midGain = 0;
    this.highFreq = 5000;
    this.highGain = 0;
    this.mix = 1;
  }

  processEffect(inL, inR) {
    // Input safety check
    if (!isFinite(inL)) inL = 0;
    if (!isFinite(inR)) inR = 0;

    // Low shelf (matches SC BLowShelf)
    this.lowShelfL.setLowShelf(this.lowFreq, this.lowGain, this.sampleRate);
    this.lowShelfR.setLowShelf(this.lowFreq, this.lowGain, this.sampleRate);
    let wetL = this.lowShelfL.process(inL);
    let wetR = this.lowShelfR.process(inR);

    // Mid peak EQ (matches SC BPeakEQ)
    this.midPeakL.setPeakEQ(this.midFreq, this.midQ, this.midGain, this.sampleRate);
    this.midPeakR.setPeakEQ(this.midFreq, this.midQ, this.midGain, this.sampleRate);
    wetL = this.midPeakL.process(wetL);
    wetR = this.midPeakR.process(wetR);

    // High shelf (matches SC BHiShelf)
    this.highShelfL.setHighShelf(this.highFreq, this.highGain, this.sampleRate);
    this.highShelfR.setHighShelf(this.highFreq, this.highGain, this.sampleRate);
    wetL = this.highShelfL.process(wetL);
    wetR = this.highShelfR.process(wetR);

    // Output safety check
    if (!isFinite(wetL) || !isFinite(wetR)) {
      return [inL, inR];
    }

    return [
      Math.max(-2, Math.min(2, wetL)),
      Math.max(-2, Math.min(2, wetR))
    ];
  }

  reset() {
    this.lowShelfL.reset();
    this.lowShelfR.reset();
    this.midPeakL.reset();
    this.midPeakR.reset();
    this.highShelfL.reset();
    this.highShelfR.reset();
  }
}


// ============================================================================
// AMP SIMULATOR EFFECT
// Cabinet simulation with EQ and room
// ============================================================================
class AmpSimulatorEffect extends Effect {
  static get id() { return 'ampsimulator'; }
  static get name() { return 'Amp Simulator'; }
  static get params() {
    return {
      drive: { min: 0, max: 1, default: 0.5, label: 'Drive' },
      bass: { min: -12, max: 12, default: 0, label: 'Bass' },
      mid: { min: -12, max: 12, default: 0, label: 'Mid' },
      treble: { min: -12, max: 12, default: 0, label: 'Treble' },
      presence: { min: 0, max: 1, default: 0.5, label: 'Presence' },
      room: { min: 0, max: 1, default: 0.5, label: 'Room' },
      mix: { min: 0, max: 1, default: 1, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    // Pre EQ
    this.preShelf1L = new Biquad();
    this.preShelf1R = new Biquad();
    this.preShelf2L = new Biquad();
    this.preShelf2R = new Biquad();
    this.preShelf3L = new Biquad();
    this.preShelf3R = new Biquad();

    // Tone section
    this.bassL = new Biquad();
    this.bassR = new Biquad();
    this.midL = new Biquad();
    this.midR = new Biquad();
    this.trebleL = new Biquad();
    this.trebleR = new Biquad();
    this.presenceL = new Biquad();
    this.presenceR = new Biquad();

    // Post EQ (harsh frequency removal)
    this.postPeak1L = new Biquad();
    this.postPeak1R = new Biquad();
    this.postPeak2L = new Biquad();
    this.postPeak2R = new Biquad();

    // Simple reverb
    this.reverbL = new AllpassFilter(Math.floor(0.035 * sampleRate));
    this.reverbR = new AllpassFilter(Math.floor(0.037 * sampleRate));
    this.reverbL2 = new AllpassFilter(Math.floor(0.012 * sampleRate));
    this.reverbR2 = new AllpassFilter(Math.floor(0.013 * sampleRate));

    // DC blocker
    this.dcL = new DCBlocker();
    this.dcR = new DCBlocker();

    this.drive = 0.5;
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.presence = 0.5;
    this.room = 0.5;
    this.mix = 1;
  }

  // Marshall JCM800-style transfer function
  transferFunction(x) {
    if (x <= -1) return -0.9818;
    if (x < -0.08905) {
      return (-0.75 * (1 - Math.pow(1 - (Math.abs(x) - 0.029847), 12) + (0.333 * (Math.abs(x) - 0.029847)))) + 0.01;
    }
    if (x < 0.320018) {
      return (-6.153 * x * x) + (3.9375 * x);
    }
    return 0.6140341 + (0.05 * x);
  }

  processEffect(inL, inR) {
    // Pre low-shelf filters
    this.preShelf1L.setLowShelf(720, -3.3, this.sampleRate);
    this.preShelf1R.setLowShelf(720, -3.3, this.sampleRate);
    this.preShelf2L.setLowShelf(320, -5, this.sampleRate);
    this.preShelf2R.setLowShelf(320, -5, this.sampleRate);

    let wetL = this.preShelf1L.process(inL);
    let wetR = this.preShelf1R.process(inR);
    wetL = this.preShelf2L.process(wetL);
    wetR = this.preShelf2R.process(wetR);

    // Apply transfer function with drive crossfade
    const asymL = this.transferFunction(wetL);
    const asymR = this.transferFunction(wetR);
    const driveMix = linlin(this.drive, 0, 1, -1, 1);
    wetL = wetL * (1 - (driveMix + 1) / 2) + asymL * ((driveMix + 1) / 2);
    wetR = wetR * (1 - (driveMix + 1) / 2) + asymR * ((driveMix + 1) / 2);

    // DC block
    wetL = this.dcL.process(wetL);
    wetR = this.dcR.process(wetR);

    // Another low shelf and saturation
    this.preShelf3L.setLowShelf(720, -6, this.sampleRate);
    this.preShelf3R.setLowShelf(720, -6, this.sampleRate);
    wetL = this.preShelf3L.process(wetL);
    wetR = this.preShelf3R.process(wetR);
    const driveGain = linlin(this.drive, 0, 1, 1.5, 3.5);
    wetL = Math.tanh(wetL * driveGain);
    wetR = Math.tanh(wetR * driveGain);

    // Tone section
    this.bassL.setLowShelf(100, this.bass, this.sampleRate);
    this.bassR.setLowShelf(100, this.bass, this.sampleRate);
    wetL = this.bassL.process(wetL);
    wetR = this.bassR.process(wetR);

    this.midL.setPeakEQ(1700, 0.707, this.mid, this.sampleRate);
    this.midR.setPeakEQ(1700, 0.707, this.mid, this.sampleRate);
    wetL = this.midL.process(wetL);
    wetR = this.midR.process(wetR);

    this.trebleL.setHighShelf(6500, this.treble, this.sampleRate);
    this.trebleR.setHighShelf(6500, this.treble, this.sampleRate);
    wetL = this.trebleL.process(wetL);
    wetR = this.trebleR.process(wetR);

    const presenceDb = linlin(this.presence, 0, 1, -12, 12);
    this.presenceL.setPeakEQ(3900, 1, presenceDb, this.sampleRate);
    this.presenceR.setPeakEQ(3900, 1, presenceDb, this.sampleRate);
    wetL = this.presenceL.process(wetL);
    wetR = this.presenceR.process(wetR);

    // Filter harsh frequencies
    this.postPeak1L.setPeakEQ(10000, 1, -25, this.sampleRate);
    this.postPeak1R.setPeakEQ(10000, 1, -25, this.sampleRate);
    this.postPeak2L.setPeakEQ(60, 1, -19, this.sampleRate);
    this.postPeak2R.setPeakEQ(60, 1, -19, this.sampleRate);
    wetL = this.postPeak1L.process(wetL);
    wetR = this.postPeak1R.process(wetR);
    wetL = this.postPeak2L.process(wetL);
    wetR = this.postPeak2R.process(wetR);

    // Simple room reverb
    const reverbMix = linexp(this.room, 0, 1, 0.2, 0.8);
    const feedback = linexp(this.room, 0, 1, 0.2, 0.8);
    this.reverbL.setFeedback(feedback);
    this.reverbR.setFeedback(feedback);
    this.reverbL2.setFeedback(feedback * 0.7);
    this.reverbR2.setFeedback(feedback * 0.7);

    const revL = this.reverbL2.process(this.reverbL.process(wetL));
    const revR = this.reverbR2.process(this.reverbR.process(wetR));

    wetL = wetL * (1 - reverbMix) + revL * reverbMix;
    wetR = wetR * (1 - reverbMix) + revR * reverbMix;

    return [wetL, wetR];
  }

  reset() {
    this.preShelf1L.reset(); this.preShelf1R.reset();
    this.preShelf2L.reset(); this.preShelf2R.reset();
    this.preShelf3L.reset(); this.preShelf3R.reset();
    this.bassL.reset(); this.bassR.reset();
    this.midL.reset(); this.midR.reset();
    this.trebleL.reset(); this.trebleR.reset();
    this.presenceL.reset(); this.presenceR.reset();
    this.postPeak1L.reset(); this.postPeak1R.reset();
    this.postPeak2L.reset(); this.postPeak2R.reset();
    this.reverbL.clear(); this.reverbR.clear();
    this.reverbL2.clear(); this.reverbR2.clear();
    this.dcL.reset(); this.dcR.reset();
  }
}


// ============================================================================
// RINGS EFFECT (MI Rings-inspired modal resonator)
// Modal/sympathetic string resonator
// ============================================================================
class RingsEffect extends Effect {
  static get id() { return 'rings'; }
  static get name() { return 'Rings'; }
  static get params() {
    return {
      pitch: { min: 24, max: 96, default: 60, label: 'Pitch' },
      structure: { min: 0, max: 1, default: 0.36, label: 'Structure' },
      brightness: { min: 0, max: 1, default: 0.5, label: 'Brightness' },
      damping: { min: 0, max: 1, default: 0.5, label: 'Damping' },
      position: { min: 0, max: 1, default: 0.33, label: 'Position' },
      polyphony: { min: 1, max: 4, default: 4, label: 'Polyphony' },
      mix: { min: 0, max: 1, default: 0.5, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    // Modal resonator bank - use more modes for richer sound
    this.numModes = 24;
    this.modes = [];
    for (let i = 0; i < this.numModes; i++) {
      this.modes.push({
        // Resonant state for each mode (2-pole resonator)
        y1: 0,
        y2: 0,
        freq: 440,
        amp: 0,
        decay: 0.999,
        cos_w: 0,
        r: 0.999
      });
    }

    // Output filters for brightness
    this.lpfL = new Biquad();
    this.lpfR = new Biquad();

    this.pitch = 60;
    this.structure = 0.36;
    this.brightness = 0.5;
    this.damping = 0.5;
    this.position = 0.33;
    this.polyphony = 4;
    this.mix = 0.5;

    this._lastPitch = -1;
    this._lastStructure = -1;
    this._lastDamping = -1;
    this._lastPosition = -1;
    this._lastBrightness = -1;
  }

  // Modal frequency ratios for different structure settings
  _getModalRatios(structure) {
    // Interpolate between different resonator types
    // structure 0 = string-like (harmonic)
    // structure 0.5 = bar/plate-like (inharmonic)
    // structure 1 = bell-like (very inharmonic)

    const ratios = [];
    for (let i = 0; i < this.numModes; i++) {
      const n = i + 1;
      if (structure < 0.33) {
        // String-like: mostly harmonic with slight stretch
        const stretch = 1 + structure * 0.0003 * n * n;
        ratios.push(n * stretch);
      } else if (structure < 0.66) {
        // Bar/plate-like: sqrt(n*(n+1)) pattern
        const t = (structure - 0.33) / 0.33;
        const harmonic = n * (1 + structure * 0.0003 * n * n);
        const bar = Math.sqrt(n * (n + 1)) * 0.7;
        ratios.push(harmonic * (1 - t) + bar * t);
      } else {
        // Bell-like: more complex inharmonic spectrum
        const t = (structure - 0.66) / 0.34;
        const bar = Math.sqrt(n * (n + 1)) * 0.7;
        const bell = Math.pow(n, 1.2 + t * 0.5) * 0.5;
        ratios.push(bar * (1 - t) + bell * t);
      }
    }
    return ratios;
  }

  // Update modal parameters when controls change
  _updateModes() {
    if (this.pitch === this._lastPitch &&
        this.structure === this._lastStructure &&
        this.damping === this._lastDamping &&
        this.position === this._lastPosition &&
        this.brightness === this._lastBrightness) {
      return;
    }

    this._lastPitch = this.pitch;
    this._lastStructure = this.structure;
    this._lastDamping = this.damping;
    this._lastPosition = this.position;
    this._lastBrightness = this.brightness;

    const baseFreq = 440 * Math.pow(2, (this.pitch - 69) / 12);
    const ratios = this._getModalRatios(this.structure);

    // Decay time based on damping (0 = long decay, 1 = short decay)
    const decayTime = linexp(1 - this.damping, 0, 1, 0.05, 8);

    for (let i = 0; i < this.numModes; i++) {
      const mode = this.modes[i];
      const freq = baseFreq * ratios[i];

      // Skip modes above Nyquist
      if (freq > this.sampleRate * 0.45) {
        mode.amp = 0;
        continue;
      }

      mode.freq = freq;

      // Resonator coefficients
      const w = 2 * Math.PI * freq / this.sampleRate;
      mode.cos_w = Math.cos(w);

      // Decay coefficient - higher modes decay faster
      const modeDecayTime = decayTime / (1 + i * 0.1);
      const samplesPerDecay = modeDecayTime * this.sampleRate;
      mode.r = Math.pow(0.001, 1 / samplesPerDecay);
      mode.r = Math.min(0.9999, mode.r);

      // Amplitude based on excitation position (like striking a string at different points)
      // position 0 = end (less harmonics), position 0.5 = center (odd harmonics), position 1 = other end
      const positionAngle = Math.PI * (i + 1) * (this.position * 0.9 + 0.05);
      const positionEffect = Math.abs(Math.sin(positionAngle));

      // Higher modes get less amplitude (natural rolloff)
      const rolloff = 1 / Math.sqrt(i + 1);

      // Brightness affects high mode amplitudes
      const brightnessRolloff = Math.pow(this.brightness, i * 0.1);

      mode.amp = positionEffect * rolloff * brightnessRolloff;
    }

    // Output lowpass based on brightness
    const lpFreq = linexp(this.brightness, 0, 1, 1000, 18000);
    this.lpfL.setLowpass(lpFreq, 0.707, this.sampleRate);
    this.lpfR.setLowpass(lpFreq, 0.707, this.sampleRate);
  }

  processEffect(inL, inR) {
    this._updateModes();

    const mono = (inL + inR) * 0.5;

    // Limit input to prevent overdriving resonators
    // The resonators are very sensitive to input level
    const limitedInput = Math.tanh(mono * 0.5) * 0.3;

    let outL = 0;
    let outR = 0;

    // Number of active modes based on polyphony setting
    const numActive = Math.min(this.numModes, Math.max(4, Math.floor(this.polyphony) * 6));

    // Accumulate total mode energy for normalization
    let totalEnergy = 0;

    for (let i = 0; i < numActive; i++) {
      const mode = this.modes[i];
      if (mode.amp < 0.001) continue;

      // 2-pole resonator: y[n] = x[n] + 2*r*cos(w)*y[n-1] - r^2*y[n-2]
      const r = mode.r;
      const cos_w = mode.cos_w;

      // Scale input for this mode
      const excitation = limitedInput * mode.amp;

      // Bandpass resonator with feedback
      const y0 = excitation + 2 * r * cos_w * mode.y1 - r * r * mode.y2;

      // Prevent runaway by soft-limiting the state
      const clampedY0 = Math.tanh(y0 * 0.5) * 2;

      mode.y2 = mode.y1;
      mode.y1 = clampedY0;

      // Track energy for normalization
      totalEnergy += Math.abs(clampedY0);

      // Stereo spread - alternate modes left/right with some center
      const panAngle = (i * 0.7 + this.position) * Math.PI;
      const panL = 0.5 + 0.4 * Math.cos(panAngle);
      const panR = 0.5 + 0.4 * Math.sin(panAngle);

      outL += clampedY0 * panL;
      outR += clampedY0 * panR;
    }

    // Normalize by number of contributing modes to prevent buildup
    const normalizer = 1 / Math.max(1, Math.sqrt(numActive * 0.5));
    outL *= normalizer;
    outR *= normalizer;

    // Apply brightness filter
    outL = this.lpfL.process(outL);
    outR = this.lpfR.process(outR);

    // Final soft limiting for clean output
    outL = Math.tanh(outL * 1.5);
    outR = Math.tanh(outR * 1.5);

    return [outL, outR];
  }

  reset() {
    for (const mode of this.modes) {
      mode.y1 = 0;
      mode.y2 = 0;
    }
    this.lpfL.reset();
    this.lpfR.reset();
    this._lastPitch = -1;
  }
}


// ============================================================================
// CLOUDS EFFECT (MI Clouds-inspired granular processor)
// Granular texture processor with freeze
// ============================================================================
class CloudsEffect extends Effect {
  static get id() { return 'clouds'; }
  static get name() { return 'Clouds'; }
  static get params() {
    return {
      position: { min: 0, max: 1, default: 0.5, label: 'Position' },
      size: { min: 0, max: 1, default: 0.5, label: 'Size' },
      pitch: { min: -12, max: 12, default: 0, label: 'Pitch' },
      density: { min: 0, max: 1, default: 0.33, label: 'Density' },
      texture: { min: 0, max: 1, default: 0.5, label: 'Texture' },
      feedback: { min: 0, max: 1, default: 0.2, label: 'Feedback' },
      reverb: { min: 0, max: 1, default: 0, label: 'Reverb' },
      freeze: { min: 0, max: 1, default: 0, label: 'Freeze', type: 'toggle' },
      mix: { min: 0, max: 1, default: 0.5, label: 'Mix' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    // Grain buffer (4 seconds)
    const bufferTime = 4;
    this.bufferSize = Math.ceil(bufferTime * sampleRate);
    this.bufferL = new Float32Array(this.bufferSize);
    this.bufferR = new Float32Array(this.bufferSize);
    this.writeIdx = 0;

    // Grains
    this.numGrains = 8;
    this.grains = [];
    for (let i = 0; i < this.numGrains; i++) {
      this.grains.push({
        active: false,
        position: 0,
        size: 0,
        phase: 0,
        pitch: 1,
        panL: 0.5,
        panR: 0.5
      });
    }
    this.grainSpawnTimer = 0;

    // Reverb (4-stage allpass diffuser + 4 comb filters for density)
    // Allpass diffuser network
    this.allpassL = [
      new AllpassFilter(Math.floor(0.0297 * sampleRate)),
      new AllpassFilter(Math.floor(0.0113 * sampleRate)),
      new AllpassFilter(Math.floor(0.0371 * sampleRate)),
      new AllpassFilter(Math.floor(0.0411 * sampleRate))
    ];
    this.allpassR = [
      new AllpassFilter(Math.floor(0.0311 * sampleRate)),
      new AllpassFilter(Math.floor(0.0127 * sampleRate)),
      new AllpassFilter(Math.floor(0.0379 * sampleRate)),
      new AllpassFilter(Math.floor(0.0437 * sampleRate))
    ];
    // Parallel comb filters for reverb tail
    this.combL = [
      new DelayLine(Math.floor(0.0531 * sampleRate)),
      new DelayLine(Math.floor(0.0619 * sampleRate)),
      new DelayLine(Math.floor(0.0703 * sampleRate)),
      new DelayLine(Math.floor(0.0797 * sampleRate))
    ];
    this.combR = [
      new DelayLine(Math.floor(0.0557 * sampleRate)),
      new DelayLine(Math.floor(0.0647 * sampleRate)),
      new DelayLine(Math.floor(0.0731 * sampleRate)),
      new DelayLine(Math.floor(0.0823 * sampleRate))
    ];
    this.combStateL = [0, 0, 0, 0];
    this.combStateR = [0, 0, 0, 0];
    this.combDelays = [0.0531, 0.0619, 0.0703, 0.0797]; // seconds
    this.reverbDampL = new Biquad();
    this.reverbDampR = new Biquad();

    this.position = 0.5;
    this.size = 0.5;
    this.pitch = 0;
    this.density = 0.33;
    this.texture = 0.5;
    this.feedback = 0.2;
    this.reverb = 0;
    this.freeze = 0;
    this.mix = 0.5;

    this.feedbackL = 0;
    this.feedbackR = 0;
  }

  // Hann window
  window(phase) {
    return 0.5 * (1 - Math.cos(2 * Math.PI * phase));
  }

  spawnGrain() {
    // Find inactive grain
    for (const grain of this.grains) {
      if (!grain.active) {
        // Size in samples (10ms to 500ms)
        const sizeMs = linexp(this.size, 0, 1, 10, 500);
        grain.size = Math.floor(sizeMs * this.sampleRate / 1000);

        // Position with some randomness based on texture
        // Position is relative to write head, going backwards in time
        const posJitter = this.texture * 0.3;
        const posOffset = this.position * 0.9 + 0.05; // Keep away from write head
        const pos = posOffset + (Math.random() - 0.5) * posJitter;

        // Calculate absolute position in buffer (going back from write head)
        const samplesBack = Math.floor(pos * this.bufferSize * 0.9); // Leave some margin
        grain.position = (this.writeIdx - samplesBack - grain.size + this.bufferSize) % this.bufferSize;
        if (grain.position < 0) grain.position += this.bufferSize;

        // Pitch with slight random variation based on texture
        const pitchJitter = this.texture * 0.1;
        grain.pitch = Math.pow(2, (this.pitch + (Math.random() - 0.5) * pitchJitter) / 12);

        // Random pan spread based on texture
        const spread = this.texture * 0.5;
        const pan = (Math.random() - 0.5) * spread;
        grain.panL = 0.7 - pan * 0.4;
        grain.panR = 0.7 + pan * 0.4;

        grain.phase = 0;
        grain.active = true;
        break;
      }
    }
  }

  processEffect(inL, inR) {
    // Write to buffer (unless frozen)
    if (this.freeze < 0.5) {
      // Apply soft feedback limiting
      const fbL = Math.tanh(this.feedbackL * this.feedback);
      const fbR = Math.tanh(this.feedbackR * this.feedback);
      this.bufferL[this.writeIdx] = inL + fbL;
      this.bufferR[this.writeIdx] = inR + fbR;
      this.writeIdx = (this.writeIdx + 1) % this.bufferSize;
    }

    // Spawn grains based on density
    const spawnRate = linexp(this.density, 0, 1, 0.5, 50);
    this.grainSpawnTimer += spawnRate / this.sampleRate;
    while (this.grainSpawnTimer >= 1) {
      this.spawnGrain();
      this.grainSpawnTimer -= 1;
    }

    // Process grains
    let outL = 0;
    let outR = 0;
    let activeCount = 0;

    for (const grain of this.grains) {
      if (grain.active) {
        activeCount++;

        // Read from buffer with interpolation
        let readPos = grain.position + grain.phase * grain.pitch;
        while (readPos >= this.bufferSize) readPos -= this.bufferSize;
        while (readPos < 0) readPos += this.bufferSize;

        const idx0 = Math.floor(readPos);
        const idx1 = (idx0 + 1) % this.bufferSize;
        const frac = readPos - idx0;

        const sampleL = this.bufferL[idx0] * (1 - frac) + this.bufferL[idx1] * frac;
        const sampleR = this.bufferR[idx0] * (1 - frac) + this.bufferR[idx1] * frac;

        // Apply window
        const windowPhase = Math.min(1, Math.max(0, grain.phase / grain.size));
        const env = this.window(windowPhase);

        outL += sampleL * env * grain.panL;
        outR += sampleR * env * grain.panR;

        // Advance grain
        grain.phase += 1;
        if (grain.phase >= grain.size) {
          grain.active = false;
        }
      }
    }

    // Normalize output (overlap-add gain compensation)
    if (activeCount > 0) {
      const normFactor = 1.0 / Math.sqrt(Math.max(1, activeCount * 0.5));
      outL *= normFactor;
      outR *= normFactor;
    }

    // Store for feedback
    this.feedbackL = outL;
    this.feedbackR = outR;

    // Reverb - Freeverb-style with allpass diffusers and parallel combs
    if (this.reverb > 0.01) {
      // Set allpass feedback coefficients
      for (const ap of this.allpassL) ap.setFeedback(0.5);
      for (const ap of this.allpassR) ap.setFeedback(0.5);

      // Pass through allpass diffuser chain
      let diffuseL = outL;
      let diffuseR = outR;
      for (let i = 0; i < this.allpassL.length; i++) {
        diffuseL = this.allpassL[i].process(diffuseL);
        diffuseR = this.allpassR[i].process(diffuseR);
      }

      // Parallel comb filters with damping
      // Feedback coefficient based on reverb amount (0.7 to 0.95)
      const combFb = 0.7 + this.reverb * 0.25;
      // Damping filter cutoff (darker reverb at higher reverb amounts)
      const dampFreq = linexp(1 - this.reverb * 0.5, 0, 1, 2000, 12000);
      this.reverbDampL.setLowpass(dampFreq, 0.707, this.sampleRate);
      this.reverbDampR.setLowpass(dampFreq, 0.707, this.sampleRate);

      let combOutL = 0;
      let combOutR = 0;

      for (let i = 0; i < this.combL.length; i++) {
        // Read from comb delay
        const delayL = this.combL[i].readLinear(this.combDelays[i] * this.sampleRate);
        const delayR = this.combR[i].readLinear(this.combDelays[i] * this.sampleRate);

        // Lowpass the feedback for damping
        const dampedL = delayL * combFb;
        const dampedR = delayR * combFb;

        // Write input + feedback
        this.combL[i].write(diffuseL + dampedL);
        this.combR[i].write(diffuseR + dampedR);

        combOutL += delayL;
        combOutR += delayR;
      }

      // Normalize comb output
      combOutL *= 0.25;
      combOutR *= 0.25;

      // Apply final damping
      const revL = this.reverbDampL.process(combOutL);
      const revR = this.reverbDampR.process(combOutR);

      // Mix dry and wet
      outL = outL * (1 - this.reverb) + revL * this.reverb;
      outR = outR * (1 - this.reverb) + revR * this.reverb;
    }

    return [outL, outR];
  }

  reset() {
    this.bufferL.fill(0);
    this.bufferR.fill(0);
    this.writeIdx = 0;
    for (const grain of this.grains) {
      grain.active = false;
    }
    this.grainSpawnTimer = 0;
    this.feedbackL = 0;
    this.feedbackR = 0;
    for (const ap of this.allpassL) ap.clear();
    for (const ap of this.allpassR) ap.clear();
    for (const comb of this.combL) comb.clear();
    for (const comb of this.combR) comb.clear();
    this.combStateL.fill(0);
    this.combStateR.fill(0);
    this.reverbDampL.reset();
    this.reverbDampR.reset();
  }
}


// ============================================================================
// MASTER GAIN EFFECT
// Simple volume boost/cut with soft limiting
// ============================================================================
class MasterGainEffect extends Effect {
  static get id() { return 'mastergain'; }
  static get name() { return 'Master Gain'; }
  static get params() {
    return {
      gain: { min: -24, max: 24, default: 0, label: 'Gain (dB)' },
      limiter: { min: 0, max: 1, default: 1, label: 'Limiter' }
    };
  }

  constructor(sampleRate) {
    super(sampleRate);
    this.gain = 0;
    this.limiter = 1;
    this.currentGain = 1; // For smoothing
  }

  processEffect(inL, inR) {
    // Convert dB to linear gain
    const targetGain = Math.pow(10, this.gain / 20);

    // Smooth gain changes to avoid clicks
    this.currentGain += (targetGain - this.currentGain) * 0.01;

    let outL = inL * this.currentGain;
    let outR = inR * this.currentGain;

    // Soft limiter to prevent clipping
    if (this.limiter > 0) {
      const threshold = 1 - this.limiter * 0.3; // 0.7 to 1.0
      const ceiling = 1.0;

      // Soft knee limiting
      if (Math.abs(outL) > threshold) {
        outL = Math.sign(outL) * (threshold + (ceiling - threshold) * Math.tanh((Math.abs(outL) - threshold) / (ceiling - threshold)));
      }
      if (Math.abs(outR) > threshold) {
        outR = Math.sign(outR) * (threshold + (ceiling - threshold) * Math.tanh((Math.abs(outR) - threshold) / (ceiling - threshold)));
      }
    }

    return [outL, outR];
  }

  reset() {
    this.currentGain = Math.pow(10, this.gain / 20);
  }
}


// ============================================================================
// EFFECT REGISTRY
// ============================================================================
const EffectRegistry = {
  delay: DelayEffect,
  reverb: ReverbEffect,
  chorus: ChorusEffect,
  tremolo: TremoloEffect,
  flanger: FlangerEffect,
  phaser: PhaserEffect,
  vibrato: VibratoEffect,
  autowah: AutoWahEffect,
  overdrive: OverdriveEffect,
  distortion: DistortionEffect,
  wavefolder: WavefolderEffect,
  bitcrusher: BitcrusherEffect,
  compressor: CompressorEffect,
  sustain: SustainEffect,
  ringmod: RingModEffect,
  pitchshifter: PitchShifterEffect,
  subboost: SubBoostEffect,
  lofi: LoFiEffect,
  equalizer: EqualizerEffect,
  ampsimulator: AmpSimulatorEffect,
  rings: RingsEffect,
  clouds: CloudsEffect,
  mastergain: MasterGainEffect
};

const EffectCategories = {
  'Time': ['delay', 'reverb'],
  'Modulation': ['chorus', 'tremolo', 'flanger', 'phaser', 'vibrato', 'autowah'],
  'Distortion': ['overdrive', 'distortion', 'wavefolder', 'bitcrusher'],
  'Dynamics': ['compressor', 'sustain', 'mastergain'],
  'Spectral': ['ringmod', 'pitchshifter', 'subboost', 'lofi', 'equalizer'],
  'Advanced': ['rings', 'clouds', 'ampsimulator']
};
`;

// Export for use in HTML
if (typeof window !== 'undefined') {
  window.PedalboardEffectsCode = PedalboardEffectsCode;
}
