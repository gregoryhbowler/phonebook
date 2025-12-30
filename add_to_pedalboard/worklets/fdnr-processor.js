// FDNR AudioWorkletProcessor - Web Audio Port of FDNR VST3
// Implements the complete DSP chain from ReverbProcessor.cpp

// ============================================================================
// FREEVERB IMPLEMENTATION (Schroeder Reverb)
// 8 Parallel Comb Filters -> 4 Series Allpass Filters
// ============================================================================

class CombFilter {
    constructor(bufferSize, dampening = 0.5, feedback = 0.5) {
        this.buffer = new Float32Array(bufferSize);
        this.bufferSize = bufferSize;
        this.index = 0;
        this.filterStore = 0;
        this.dampening = dampening;
        this.feedback = feedback;
    }

    setDampening(value) {
        this.dampening = value;
    }

    setFeedback(value) {
        this.feedback = value;
    }

    process(input) {
        const output = this.buffer[this.index];

        // One-pole lowpass in feedback path
        this.filterStore = (output * (1 - this.dampening)) + (this.filterStore * this.dampening);

        this.buffer[this.index] = input + (this.filterStore * this.feedback);

        this.index++;
        if (this.index >= this.bufferSize) {
            this.index = 0;
        }

        return output;
    }

    clear() {
        this.buffer.fill(0);
        this.filterStore = 0;
        this.index = 0;
    }
}

class AllpassFilter {
    constructor(bufferSize, feedback = 0.5) {
        this.buffer = new Float32Array(bufferSize);
        this.bufferSize = bufferSize;
        this.index = 0;
        this.feedback = feedback;
    }

    setFeedback(value) {
        this.feedback = value;
    }

    process(input) {
        const bufferOut = this.buffer[this.index];
        const output = -input + bufferOut;

        this.buffer[this.index] = input + (bufferOut * this.feedback);

        this.index++;
        if (this.index >= this.bufferSize) {
            this.index = 0;
        }

        return output;
    }

    clear() {
        this.buffer.fill(0);
        this.index = 0;
    }
}

class Freeverb {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;

        // Freeverb tuning constants (scaled for sample rate)
        const scaleFactor = sampleRate / 44100;

        // Comb filter sizes (from original Freeverb)
        const combTuningL = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
        const combTuningR = [1116 + 23, 1188 + 23, 1277 + 23, 1356 + 23, 1422 + 23, 1491 + 23, 1557 + 23, 1617 + 23];

        // Allpass filter sizes
        const allpassTuningL = [556, 441, 341, 225];
        const allpassTuningR = [556 + 23, 441 + 23, 341 + 23, 225 + 23];

        // Create comb filters (8 per channel)
        this.combL = combTuningL.map(size => new CombFilter(Math.round(size * scaleFactor)));
        this.combR = combTuningR.map(size => new CombFilter(Math.round(size * scaleFactor)));

        // Create allpass filters (4 per channel)
        this.allpassL = allpassTuningL.map(size => new AllpassFilter(Math.round(size * scaleFactor), 0.5));
        this.allpassR = allpassTuningR.map(size => new AllpassFilter(Math.round(size * scaleFactor), 0.5));

        // Parameters
        this.roomSize = 0.5;
        this.damping = 0.5;
        this.width = 1.0;
        this.wet = 1.0;
        this.dry = 0.0;
        this.freeze = false;

        this._updateCoefficients();
    }

    _updateCoefficients() {
        // Map room size to feedback (0.7 to 0.98 range for stability)
        const feedback = this.freeze ? 1.0 : 0.7 + (this.roomSize * 0.28);

        // Update all comb filters
        for (let i = 0; i < 8; i++) {
            this.combL[i].setFeedback(feedback);
            this.combR[i].setFeedback(feedback);
            this.combL[i].setDampening(this.damping);
            this.combR[i].setDampening(this.damping);
        }
    }

    setRoomSize(value) {
        this.roomSize = Math.max(0, Math.min(1, value));
        this._updateCoefficients();
    }

    setDamping(value) {
        this.damping = Math.max(0, Math.min(1, value));
        this._updateCoefficients();
    }

    setWidth(value) {
        this.width = Math.max(0, Math.min(1, value));
    }

    setWet(value) {
        this.wet = value;
    }

    setDry(value) {
        this.dry = value;
    }

    setFreeze(freeze) {
        this.freeze = freeze;
        this._updateCoefficients();
    }

    process(inputL, inputR) {
        // Mix input to mono and scale
        const input = (inputL + inputR) * 0.015;

        // Process through parallel comb filters
        let outL = 0;
        let outR = 0;

        for (let i = 0; i < 8; i++) {
            outL += this.combL[i].process(input);
            outR += this.combR[i].process(input);
        }

        // Process through series allpass filters
        for (let i = 0; i < 4; i++) {
            outL = this.allpassL[i].process(outL);
            outR = this.allpassR[i].process(outR);
        }

        // Apply stereo width
        const wet1 = this.wet * (this.width / 2 + 0.5);
        const wet2 = this.wet * ((1 - this.width) / 2);

        const wetL = outL * wet1 + outR * wet2;
        const wetR = outR * wet1 + outL * wet2;

        return [wetL, wetR];
    }

    clear() {
        for (let i = 0; i < 8; i++) {
            this.combL[i].clear();
            this.combR[i].clear();
        }
        for (let i = 0; i < 4; i++) {
            this.allpassL[i].clear();
            this.allpassR[i].clear();
        }
    }
}

// ============================================================================
// STATE VARIABLE TPT FILTER (for Dynamic EQ)
// ============================================================================

class StateVariableFilter {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.ic1eq = 0;
        this.ic2eq = 0;
        this.cutoff = 1000;
        this.resonance = 1;
        this._updateCoefficients();
    }

    _updateCoefficients() {
        // TPT (topology preserving transform) coefficients
        const g = Math.tan(Math.PI * this.cutoff / this.sampleRate);
        const k = 1 / this.resonance;
        this.a1 = 1 / (1 + g * (g + k));
        this.a2 = g * this.a1;
        this.a3 = g * this.a2;
    }

    setCutoffFrequency(freq) {
        this.cutoff = Math.max(20, Math.min(20000, freq));
        this._updateCoefficients();
    }

    setResonance(q) {
        this.resonance = Math.max(0.1, Math.min(10, q));
        this._updateCoefficients();
    }

    // Returns bandpass output
    processSample(input) {
        const v3 = input - this.ic2eq;
        const v1 = this.a1 * this.ic1eq + this.a2 * v3;
        const v2 = this.ic2eq + this.a2 * this.ic1eq + this.a3 * v3;

        this.ic1eq = 2 * v1 - this.ic1eq;
        this.ic2eq = 2 * v2 - this.ic2eq;

        // Return bandpass
        return v1;
    }

    reset() {
        this.ic1eq = 0;
        this.ic2eq = 0;
    }
}

// ============================================================================
// BIQUAD FILTER (for 3-Band EQ)
// ============================================================================

class BiquadFilter {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.b0 = 1; this.b1 = 0; this.b2 = 0;
        this.a1 = 0; this.a2 = 0;
        this.x1 = 0; this.x2 = 0;
        this.y1 = 0; this.y2 = 0;
    }

    setLowShelf(freq, q, gainDb) {
        const A = Math.pow(10, gainDb / 40);
        const w0 = 2 * Math.PI * freq / this.sampleRate;
        const cosw0 = Math.cos(w0);
        const sinw0 = Math.sin(w0);
        const alpha = sinw0 / (2 * q);

        const a0 = (A + 1) + (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha;
        this.b0 = (A * ((A + 1) - (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha)) / a0;
        this.b1 = (2 * A * ((A - 1) - (A + 1) * cosw0)) / a0;
        this.b2 = (A * ((A + 1) - (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha)) / a0;
        this.a1 = (-2 * ((A - 1) + (A + 1) * cosw0)) / a0;
        this.a2 = ((A + 1) + (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha) / a0;
    }

    setPeaking(freq, q, gainDb) {
        const A = Math.pow(10, gainDb / 40);
        const w0 = 2 * Math.PI * freq / this.sampleRate;
        const cosw0 = Math.cos(w0);
        const sinw0 = Math.sin(w0);
        const alpha = sinw0 / (2 * q);

        const a0 = 1 + alpha / A;
        this.b0 = (1 + alpha * A) / a0;
        this.b1 = (-2 * cosw0) / a0;
        this.b2 = (1 - alpha * A) / a0;
        this.a1 = (-2 * cosw0) / a0;
        this.a2 = (1 - alpha / A) / a0;
    }

    setHighShelf(freq, q, gainDb) {
        const A = Math.pow(10, gainDb / 40);
        const w0 = 2 * Math.PI * freq / this.sampleRate;
        const cosw0 = Math.cos(w0);
        const sinw0 = Math.sin(w0);
        const alpha = sinw0 / (2 * q);

        const a0 = (A + 1) - (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha;
        this.b0 = (A * ((A + 1) + (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha)) / a0;
        this.b1 = (-2 * A * ((A - 1) + (A + 1) * cosw0)) / a0;
        this.b2 = (A * ((A + 1) + (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha)) / a0;
        this.a1 = (2 * ((A - 1) - (A + 1) * cosw0)) / a0;
        this.a2 = ((A + 1) - (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha) / a0;
    }

    process(input) {
        const output = this.b0 * input + this.b1 * this.x1 + this.b2 * this.x2
                     - this.a1 * this.y1 - this.a2 * this.y2;

        this.x2 = this.x1;
        this.x1 = input;
        this.y2 = this.y1;
        this.y1 = output;

        return output;
    }

    reset() {
        this.x1 = this.x2 = this.y1 = this.y2 = 0;
    }
}

// ============================================================================
// DELAY LINE WITH LINEAR INTERPOLATION
// ============================================================================

class DelayLine {
    constructor(maxSamples) {
        this.buffer = new Float32Array(maxSamples);
        this.maxSamples = maxSamples;
        this.writeIndex = 0;
        this.delaySamples = 0;
    }

    setDelay(samples) {
        this.delaySamples = Math.max(0, Math.min(this.maxSamples - 1, samples));
    }

    process(input) {
        // Write to buffer
        this.buffer[this.writeIndex] = input;

        // Calculate read position with linear interpolation
        const readPos = this.writeIndex - this.delaySamples;
        const readIndex = readPos < 0 ? readPos + this.maxSamples : readPos;

        const index0 = Math.floor(readIndex);
        const index1 = (index0 + 1) % this.maxSamples;
        const frac = readIndex - index0;

        const output = this.buffer[index0] * (1 - frac) + this.buffer[index1] * frac;

        // Advance write index
        this.writeIndex = (this.writeIndex + 1) % this.maxSamples;

        return output;
    }

    clear() {
        this.buffer.fill(0);
        this.writeIndex = 0;
    }
}

// ============================================================================
// CHORUS/WARP ENGINE (Modulated Delay)
// ============================================================================

class ChorusEngine {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;

        // Max modulation is ~50ms
        const maxDelaySamples = Math.ceil(sampleRate * 0.1);
        this.delayLineL = new DelayLine(maxDelaySamples);
        this.delayLineR = new DelayLine(maxDelaySamples);

        // LFO
        this.lfoPhase = 0;
        this.lfoRate = 0.5;
        this.lfoDepth = 0.5;

        // Parameters
        this.feedback = 0;
        this.mix = 0.5;

        // Feedback state
        this.feedbackL = 0;
        this.feedbackR = 0;

        // Base delay (center point for modulation)
        this.baseDelay = sampleRate * 0.01; // 10ms
    }

    setRate(hz) {
        this.lfoRate = Math.max(0, Math.min(10, hz));
    }

    setDepth(depth) {
        this.lfoDepth = Math.max(0, Math.min(1, depth));
    }

    setFeedback(fb) {
        this.feedback = Math.max(0, Math.min(0.95, fb));
    }

    setMix(mix) {
        this.mix = Math.max(0, Math.min(1, mix));
    }

    process(inputL, inputR) {
        // Advance LFO
        this.lfoPhase += (this.lfoRate / this.sampleRate) * 2 * Math.PI;
        if (this.lfoPhase > 2 * Math.PI) {
            this.lfoPhase -= 2 * Math.PI;
        }

        // Calculate modulated delay
        const lfoValue = Math.sin(this.lfoPhase);
        const modulation = lfoValue * this.lfoDepth * this.sampleRate * 0.01; // Up to 10ms modulation
        const delaySamples = this.baseDelay + modulation;

        this.delayLineL.setDelay(delaySamples);
        this.delayLineR.setDelay(delaySamples + 5); // Slight stereo offset

        // Process with feedback
        const delayedL = this.delayLineL.process(inputL + this.feedbackL * this.feedback);
        const delayedR = this.delayLineR.process(inputR + this.feedbackR * this.feedback);

        this.feedbackL = delayedL;
        this.feedbackR = delayedR;

        // Mix dry/wet
        const outL = inputL * (1 - this.mix) + delayedL * this.mix;
        const outR = inputR * (1 - this.mix) + delayedR * this.mix;

        return [outL, outR];
    }

    clear() {
        this.delayLineL.clear();
        this.delayLineR.clear();
        this.feedbackL = 0;
        this.feedbackR = 0;
        this.lfoPhase = 0;
    }
}

// ============================================================================
// LIMITER
// ============================================================================

class Limiter {
    constructor(sampleRate) {
        this.sampleRate = sampleRate;
        this.threshold = 1.0;
        this.release = 0.1; // 100ms
        this.envelope = 0;

        this._updateCoefficients();
    }

    _updateCoefficients() {
        this.releaseCoeff = Math.exp(-1 / (this.release * this.sampleRate));
    }

    setThreshold(dbValue) {
        this.threshold = Math.pow(10, dbValue / 20);
    }

    setRelease(ms) {
        this.release = ms / 1000;
        this._updateCoefficients();
    }

    process(inputL, inputR) {
        const absL = Math.abs(inputL);
        const absR = Math.abs(inputR);
        const peak = Math.max(absL, absR);

        // Envelope follower (instant attack, slow release)
        if (peak > this.envelope) {
            this.envelope = peak;
        } else {
            this.envelope = peak + (this.envelope - peak) * this.releaseCoeff;
        }

        // Calculate gain reduction
        let gain = 1.0;
        if (this.envelope > this.threshold) {
            gain = this.threshold / this.envelope;
        }

        return [inputL * gain, inputR * gain];
    }

    reset() {
        this.envelope = 0;
    }
}

// ============================================================================
// FDNR PROCESSOR - Main AudioWorkletProcessor
// ============================================================================

class FDNRProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            // Core parameters
            { name: 'mix', defaultValue: 50, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
            { name: 'width', defaultValue: 100, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
            { name: 'delay', defaultValue: 100, minValue: 0, maxValue: 1000, automationRate: 'k-rate' },
            { name: 'warp', defaultValue: 0, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
            { name: 'feedback', defaultValue: 50, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
            { name: 'density', defaultValue: 0, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
            { name: 'modRate', defaultValue: 0.5, minValue: 0, maxValue: 5, automationRate: 'k-rate' },
            { name: 'modDepth', defaultValue: 50, minValue: 0, maxValue: 100, automationRate: 'k-rate' },

            // Dynamic EQ
            { name: 'dynFreq', defaultValue: 1000, minValue: 20, maxValue: 20000, automationRate: 'k-rate' },
            { name: 'dynQ', defaultValue: 1, minValue: 0.1, maxValue: 10, automationRate: 'k-rate' },
            { name: 'dynGain', defaultValue: 0, minValue: -18, maxValue: 18, automationRate: 'k-rate' },
            { name: 'dynDepth', defaultValue: 0, minValue: -18, maxValue: 18, automationRate: 'k-rate' },
            { name: 'dynThresh', defaultValue: -20, minValue: -60, maxValue: 0, automationRate: 'k-rate' },

            // Effects
            { name: 'ducking', defaultValue: 0, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
            { name: 'saturation', defaultValue: 0, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
            { name: 'diffusion', defaultValue: 100, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
            { name: 'gateThresh', defaultValue: -100, minValue: -100, maxValue: 0, automationRate: 'k-rate' },

            // 3-Band EQ
            { name: 'eq3Low', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
            { name: 'eq3Mid', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
            { name: 'eq3High', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },

            // Stereo and output
            { name: 'msBalance', defaultValue: 50, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
            { name: 'limiterOn', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },

            // Sync
            { name: 'preDelaySync', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
            { name: 'bpm', defaultValue: 120, minValue: 20, maxValue: 300, automationRate: 'k-rate' },

            // Mode
            { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 20, automationRate: 'k-rate' }
        ];
    }

    constructor(options) {
        super();

        this.sampleRate = options.processorOptions?.sampleRate || 48000;

        // Initialize DSP components
        this.reverb = new Freeverb(this.sampleRate);
        this.chorus = new ChorusEngine(this.sampleRate);

        // Pre-delay line (2 seconds max at 48kHz)
        const maxDelaySamples = Math.ceil(this.sampleRate * 2);
        this.preDelayL = new DelayLine(maxDelaySamples);
        this.preDelayR = new DelayLine(maxDelaySamples);

        // Dynamic EQ filters
        this.dynEqFilterL = new StateVariableFilter(this.sampleRate);
        this.dynEqFilterR = new StateVariableFilter(this.sampleRate);
        this.detectorFilter = new StateVariableFilter(this.sampleRate);

        // 3-Band EQ (per channel)
        this.lowShelfL = new BiquadFilter(this.sampleRate);
        this.lowShelfR = new BiquadFilter(this.sampleRate);
        this.midPeakL = new BiquadFilter(this.sampleRate);
        this.midPeakR = new BiquadFilter(this.sampleRate);
        this.highShelfL = new BiquadFilter(this.sampleRate);
        this.highShelfR = new BiquadFilter(this.sampleRate);

        // Limiter
        this.limiter = new Limiter(this.sampleRate);
        this.limiter.setThreshold(-0.1);
        this.limiter.setRelease(100);

        // Envelope followers
        this.gateEnv = 0;
        this.duckEnv = 0;
        this.dynEqEnv = 0;

        // Coefficients (calculated once per block)
        this.gateRel = 1 - Math.exp(-1 / (0.1 * this.sampleRate));
        this.dynAtt = 1 - Math.exp(-1 / (0.005 * this.sampleRate));
        this.dynRel = 1 - Math.exp(-1 / (0.1 * this.sampleRate));
        this.duckAtt = 1 - Math.exp(-1 / (0.01 * this.sampleRate));
        this.duckRel = 1 - Math.exp(-1 / (0.1 * this.sampleRate));

        // Previous parameter values (for update detection)
        this.prevParams = {};

        // Message handling
        this.port.onmessage = (e) => this._handleMessage(e.data);
    }

    _handleMessage(data) {
        switch (data.type) {
            case 'reset':
                this._reset();
                break;
            case 'setParam':
                // Handled via AudioParam
                break;
        }
    }

    _reset() {
        this.reverb.clear();
        this.chorus.clear();
        this.preDelayL.clear();
        this.preDelayR.clear();
        this.dynEqFilterL.reset();
        this.dynEqFilterR.reset();
        this.detectorFilter.reset();
        this.lowShelfL.reset();
        this.lowShelfR.reset();
        this.midPeakL.reset();
        this.midPeakR.reset();
        this.highShelfL.reset();
        this.highShelfR.reset();
        this.limiter.reset();
        this.gateEnv = 0;
        this.duckEnv = 0;
        this.dynEqEnv = 0;
    }

    _gainToDecibels(gain) {
        return 20 * Math.log10(Math.max(gain, 0.00001));
    }

    _decibelsToGain(db) {
        return Math.pow(10, db / 20);
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input[0]) {
            return true;
        }

        const inputL = input[0];
        const inputR = input[1] || input[0];
        const outputL = output[0];
        const outputR = output[1] || output[0];
        const numSamples = inputL.length;

        // Get parameters
        const mix = parameters.mix[0];
        const width = parameters.width[0];
        const delay = parameters.delay[0];
        const warp = parameters.warp[0];
        const feedback = parameters.feedback[0];
        const density = parameters.density[0];
        const modRate = parameters.modRate[0];
        const modDepth = parameters.modDepth[0];

        const dynFreq = parameters.dynFreq[0];
        const dynQ = parameters.dynQ[0];
        const dynGain = parameters.dynGain[0];
        const dynDepth = parameters.dynDepth[0];
        const dynThresh = parameters.dynThresh[0];

        const ducking = parameters.ducking[0];
        const saturation = parameters.saturation[0];
        const gateThresh = parameters.gateThresh[0];

        const eq3Low = parameters.eq3Low[0];
        const eq3Mid = parameters.eq3Mid[0];
        const eq3High = parameters.eq3High[0];

        const msBalance = parameters.msBalance[0];
        const limiterOn = parameters.limiterOn[0] > 0.5;

        const preDelaySync = Math.round(parameters.preDelaySync[0]);
        const bpm = parameters.bpm[0];
        const mode = Math.round(parameters.mode[0]);

        // === Update DSP Parameters ===

        // Reverb - map feedback (0-100) to room size (0-1)
        const roomSize = feedback / 100;
        // Map density (0-100) inversely to damping (1.0 to 0.0)
        const damping = 1.0 - (density / 100);

        // Handle freeze mode (feedback > 98)
        const freeze = feedback > 98;

        this.reverb.setRoomSize(roomSize);
        this.reverb.setDamping(damping);
        this.reverb.setWidth(width / 100);
        this.reverb.setFreeze(freeze);

        // Pre-delay with BPM sync
        let delayMs = delay;
        if (preDelaySync > 0 && bpm > 0) {
            const beatMs = 60000 / bpm;
            if (preDelaySync === 1) delayMs = beatMs;       // 1/4
            else if (preDelaySync === 2) delayMs = beatMs * 0.5;  // 1/8
            else if (preDelaySync === 3) delayMs = beatMs * 0.25; // 1/16
        }
        const delaySamples = (delayMs * this.sampleRate) / 1000;
        this.preDelayL.setDelay(delaySamples);
        this.preDelayR.setDelay(delaySamples);

        // Warp/Chorus engine
        this.chorus.setRate(modRate);
        this.chorus.setDepth(modDepth / 100);
        this.chorus.setFeedback((warp / 100) * 0.5);
        this.chorus.setMix(0.5);

        // Dynamic EQ filters
        this.dynEqFilterL.setCutoffFrequency(dynFreq);
        this.dynEqFilterL.setResonance(dynQ);
        this.dynEqFilterR.setCutoffFrequency(dynFreq);
        this.dynEqFilterR.setResonance(dynQ);
        this.detectorFilter.setCutoffFrequency(dynFreq);
        this.detectorFilter.setResonance(dynQ);

        // 3-Band EQ
        this.lowShelfL.setLowShelf(200, 0.71, eq3Low);
        this.lowShelfR.setLowShelf(200, 0.71, eq3Low);
        this.midPeakL.setPeaking(1000, 1.0, eq3Mid);
        this.midPeakR.setPeaking(1000, 1.0, eq3Mid);
        this.highShelfL.setHighShelf(6000, 0.71, eq3High);
        this.highShelfR.setHighShelf(6000, 0.71, eq3High);

        // Dynamics coefficients
        const gateThreshLin = this._decibelsToGain(gateThresh);
        const dynThreshLin = Math.pow(10, dynThresh / 20);
        const duckIntensity = ducking / 100;

        // Saturation parameters
        const drive = 1.0 + (saturation / 20);

        // === Process Audio ===

        for (let i = 0; i < numSamples; i++) {
            // Store dry input for ducking sidechain
            const dryL = inputL[i];
            const dryR = inputR[i];

            // Start wet signal
            let wetL = dryL;
            let wetR = dryR;

            // 1. Saturation (Pre-processing)
            if (saturation > 0) {
                wetL = Math.tanh(wetL * drive) / drive;
                wetR = Math.tanh(wetR * drive) / drive;
            }

            // 2. Pre-Delay
            wetL = this.preDelayL.process(wetL);
            wetR = this.preDelayR.process(wetR);

            // 3. Warp Engine (Chorus)
            if (warp > 0 || modDepth > 0) {
                [wetL, wetR] = this.chorus.process(wetL, wetR);
            }

            // 4. Reverb Core (Freeverb)
            [wetL, wetR] = this.reverb.process(wetL, wetR);

            // 5. Dynamics Section

            // 5a. Gate
            const maxLevel = Math.max(Math.abs(wetL), Math.abs(wetR));
            if (maxLevel > gateThreshLin) {
                this.gateEnv = 1.0;
            } else {
                this.gateEnv += (0.0 - this.gateEnv) * this.gateRel;
            }

            // 5b. Dynamic EQ detector
            const detOut = this.detectorFilter.processSample(maxLevel);
            const envIn = Math.abs(detOut);
            if (envIn > this.dynEqEnv) {
                this.dynEqEnv += (envIn - this.dynEqEnv) * this.dynAtt;
            } else {
                this.dynEqEnv += (envIn - this.dynEqEnv) * this.dynRel;
            }

            let dynGainCalc = 0;
            if (this.dynEqEnv > dynThreshLin) {
                const excessDb = this._gainToDecibels(this.dynEqEnv + 0.00001) - dynThresh;
                if (excessDb > 0) {
                    dynGainCalc = dynDepth * Math.min(1.0, excessDb / 20);
                }
            }
            const totalDynGain = this._decibelsToGain(dynGain + dynGainCalc);

            // 5c. Ducking envelope (from dry input)
            const dryLevel = Math.abs(dryL);
            if (dryLevel > this.duckEnv) {
                this.duckEnv += (dryLevel - this.duckEnv) * this.duckAtt;
            } else {
                this.duckEnv += (dryLevel - this.duckEnv) * this.duckRel;
            }
            const duckGain = Math.max(0, 1.0 - (this.duckEnv * duckIntensity * 4.0));

            // Apply dynamics
            // Gate
            wetL *= this.gateEnv;
            wetR *= this.gateEnv;

            // Dynamic EQ (Peaking approximation)
            const bpL = this.dynEqFilterL.processSample(wetL);
            const bpR = this.dynEqFilterR.processSample(wetR);
            wetL = wetL + (totalDynGain - 1.0) * bpL;
            wetR = wetR + (totalDynGain - 1.0) * bpR;

            // Ducking
            wetL *= duckGain;
            wetR *= duckGain;

            // 6. 3-Band EQ
            wetL = this.lowShelfL.process(wetL);
            wetL = this.midPeakL.process(wetL);
            wetL = this.highShelfL.process(wetL);

            wetR = this.lowShelfR.process(wetR);
            wetR = this.midPeakR.process(wetR);
            wetR = this.highShelfR.process(wetR);

            // 7. M/S Balance
            const balance = msBalance / 100;
            const m = (wetL + wetR) * 0.5;
            const s = (wetL - wetR) * 0.5;

            const mGain = balance < 0.5 ? 1.0 : 2.0 * (1.0 - balance);
            const sGain = balance > 0.5 ? 1.0 : balance * 2.0;

            wetL = m * mGain + s * sGain;
            wetR = m * mGain - s * sGain;

            // 8. Dry/Wet Mix
            const wetAmt = mix / 100;
            const dryAmt = 1.0 - wetAmt;

            let outL = dryL * dryAmt + wetL * wetAmt;
            let outR = dryR * dryAmt + wetR * wetAmt;

            // 9. Output Limiter
            if (limiterOn) {
                [outL, outR] = this.limiter.process(outL, outR);
            }

            outputL[i] = outL;
            outputR[i] = outR;
        }

        return true;
    }
}

registerProcessor('fdnr-processor', FDNRProcessor);
