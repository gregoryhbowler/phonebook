/**
 * ER-301 DSP Utilities
 * Core DSP building blocks for ER-301 patch implementations
 */

// ============================================================================
// DELAY LINE
// ============================================================================

class DelayLine {
    constructor(maxDelaySamples) {
        this.buffer = new Float32Array(maxDelaySamples);
        this.maxDelay = maxDelaySamples;
        this.writeIndex = 0;
    }

    write(sample) {
        this.buffer[this.writeIndex] = sample;
        this.writeIndex = (this.writeIndex + 1) % this.maxDelay;
    }

    read(delaySamples) {
        let readIndex = this.writeIndex - Math.floor(delaySamples);
        if (readIndex < 0) readIndex += this.maxDelay;
        return this.buffer[readIndex];
    }

    readLinear(delaySamples) {
        const delay = Math.max(0, Math.min(delaySamples, this.maxDelay - 1));
        const intDelay = Math.floor(delay);
        const frac = delay - intDelay;

        let idx0 = this.writeIndex - intDelay - 1;
        let idx1 = this.writeIndex - intDelay;

        if (idx0 < 0) idx0 += this.maxDelay;
        if (idx1 < 0) idx1 += this.maxDelay;

        return this.buffer[idx1] + frac * (this.buffer[idx0] - this.buffer[idx1]);
    }

    readCubic(delaySamples) {
        const delay = Math.max(1, Math.min(delaySamples, this.maxDelay - 2));
        const intDelay = Math.floor(delay);
        const frac = delay - intDelay;

        let idx0 = this.writeIndex - intDelay - 2;
        let idx1 = this.writeIndex - intDelay - 1;
        let idx2 = this.writeIndex - intDelay;
        let idx3 = this.writeIndex - intDelay + 1;

        if (idx0 < 0) idx0 += this.maxDelay;
        if (idx1 < 0) idx1 += this.maxDelay;
        if (idx2 < 0) idx2 += this.maxDelay;
        if (idx3 < 0) idx3 += this.maxDelay;

        const y0 = this.buffer[idx0];
        const y1 = this.buffer[idx1];
        const y2 = this.buffer[idx2];
        const y3 = this.buffer[idx3];

        const a0 = y3 - y2 - y0 + y1;
        const a1 = y0 - y1 - a0;
        const a2 = y2 - y0;
        const a3 = y1;

        return a0 * frac * frac * frac + a1 * frac * frac + a2 * frac + a3;
    }

    clear() {
        this.buffer.fill(0);
        this.writeIndex = 0;
    }
}

// ============================================================================
// BIQUAD FILTER
// ============================================================================

class Biquad {
    constructor() {
        this.b0 = 1; this.b1 = 0; this.b2 = 0;
        this.a1 = 0; this.a2 = 0;
        this.z1 = 0; this.z2 = 0;
    }

    setLowpass(freq, q, sampleRate) {
        const w0 = 2 * Math.PI * freq / sampleRate;
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
        const w0 = 2 * Math.PI * freq / sampleRate;
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
        const w0 = 2 * Math.PI * freq / sampleRate;
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
        const w0 = 2 * Math.PI * freq / sampleRate;
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

    setAllpass(freq, q, sampleRate) {
        const w0 = 2 * Math.PI * freq / sampleRate;
        const cosW0 = Math.cos(w0);
        const sinW0 = Math.sin(w0);
        const alpha = sinW0 / (2 * q);

        const a0 = 1 + alpha;
        this.b0 = (1 - alpha) / a0;
        this.b1 = (-2 * cosW0) / a0;
        this.b2 = (1 + alpha) / a0;
        this.a1 = (-2 * cosW0) / a0;
        this.a2 = (1 - alpha) / a0;
    }

    process(input) {
        const output = this.b0 * input + this.b1 * this.z1 + this.b2 * this.z2
                      - this.a1 * this.z1 - this.a2 * this.z2;
        this.z2 = this.z1;
        this.z1 = output;
        return output;
    }

    reset() {
        this.z1 = 0;
        this.z2 = 0;
    }
}

// ============================================================================
// ONE-POLE FILTER (Slew Limiter / Lowpass)
// ============================================================================

class OnePole {
    constructor(coefficient = 0.99) {
        this.coeff = coefficient;
        this.z1 = 0;
    }

    setCoefficient(coeff) {
        this.coeff = Math.max(0, Math.min(0.9999, coeff));
    }

    setFrequency(freq, sampleRate) {
        this.coeff = Math.exp(-2 * Math.PI * freq / sampleRate);
    }

    process(input) {
        this.z1 = input + this.coeff * (this.z1 - input);
        return this.z1;
    }

    reset() {
        this.z1 = 0;
    }
}

// ============================================================================
// SLEW LIMITER
// ============================================================================

class SlewLimiter {
    constructor(riseTime = 0.01, fallTime = 0.01, sampleRate = 48000) {
        this.sampleRate = sampleRate;
        this.setTimes(riseTime, fallTime);
        this.current = 0;
    }

    setTimes(riseTime, fallTime) {
        this.riseRate = 1.0 / (riseTime * this.sampleRate + 1);
        this.fallRate = 1.0 / (fallTime * this.sampleRate + 1);
    }

    process(target) {
        if (target > this.current) {
            this.current += (target - this.current) * this.riseRate;
        } else {
            this.current += (target - this.current) * this.fallRate;
        }
        return this.current;
    }

    reset() {
        this.current = 0;
    }
}

// ============================================================================
// ENVELOPE GENERATORS
// ============================================================================

class ADEnvelope {
    constructor(sampleRate = 48000) {
        this.sampleRate = sampleRate;
        this.attack = 0.01;
        this.decay = 0.1;
        this.state = 'idle';
        this.value = 0;
        this.attackRate = 0;
        this.decayRate = 0;
    }

    setAttack(time) {
        this.attack = Math.max(0.001, time);
        this.attackRate = 1.0 / (this.attack * this.sampleRate);
    }

    setDecay(time) {
        this.decay = Math.max(0.001, time);
        this.decayRate = 1.0 / (this.decay * this.sampleRate);
    }

    trigger() {
        this.state = 'attack';
    }

    process() {
        switch (this.state) {
            case 'attack':
                this.value += this.attackRate;
                if (this.value >= 1.0) {
                    this.value = 1.0;
                    this.state = 'decay';
                }
                break;
            case 'decay':
                this.value -= this.decayRate;
                if (this.value <= 0) {
                    this.value = 0;
                    this.state = 'idle';
                }
                break;
        }
        return this.value;
    }
}

class DecayEnvelope {
    constructor(sampleRate = 48000) {
        this.sampleRate = sampleRate;
        this.decay = 0.5;
        this.value = 0;
        this.coeff = 0.999;
    }

    setDecay(time) {
        this.decay = Math.max(0.001, time);
        // Approximate coefficient for 60dB decay in given time
        this.coeff = Math.exp(-6.91 / (this.decay * this.sampleRate));
    }

    trigger(level = 1.0) {
        this.value = level;
    }

    process() {
        this.value *= this.coeff;
        return this.value;
    }
}

// ============================================================================
// OSCILLATORS
// ============================================================================

class SineOscillator {
    constructor(sampleRate = 48000) {
        this.sampleRate = sampleRate;
        this.phase = 0;
        this.freq = 440;
    }

    setFrequency(freq) {
        this.freq = freq;
    }

    process() {
        const output = Math.sin(2 * Math.PI * this.phase);
        this.phase += this.freq / this.sampleRate;
        if (this.phase >= 1) this.phase -= 1;
        return output;
    }

    reset() {
        this.phase = 0;
    }
}

class SinOscFB {
    // Sine oscillator with feedback (like ER-301)
    constructor(sampleRate = 48000) {
        this.sampleRate = sampleRate;
        this.phase = 0;
        this.freq = 440;
        this.feedback = 0;
        this.lastOutput = 0;
    }

    setFrequency(freq) {
        this.freq = freq;
    }

    setFeedback(fb) {
        this.feedback = fb;
    }

    process() {
        const modPhase = this.phase + this.feedback * this.lastOutput;
        const output = Math.sin(2 * Math.PI * modPhase);
        this.lastOutput = output;
        this.phase += this.freq / this.sampleRate;
        if (this.phase >= 1) this.phase -= 1;
        return output;
    }
}

class SawOscillator {
    constructor(sampleRate = 48000) {
        this.sampleRate = sampleRate;
        this.phase = 0;
        this.freq = 440;
    }

    process() {
        const output = 2 * this.phase - 1;
        this.phase += this.freq / this.sampleRate;
        if (this.phase >= 1) this.phase -= 1;
        return output;
    }
}

class PulseOscillator {
    constructor(sampleRate = 48000) {
        this.sampleRate = sampleRate;
        this.phase = 0;
        this.freq = 440;
        this.width = 0.5;
    }

    setWidth(width) {
        this.width = Math.max(0.01, Math.min(0.99, width));
    }

    process() {
        const output = this.phase < this.width ? 1 : -1;
        this.phase += this.freq / this.sampleRate;
        if (this.phase >= 1) this.phase -= 1;
        return output;
    }
}

class TriangleOscillator {
    constructor(sampleRate = 48000) {
        this.sampleRate = sampleRate;
        this.phase = 0;
        this.freq = 440;
    }

    process() {
        const output = 4 * Math.abs(this.phase - 0.5) - 1;
        this.phase += this.freq / this.sampleRate;
        if (this.phase >= 1) this.phase -= 1;
        return output;
    }
}

// ============================================================================
// NOISE GENERATORS
// ============================================================================

class WhiteNoise {
    process() {
        return Math.random() * 2 - 1;
    }
}

class PinkNoise {
    constructor() {
        this.b0 = 0; this.b1 = 0; this.b2 = 0;
        this.b3 = 0; this.b4 = 0; this.b5 = 0; this.b6 = 0;
    }

    process() {
        const white = Math.random() * 2 - 1;
        this.b0 = 0.99886 * this.b0 + white * 0.0555179;
        this.b1 = 0.99332 * this.b1 + white * 0.0750759;
        this.b2 = 0.96900 * this.b2 + white * 0.1538520;
        this.b3 = 0.86650 * this.b3 + white * 0.3104856;
        this.b4 = 0.55000 * this.b4 + white * 0.5329522;
        this.b5 = -0.7616 * this.b5 - white * 0.0168980;
        const output = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + white * 0.5362;
        this.b6 = white * 0.115926;
        return output * 0.11;
    }
}

class LFNoise0 {
    // Step noise - holds value until next trigger
    constructor(sampleRate = 48000) {
        this.sampleRate = sampleRate;
        this.freq = 1;
        this.counter = 0;
        this.value = 0;
    }

    setFrequency(freq) {
        this.freq = Math.max(0.001, freq);
    }

    process() {
        this.counter++;
        if (this.counter >= this.sampleRate / this.freq) {
            this.counter = 0;
            this.value = Math.random() * 2 - 1;
        }
        return this.value;
    }
}

class LFNoise1 {
    // Linearly interpolated noise
    constructor(sampleRate = 48000) {
        this.sampleRate = sampleRate;
        this.freq = 1;
        this.counter = 0;
        this.value = 0;
        this.nextValue = Math.random() * 2 - 1;
    }

    setFrequency(freq) {
        this.freq = Math.max(0.001, freq);
    }

    process() {
        const period = this.sampleRate / this.freq;
        const phase = this.counter / period;
        const output = this.value + phase * (this.nextValue - this.value);

        this.counter++;
        if (this.counter >= period) {
            this.counter = 0;
            this.value = this.nextValue;
            this.nextValue = Math.random() * 2 - 1;
        }
        return output;
    }
}

class Dust {
    // Random impulses
    constructor(sampleRate = 48000) {
        this.sampleRate = sampleRate;
        this.density = 1; // impulses per second
    }

    setDensity(density) {
        this.density = Math.max(0, density);
    }

    process() {
        const threshold = this.density / this.sampleRate;
        if (Math.random() < threshold) {
            return Math.random() * 2 - 1;
        }
        return 0;
    }
}

// ============================================================================
// REVERB (Dattorro-style plate reverb)
// ============================================================================

class DattorroReverb {
    constructor(sampleRate = 48000) {
        this.sampleRate = sampleRate;

        // Predelay
        this.predelay = new DelayLine(Math.floor(sampleRate * 0.1));
        this.predelayTime = 0;

        // Input diffusers
        this.inDiff1 = new AllpassSection(142, 0.75);
        this.inDiff2 = new AllpassSection(107, 0.75);
        this.inDiff3 = new AllpassSection(379, 0.625);
        this.inDiff4 = new AllpassSection(277, 0.625);

        // Decay diffusers
        const baseDelay = sampleRate / 29761; // Dattorro's original sample rate

        this.decayDiff1L = new AllpassSection(Math.floor(672 * baseDelay), -0.7);
        this.delay1L = new DelayLine(Math.floor(4453 * baseDelay));
        this.damp1L = new OnePole(0.0001);
        this.decayDiff2L = new AllpassSection(Math.floor(1800 * baseDelay), 0.5);
        this.delay2L = new DelayLine(Math.floor(3720 * baseDelay));

        this.decayDiff1R = new AllpassSection(Math.floor(908 * baseDelay), -0.7);
        this.delay1R = new DelayLine(Math.floor(4217 * baseDelay));
        this.damp1R = new OnePole(0.0001);
        this.decayDiff2R = new AllpassSection(Math.floor(2656 * baseDelay), 0.5);
        this.delay2R = new DelayLine(Math.floor(3163 * baseDelay));

        // Parameters
        this.decay = 0.5;
        this.damping = 0.5;
        this.bandwidth = 0.9995;
        this.mix = 0.5;

        // Input filter
        this.inputFilter = new OnePole(0.9995);

        // Tank state
        this.tankL = 0;
        this.tankR = 0;
    }

    setPredelay(ms) {
        this.predelayTime = Math.floor((ms / 1000) * this.sampleRate);
    }

    setDecay(decay) {
        this.decay = Math.max(0, Math.min(0.99, decay));
    }

    setDamping(damping) {
        const freq = 20000 * (1 - damping);
        this.damp1L.setFrequency(freq, this.sampleRate);
        this.damp1R.setFrequency(freq, this.sampleRate);
    }

    setBandwidth(bandwidth) {
        this.inputFilter.setCoefficient(1 - bandwidth);
    }

    setMix(mix) {
        this.mix = Math.max(0, Math.min(1, mix));
    }

    process(inputL, inputR) {
        // Mix to mono and apply bandwidth
        let input = (inputL + inputR) * 0.5;
        input = this.inputFilter.process(input);

        // Predelay
        this.predelay.write(input);
        input = this.predelay.read(this.predelayTime);

        // Input diffusion
        input = this.inDiff1.process(input);
        input = this.inDiff2.process(input);
        input = this.inDiff3.process(input);
        input = this.inDiff4.process(input);

        // Tank left
        let tankInL = input + this.tankR * this.decay;
        tankInL = this.decayDiff1L.process(tankInL);
        this.delay1L.write(tankInL);
        tankInL = this.delay1L.read(Math.floor(4453 * this.sampleRate / 29761));
        tankInL = this.damp1L.process(tankInL);
        tankInL = this.decayDiff2L.process(tankInL);
        this.delay2L.write(tankInL);
        this.tankL = this.delay2L.read(Math.floor(3720 * this.sampleRate / 29761));

        // Tank right
        let tankInR = input + this.tankL * this.decay;
        tankInR = this.decayDiff1R.process(tankInR);
        this.delay1R.write(tankInR);
        tankInR = this.delay1R.read(Math.floor(4217 * this.sampleRate / 29761));
        tankInR = this.damp1R.process(tankInR);
        tankInR = this.decayDiff2R.process(tankInR);
        this.delay2R.write(tankInR);
        this.tankR = this.delay2R.read(Math.floor(3163 * this.sampleRate / 29761));

        // Output taps (simplified)
        const wetL = this.tankL * 0.6 + this.tankR * 0.4;
        const wetR = this.tankR * 0.6 + this.tankL * 0.4;

        // Mix
        const outL = inputL * (1 - this.mix) + wetL * this.mix;
        const outR = inputR * (1 - this.mix) + wetR * this.mix;

        return [outL, outR];
    }
}

class AllpassSection {
    constructor(delaySamples, coefficient) {
        this.delay = new DelayLine(delaySamples + 1);
        this.delaySamples = delaySamples;
        this.coeff = coefficient;
    }

    process(input) {
        const delayed = this.delay.read(this.delaySamples);
        const output = -input * this.coeff + delayed;
        this.delay.write(input + delayed * this.coeff);
        return output;
    }
}

// ============================================================================
// COMPRESSOR / LIMITER
// ============================================================================

class Compressor {
    constructor(sampleRate = 48000) {
        this.sampleRate = sampleRate;
        this.threshold = 0.5;
        this.ratio = 4;
        this.attack = 0.003;
        this.release = 0.1;
        this.envelope = 0;
        this.makeupGain = 1;
    }

    setThreshold(dB) {
        this.threshold = Math.pow(10, dB / 20);
    }

    setRatio(ratio) {
        this.ratio = Math.max(1, ratio);
    }

    setAttack(time) {
        this.attack = Math.max(0.0001, time);
    }

    setRelease(time) {
        this.release = Math.max(0.001, time);
    }

    setMakeupGain(dB) {
        this.makeupGain = Math.pow(10, dB / 20);
    }

    process(input) {
        const level = Math.abs(input);

        // Envelope follower
        const attackCoeff = Math.exp(-1 / (this.attack * this.sampleRate));
        const releaseCoeff = Math.exp(-1 / (this.release * this.sampleRate));

        if (level > this.envelope) {
            this.envelope = attackCoeff * this.envelope + (1 - attackCoeff) * level;
        } else {
            this.envelope = releaseCoeff * this.envelope + (1 - releaseCoeff) * level;
        }

        // Gain computation
        let gain = 1;
        if (this.envelope > this.threshold) {
            const dBOver = 20 * Math.log10(this.envelope / this.threshold);
            const dBReduction = dBOver * (1 - 1 / this.ratio);
            gain = Math.pow(10, -dBReduction / 20);
        }

        return input * gain * this.makeupGain;
    }
}

class Limiter {
    constructor(sampleRate = 48000) {
        this.sampleRate = sampleRate;
        this.threshold = 0.95;
        this.release = 0.05;
        this.envelope = 0;
    }

    process(input) {
        const level = Math.abs(input);
        const releaseCoeff = Math.exp(-1 / (this.release * this.sampleRate));

        if (level > this.envelope) {
            this.envelope = level;
        } else {
            this.envelope = releaseCoeff * this.envelope;
        }

        let gain = 1;
        if (this.envelope > this.threshold) {
            gain = this.threshold / this.envelope;
        }

        return input * gain;
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function linlin(x, inMin, inMax, outMin, outMax) {
    return outMin + (x - inMin) * (outMax - outMin) / (inMax - inMin);
}

function linexp(x, inMin, inMax, outMin, outMax) {
    const ratio = outMax / outMin;
    return outMin * Math.pow(ratio, (x - inMin) / (inMax - inMin));
}

function explin(x, inMin, inMax, outMin, outMax) {
    const ratio = inMax / inMin;
    return outMin + (Math.log(x / inMin) / Math.log(ratio)) * (outMax - outMin);
}

function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

function freqToMidi(freq) {
    return 69 + 12 * Math.log2(freq / 440);
}

function dBToLinear(dB) {
    return Math.pow(10, dB / 20);
}

function linearToDB(linear) {
    return 20 * Math.log10(Math.max(0.00001, Math.abs(linear)));
}

function softclip(x) {
    if (x > 1) return 1;
    if (x < -1) return -1;
    return x - (x * x * x) / 3;
}

function hardclip(x, threshold = 1) {
    return Math.max(-threshold, Math.min(threshold, x));
}

function tanh_approx(x) {
    // Fast tanh approximation
    if (x < -3) return -1;
    if (x > 3) return 1;
    return x * (27 + x * x) / (27 + 9 * x * x);
}

// ============================================================================
// EXPORTS
// ============================================================================

if (typeof window !== 'undefined') {
    window.ER301DSP = {
        DelayLine,
        Biquad,
        OnePole,
        SlewLimiter,
        ADEnvelope,
        DecayEnvelope,
        SineOscillator,
        SinOscFB,
        SawOscillator,
        PulseOscillator,
        TriangleOscillator,
        WhiteNoise,
        PinkNoise,
        LFNoise0,
        LFNoise1,
        Dust,
        DattorroReverb,
        AllpassSection,
        Compressor,
        Limiter,
        // Utility functions
        linlin,
        linexp,
        explin,
        midiToFreq,
        freqToMidi,
        dBToLinear,
        linearToDB,
        softclip,
        hardclip,
        tanh_approx
    };
}
