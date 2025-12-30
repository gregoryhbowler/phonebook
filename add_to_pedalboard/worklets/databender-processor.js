// DATA BENDER PROCESSOR - AudioWorkletProcessor
// Qu-Bit Electronix Data Bender emulation
// Circuit-bent digital audio buffer: CD skipping, tape glitches, software bugs
// 96kHz internal, 24-bit depth, over 60 seconds of stereo audio

// Buffer size: ~65 seconds at 48kHz stereo
const MAX_BUFFER_SAMPLES = 48000 * 65;

// Corrupt effect types
const CORRUPT_DECIMATE = 0;
const CORRUPT_DROPOUT = 1;
const CORRUPT_DESTROY = 2;
const CORRUPT_DJFILTER = 3;
const CORRUPT_VINYLSIM = 4;

class DataBenderProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        this.sampleRate = options.processorOptions?.sampleRate || 48000;

        // === STEREO AUDIO BUFFER ===
        // Large circular buffer for recording/playback
        this.bufferL = new Float32Array(MAX_BUFFER_SAMPLES);
        this.bufferR = new Float32Array(MAX_BUFFER_SAMPLES);
        this.writeHead = 0;
        this.playHead = 0;

        // === TIME / CLOCK PARAMETERS ===
        // Internal clock: 16 seconds (CCW) to 80Hz (CW)
        this.clockMode = 'internal';  // 'internal' or 'external'
        this.internalClockRate = 1;   // Hz (buffer refresh rate)
        this.externalBPM = 120;
        this.clockDivMult = 1;        // /16 to x8
        this.clockPhase = 0;
        this.lastClockTime = 0;
        this.bufferLength = this.sampleRate;  // Current active buffer length in samples
        this.targetBufferLength = this.sampleRate;

        // === REPEATS (BUFFER SUBDIVISION) ===
        this.repeats = 1;             // Number of buffer subdivisions (1 = no subdivision)
        this.currentRepeat = 0;       // Current subdivision being played
        this.repeatPhase = 0;         // Position within current repeat

        // === MODE STATE ===
        this.mode = 'macro';          // 'macro' or 'micro'

        // === BEND PARAMETERS ===
        // Macro: automated tape effects
        // Micro: manual pitch control (-3 to +3 octaves)
        this.bendEnabled = false;
        this.bendAmount = 0;          // 0-1 in macro, determines effect probability
        this.microBendPitch = 1;      // Playback speed multiplier (micro mode)
        this.microBendReverse = false;

        // Tape-style effects state (macro mode)
        this.currentPlaybackSpeed = 1;
        this.targetPlaybackSpeed = 1;
        this.isReversed = false;
        this.tapeStopActive = false;
        this.tapeStopProgress = 0;
        this.slewActive = false;
        this.slewTarget = 1;

        // === BREAK PARAMETERS ===
        // Macro: automated CD skip/glitch effects
        // Micro: Traverse (select subsection) or Silence (duty cycle)
        this.breakEnabled = false;
        this.breakAmount = 0;
        this.breakMicroMode = 'traverse';  // 'traverse' or 'silence'
        this.traversePosition = 0;    // 0-1: which subsection
        this.silenceAmount = 0;       // 0-0.9: amount of silence in playback
        this.silencePhase = 0;

        // Macro break effects state
        this.jumpToNewSection = false;
        this.extraRepeats = 0;
        this.silenceInserted = false;

        // === CORRUPT PARAMETERS ===
        this.corruptType = CORRUPT_DECIMATE;
        this.corruptAmount = 0;       // 0-1

        // Decimate state
        this.decimateHold = 0;
        this.decimateCounter = 0;
        this.decimateBitDepth = 24;

        // Dropout state
        this.dropoutActive = false;
        this.dropoutLength = 0;
        this.dropoutCounter = 0;

        // Destroy state (saturation/clipping)

        // DJ Filter state
        this.djFilterState = { x1: 0, x2: 0, y1: 0, y2: 0 };
        this.djFilterStateR = { x1: 0, x2: 0, y1: 0, y2: 0 };

        // Vinyl sim state
        this.vinylNoiseLevel = 0;
        this.vinylClickTimer = 0;
        this.vinylPopSample = 0;
        this.vinylWowPhase = 0;
        this.vinylFlutterPhase = 0;

        // === MIX ===
        this.mix = 0.5;               // 0 = dry, 1 = wet
        this.targetMix = 0.5;

        // === FREEZE STATE ===
        this.freezeActive = false;
        this.freezeLength = 0;

        // === STEREO ENHANCEMENT ===
        this.stereoWidth = 0;         // 0-1: stereo spread

        // === WINDOWING ===
        // Amount of fade at glitch boundaries (0 = clicks, 1 = full envelope)
        this.windowingAmount = 0.02;  // 2% default

        // === STEREO BEHAVIOR (MACRO MODE) ===
        this.stereoBehavior = 'unique'; // 'unique' or 'shared'
        // Separate states for L/R when in unique mode
        this.bendStateL = { speed: 1, reversed: false };
        this.bendStateR = { speed: 1, reversed: false };
        this.breakStateL = { section: 0, repeats: 0 };
        this.breakStateR = { section: 0, repeats: 0 };

        // === SMOOTHING ===
        this.smoothingRate = 0.001;

        // === RANDOM STATE FOR MACRO MODE ===
        this.randomSeed = Math.random();

        // === MESSAGE HANDLING ===
        this.port.onmessage = (e) => this._handleMessage(e.data);

        // Initialize
        this._updateBufferLength();
    }

    // === MESSAGE HANDLING ===

    _handleMessage(data) {
        switch (data.type) {
            case 'setParam':
                this._setParam(data.name, data.value);
                break;
            case 'setMode':
                this.mode = data.mode === 'micro' ? 'micro' : 'macro';
                break;
            case 'setClockMode':
                this.clockMode = data.mode === 'external' ? 'external' : 'internal';
                this._updateBufferLength();
                break;
            case 'setBPM':
                this.externalBPM = Math.max(20, Math.min(300, data.bpm));
                if (this.clockMode === 'external') {
                    this._updateBufferLength();
                }
                break;
            case 'setClockDivMult':
                // /16, /8, /4, /2, x1, x2, x3, x4, x8
                this.clockDivMult = data.value;
                if (this.clockMode === 'external') {
                    this._updateBufferLength();
                }
                break;
            case 'setBend':
                this.bendEnabled = data.enabled;
                break;
            case 'setBreak':
                this.breakEnabled = data.enabled;
                break;
            case 'setBreakMicroMode':
                this.breakMicroMode = data.mode === 'silence' ? 'silence' : 'traverse';
                break;
            case 'setCorruptType':
                this.corruptType = Math.max(0, Math.min(4, Math.round(data.value)));
                break;
            case 'freeze':
                this._handleFreeze(data.active);
                break;
            case 'purge':
                this._purge();
                break;
            case 'setStereoBehavior':
                this.stereoBehavior = data.mode === 'shared' ? 'shared' : 'unique';
                break;
            case 'reset':
                // Reset internal clock phase
                this.clockPhase = 0;
                this.playHead = 0;
                this.currentRepeat = 0;
                this.repeatPhase = 0;
                break;
        }
    }

    _setParam(name, value) {
        switch (name) {
            case 'time':
                this._setTime(value);
                break;
            case 'repeats':
                // 0 = no subdivision (1 repeat), higher = more divisions
                // Maps 0-1 to 1-64+ repeats (exponential)
                const repeatsVal = Math.max(0, Math.min(1, value));
                this.repeats = Math.max(1, Math.floor(1 + repeatsVal * 63));
                break;
            case 'mix':
                this.targetMix = Math.max(0, Math.min(1, value));
                // Also set mix directly to avoid slow smoothing
                this.mix = this.targetMix;
                break;
            case 'bend':
                this.bendAmount = Math.max(0, Math.min(1, value));
                if (this.mode === 'micro') {
                    // Micro mode: maps to -3 to +3 octaves (1/8x to 8x speed)
                    // Center (0.5) = normal speed
                    // 0 = -3 octaves (1/8x), 1 = +3 octaves (8x)
                    const octaves = (value - 0.5) * 6;
                    this.microBendPitch = Math.pow(2, octaves);
                }
                break;
            case 'break':
                this.breakAmount = Math.max(0, Math.min(1, value));
                if (this.mode === 'micro') {
                    if (this.breakMicroMode === 'traverse') {
                        this.traversePosition = value;
                    } else {
                        this.silenceAmount = value * 0.9; // Max 90% silence
                    }
                }
                break;
            case 'corrupt':
                this.corruptAmount = Math.max(0, Math.min(1, value));
                break;
            case 'stereoWidth':
                this.stereoWidth = Math.max(0, Math.min(1, value));
                break;
            case 'windowing':
                this.windowingAmount = Math.max(0, Math.min(1, value));
                break;
        }
    }

    _setTime(normalized) {
        if (this.clockMode === 'internal') {
            // Internal: 16 seconds (0) to 12.5ms/80Hz (1)
            // Logarithmic scale
            const minPeriod = 1 / 80;     // 12.5ms
            const maxPeriod = 16;          // 16 seconds
            const period = maxPeriod * Math.pow(minPeriod / maxPeriod, normalized);
            this.internalClockRate = 1 / period;
            this.targetBufferLength = Math.floor(period * this.sampleRate);
        } else {
            // External: time knob controls div/mult
            // 0 = /16, 0.5 = x1, 1 = x8
            const divMultValues = [1/16, 1/8, 1/4, 1/2, 1, 2, 3, 4, 8];
            const index = Math.floor(normalized * (divMultValues.length - 0.01));
            this.clockDivMult = divMultValues[index];
            this._updateBufferLength();
        }
    }

    _updateBufferLength() {
        if (this.clockMode === 'internal') {
            // Already set by _setTime
        } else {
            // External clock: buffer length based on BPM and div/mult
            const beatDuration = 60 / this.externalBPM;
            const period = beatDuration * this.clockDivMult;
            this.targetBufferLength = Math.floor(period * this.sampleRate);
        }

        // Clamp to valid range
        this.targetBufferLength = Math.max(128, Math.min(MAX_BUFFER_SAMPLES - 1, this.targetBufferLength));
    }

    // === FREEZE / PURGE ===

    _handleFreeze(active) {
        if (active && !this.freezeActive) {
            // Entering freeze: capture current buffer length
            this.freezeLength = this.bufferLength;
            this.freezeActive = true;
        } else if (!active && this.freezeActive) {
            this.freezeActive = false;
        }
    }

    _purge() {
        this.bufferL.fill(0);
        this.bufferR.fill(0);
        this.writeHead = 0;
        this.playHead = 0;
    }

    // === MACRO MODE AUTOMATION ===

    _rollMacroBend(channel) {
        // Called at clock boundaries in macro mode
        // Bend zones: Reverse, Octaves, 2 Octaves, Tape Stop, Slew, Everything
        if (!this.bendEnabled || this.bendAmount < 0.01) {
            return { speed: 1, reversed: false };
        }

        const rand = this._pseudoRandom();
        const amount = this.bendAmount;

        let speed = 1;
        let reversed = false;

        // Zone 1 (0-0.17): Reverse only
        if (amount > 0 && rand < amount * 0.3) {
            reversed = Math.random() < 0.5;
        }

        // Zone 2 (0.17-0.33): Add octave jumps
        if (amount > 0.17 && rand < amount * 0.4) {
            const octaves = [0.5, 1, 2];
            speed = octaves[Math.floor(Math.random() * octaves.length)];
        }

        // Zone 3 (0.33-0.5): Add 2-octave jumps
        if (amount > 0.33 && rand < amount * 0.5) {
            const octaves = [0.25, 0.5, 1, 2, 4];
            speed = octaves[Math.floor(Math.random() * octaves.length)];
        }

        // Zone 4 (0.5-0.67): Add tape stop effect
        if (amount > 0.5 && rand < amount * 0.2) {
            // Tape stop: gradual slowdown
            this.tapeStopActive = true;
            this.tapeStopProgress = 0;
        }

        // Zone 5 (0.67-0.83): Add slew between speeds
        if (amount > 0.67) {
            this.slewActive = true;
        }

        return { speed, reversed };
    }

    _rollMacroBreak(channel) {
        // Called at clock boundaries in macro mode
        // Break zones: 2 sub-sections, Jumping, More subsections, Audio rate, Silence
        if (!this.breakEnabled || this.breakAmount < 0.01) {
            return { section: 0, extraRepeats: 0, silence: false };
        }

        const rand = this._pseudoRandom();
        const amount = this.breakAmount;

        let section = 0;
        let extraRepeats = 0;
        let silence = false;

        // Zone 1 (0-0.17): 2 subsections
        if (amount > 0 && rand < amount * 0.3) {
            section = Math.floor(Math.random() * 2);
        }

        // Zone 2 (0.17-0.33): Jumping to random sections
        if (amount > 0.17 && rand < amount * 0.4) {
            section = Math.floor(Math.random() * Math.min(8, this.repeats));
        }

        // Zone 3 (0.33-0.5): More subsections possible
        if (amount > 0.33 && rand < amount * 0.5) {
            section = Math.floor(Math.random() * this.repeats);
            extraRepeats = Math.floor(Math.random() * 4);
        }

        // Zone 4 (0.5-0.67): Audio rate repeats
        if (amount > 0.5 && rand < amount * 0.3) {
            extraRepeats = Math.floor(Math.random() * 32);
        }

        // Zone 5 (0.67-0.83): Add silence
        if (amount > 0.67 && rand < amount * 0.4) {
            silence = Math.random() < 0.5;
        }

        return { section, extraRepeats, silence };
    }

    _pseudoRandom() {
        // Simple PRNG for deterministic-ish behavior
        this.randomSeed = (this.randomSeed * 9301 + 49297) % 233280;
        return this.randomSeed / 233280;
    }

    // === CORRUPT EFFECTS ===

    _processDecimate(sampleL, sampleR) {
        if (this.corruptAmount < 0.01) return [sampleL, sampleR];

        // Decimate: bit crushing and sample rate reduction
        // Non-linear: collection of fixed variations
        const variations = [
            { bits: 16, rate: 1 },      // Subtle noise
            { bits: 12, rate: 2 },
            { bits: 10, rate: 4 },
            { bits: 8, rate: 8 },
            { bits: 6, rate: 16 },
            { bits: 4, rate: 32 },      // Heavy destruction
            { bits: 3, rate: 64 },
            { bits: 2, rate: 128 }      // Blown out
        ];

        const varIndex = Math.floor(this.corruptAmount * (variations.length - 0.01));
        const v = variations[varIndex];

        // Sample rate reduction
        this.decimateCounter++;
        if (this.decimateCounter >= v.rate) {
            this.decimateCounter = 0;
            this.decimateHoldL = sampleL;
            this.decimateHoldR = sampleR;
        }

        let outL = this.decimateHoldL || sampleL;
        let outR = this.decimateHoldR || sampleR;

        // Bit crushing
        const levels = Math.pow(2, v.bits);
        outL = Math.round(outL * levels) / levels;
        outR = Math.round(outR * levels) / levels;

        return [outL, outR];
    }

    _processDropout(sampleL, sampleR) {
        if (this.corruptAmount < 0.01) return [sampleL, sampleR];

        // Dropouts: random audio cuts
        // Left side: fewer but longer dropouts
        // Right side: more but shorter dropouts

        if (!this.dropoutActive) {
            // Check if we should start a dropout
            const probability = this.corruptAmount * 0.01; // Base probability per sample
            if (Math.random() < probability) {
                this.dropoutActive = true;
                // Length inversely proportional to amount
                // Low amount = long dropouts, high amount = short dropouts
                const maxLength = this.sampleRate * 0.5 * (1 - this.corruptAmount * 0.8);
                const minLength = this.sampleRate * 0.001;
                this.dropoutLength = Math.floor(minLength + Math.random() * (maxLength - minLength));
                this.dropoutCounter = 0;
            }
        }

        if (this.dropoutActive) {
            this.dropoutCounter++;
            if (this.dropoutCounter >= this.dropoutLength) {
                this.dropoutActive = false;
            }
            return [0, 0]; // Silence during dropout
        }

        return [sampleL, sampleR];
    }

    _processDestroy(sampleL, sampleR) {
        if (this.corruptAmount < 0.01) return [sampleL, sampleR];

        // Destroy: soft saturation to hard clipping
        // First half: soft saturation
        // Second half: hard clipping/distortion

        const amount = this.corruptAmount;
        let outL = sampleL;
        let outR = sampleR;

        if (amount < 0.5) {
            // Soft saturation (tanh)
            const drive = 1 + amount * 4;
            outL = Math.tanh(sampleL * drive) / Math.tanh(drive);
            outR = Math.tanh(sampleR * drive) / Math.tanh(drive);
        } else {
            // Hard clipping with increasing drive
            const drive = 1 + (amount - 0.5) * 20;
            outL = Math.max(-1, Math.min(1, sampleL * drive));
            outR = Math.max(-1, Math.min(1, sampleR * drive));

            // Add some harmonic distortion
            outL = outL - 0.3 * outL * outL * outL;
            outR = outR - 0.3 * outR * outR * outR;
        }

        return [outL, outR];
    }

    _processDJFilter(sampleL, sampleR) {
        if (Math.abs(this.corruptAmount - 0.5) < 0.02) {
            // Near center = no filtering
            return [sampleL, sampleR];
        }

        // DJ Filter: LP below center, HP above center
        const isLowpass = this.corruptAmount < 0.5;
        const filterAmount = isLowpass ?
            (0.5 - this.corruptAmount) * 2 :  // 0-1 for LP
            (this.corruptAmount - 0.5) * 2;    // 0-1 for HP

        // Calculate cutoff frequency
        // LP: 20kHz -> 100Hz as amount increases
        // HP: 20Hz -> 8000Hz as amount increases
        let cutoff;
        if (isLowpass) {
            cutoff = 20000 * Math.pow(0.005, filterAmount);
        } else {
            cutoff = 20 + filterAmount * 7980;
        }

        // Resonance (moderately resonant DJ-style)
        const Q = 1.5 + filterAmount * 2;

        // Biquad coefficients
        const omega = 2 * Math.PI * cutoff / this.sampleRate;
        const sin = Math.sin(omega);
        const cos = Math.cos(omega);
        const alpha = sin / (2 * Q);
        const a0 = 1 + alpha;

        let b0, b1, b2;
        if (isLowpass) {
            b0 = ((1 - cos) / 2) / a0;
            b1 = (1 - cos) / a0;
            b2 = ((1 - cos) / 2) / a0;
        } else {
            b0 = ((1 + cos) / 2) / a0;
            b1 = -(1 + cos) / a0;
            b2 = ((1 + cos) / 2) / a0;
        }
        const a1 = (-2 * cos) / a0;
        const a2 = (1 - alpha) / a0;

        // Process left channel
        const outL = b0 * sampleL + b1 * this.djFilterState.x1 + b2 * this.djFilterState.x2
                   - a1 * this.djFilterState.y1 - a2 * this.djFilterState.y2;
        this.djFilterState.x2 = this.djFilterState.x1;
        this.djFilterState.x1 = sampleL;
        this.djFilterState.y2 = this.djFilterState.y1;
        this.djFilterState.y1 = outL;

        // Process right channel
        const outR = b0 * sampleR + b1 * this.djFilterStateR.x1 + b2 * this.djFilterStateR.x2
                   - a1 * this.djFilterStateR.y1 - a2 * this.djFilterStateR.y2;
        this.djFilterStateR.x2 = this.djFilterStateR.x1;
        this.djFilterStateR.x1 = sampleR;
        this.djFilterStateR.y2 = this.djFilterStateR.y1;
        this.djFilterStateR.y1 = outR;

        return [outL, outR];
    }

    _processVinylSim(sampleL, sampleR) {
        if (this.corruptAmount < 0.01) return [sampleL, sampleR];

        const amount = this.corruptAmount;
        let outL = sampleL;
        let outR = sampleR;

        // 1. Wow & Flutter (pitch wobble)
        const wowRate = 0.5;  // Hz
        const flutterRate = 10; // Hz
        const wowDepth = amount * 0.003;
        const flutterDepth = amount * 0.001;

        this.vinylWowPhase += wowRate / this.sampleRate;
        this.vinylFlutterPhase += flutterRate / this.sampleRate;

        // (Pitch modulation is applied in playback speed, but we simulate with slight delay modulation)

        // 2. Surface noise (constant hiss)
        const noiseLevel = amount * 0.02;
        outL += (Math.random() * 2 - 1) * noiseLevel;
        outR += (Math.random() * 2 - 1) * noiseLevel;

        // 3. Pops and clicks
        this.vinylClickTimer--;
        if (this.vinylClickTimer <= 0) {
            // Random interval based on amount
            const avgInterval = this.sampleRate * (2 - amount * 1.8); // 0.2s to 2s
            this.vinylClickTimer = Math.floor(avgInterval * (0.5 + Math.random()));

            // Generate click/pop
            const clickVolume = 0.1 + Math.random() * 0.3 * amount;
            const isLeft = Math.random() < 0.5;
            this.vinylPopSampleL = isLeft ? clickVolume * (Math.random() > 0.5 ? 1 : -1) : 0;
            this.vinylPopSampleR = !isLeft ? clickVolume * (Math.random() > 0.5 ? 1 : -1) : 0;
        }

        // Decay pops quickly
        outL += this.vinylPopSampleL || 0;
        outR += this.vinylPopSampleR || 0;
        this.vinylPopSampleL *= 0.7;
        this.vinylPopSampleR *= 0.7;

        // 4. Subtle filtering (old vinyl = less highs)
        // Simple one-pole lowpass
        const lpCoeff = 1 - amount * 0.3;
        this.vinylLPL = (this.vinylLPL || 0) * lpCoeff + outL * (1 - lpCoeff);
        this.vinylLPR = (this.vinylLPR || 0) * lpCoeff + outR * (1 - lpCoeff);

        outL = this.vinylLPL * (1 - amount * 0.5) + outL * (amount * 0.5);
        outR = this.vinylLPR * (1 - amount * 0.5) + outR * (amount * 0.5);

        return [outL, outR];
    }

    _processCorrupt(sampleL, sampleR) {
        if (this.corruptAmount < 0.01) return [sampleL, sampleR];

        switch (this.corruptType) {
            case CORRUPT_DECIMATE:
                return this._processDecimate(sampleL, sampleR);
            case CORRUPT_DROPOUT:
                return this._processDropout(sampleL, sampleR);
            case CORRUPT_DESTROY:
                return this._processDestroy(sampleL, sampleR);
            case CORRUPT_DJFILTER:
                return this._processDJFilter(sampleL, sampleR);
            case CORRUPT_VINYLSIM:
                return this._processVinylSim(sampleL, sampleR);
            default:
                return [sampleL, sampleR];
        }
    }

    // === WINDOWING ===

    _applyWindow(sample, phase, length) {
        if (this.windowingAmount < 0.001) return sample;

        // Apply fade at start and end of repeat segment
        const windowSamples = Math.floor(length * this.windowingAmount);
        if (windowSamples < 2) return sample;

        const position = phase * length;

        if (position < windowSamples) {
            // Fade in
            const t = position / windowSamples;
            return sample * (0.5 - 0.5 * Math.cos(Math.PI * t));
        } else if (position > length - windowSamples) {
            // Fade out
            const t = (length - position) / windowSamples;
            return sample * (0.5 - 0.5 * Math.cos(Math.PI * t));
        }

        return sample;
    }

    // === STEREO ENHANCEMENT ===

    _applyStereoWidth(sampleL, sampleR) {
        if (this.stereoWidth < 0.01) return [sampleL, sampleR];

        // Mid-side processing for width enhancement
        const mid = (sampleL + sampleR) * 0.5;
        const side = (sampleL - sampleR) * 0.5;

        // Enhance side signal
        const enhancedSide = side * (1 + this.stereoWidth * 2);

        return [
            mid + enhancedSide,
            mid - enhancedSide
        ];
    }

    // === READ FROM BUFFER ===

    _readBuffer(channel, position) {
        const buffer = channel === 'L' ? this.bufferL : this.bufferR;
        const length = this.freezeActive ? this.freezeLength : this.bufferLength;

        // Wrap position
        const wrappedPos = ((position % length) + length) % length;

        // Linear interpolation
        const floor = Math.floor(wrappedPos);
        const frac = wrappedPos - floor;
        const next = (floor + 1) % MAX_BUFFER_SAMPLES;

        return buffer[floor] * (1 - frac) + buffer[next] * frac;
    }

    // === MAIN PROCESS ===

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input[0]) return true;

        const inputL = input[0];
        const inputR = input[1] || input[0];
        const outputL = output[0];
        const outputR = output[1] || output[0];

        // Smooth buffer length transitions
        this.bufferLength += (this.targetBufferLength - this.bufferLength) * 0.0001;

        // Smooth mix
        this.mix += (this.targetMix - this.mix) * this.smoothingRate;

        for (let i = 0; i < inputL.length; i++) {
            const inL = inputL[i];
            const inR = inputR[i];

            // === WRITE TO BUFFER (unless frozen) ===
            if (!this.freezeActive) {
                this.bufferL[this.writeHead] = inL;
                this.bufferR[this.writeHead] = inR;
                this.writeHead = (this.writeHead + 1) % MAX_BUFFER_SAMPLES;
            }

            // === CALCULATE PLAYBACK POSITION ===
            const activeBufferLength = this.freezeActive ? this.freezeLength : this.bufferLength;
            const repeatLength = activeBufferLength / this.repeats;

            // Determine which repeat section and position within it
            let section = this.currentRepeat;
            let phaseInRepeat = this.repeatPhase;

            // In micro mode with traverse, use traversePosition to select section
            if (this.mode === 'micro' && this.breakMicroMode === 'traverse' && this.repeats > 1) {
                section = Math.floor(this.traversePosition * this.repeats);
                section = Math.min(section, this.repeats - 1);
            }

            // Calculate actual sample position
            const basePosition = section * repeatLength + phaseInRepeat * repeatLength;

            // Apply silence in micro mode
            let silenceFactor = 1;
            if (this.mode === 'micro' && this.breakMicroMode === 'silence') {
                this.silencePhase = (this.silencePhase + 1 / repeatLength) % 1;
                if (this.silencePhase > (1 - this.silenceAmount)) {
                    silenceFactor = 0;
                }
            }

            // === READ FROM BUFFER ===
            let wetL = this._readBuffer('L', basePosition) * silenceFactor;
            let wetR = this._readBuffer('R', basePosition) * silenceFactor;

            // === APPLY WINDOWING ===
            wetL = this._applyWindow(wetL, phaseInRepeat, repeatLength);
            wetR = this._applyWindow(wetR, phaseInRepeat, repeatLength);

            // === APPLY CORRUPT EFFECT ===
            [wetL, wetR] = this._processCorrupt(wetL, wetR);

            // === APPLY STEREO WIDTH ===
            [wetL, wetR] = this._applyStereoWidth(wetL, wetR);

            // === DRY/WET MIX ===
            outputL[i] = inL * (1 - this.mix) + wetL * this.mix;
            outputR[i] = inR * (1 - this.mix) + wetR * this.mix;

            // === ADVANCE PLAYBACK POSITION ===
            let playbackSpeed = 1;

            if (this.mode === 'micro') {
                playbackSpeed = this.microBendPitch;
                if (this.microBendReverse) {
                    playbackSpeed = -playbackSpeed;
                }
            } else {
                // Macro mode: use rolled values
                if (this.bendEnabled) {
                    playbackSpeed = this.currentPlaybackSpeed;
                    if (this.isReversed) {
                        playbackSpeed = -playbackSpeed;
                    }

                    // Apply tape stop effect
                    if (this.tapeStopActive) {
                        this.tapeStopProgress += 0.00005;
                        playbackSpeed *= Math.max(0, 1 - this.tapeStopProgress);
                        if (this.tapeStopProgress >= 1) {
                            this.tapeStopActive = false;
                            this.tapeStopProgress = 0;
                        }
                    }

                    // Apply slew
                    if (this.slewActive) {
                        this.currentPlaybackSpeed += (this.targetPlaybackSpeed - this.currentPlaybackSpeed) * 0.001;
                    }
                }
            }

            // Advance phase within repeat
            this.repeatPhase += Math.abs(playbackSpeed) / repeatLength;

            // Handle wrap-around
            if (this.repeatPhase >= 1) {
                this.repeatPhase = 0;

                // Move to next repeat section
                if (playbackSpeed >= 0) {
                    this.currentRepeat = (this.currentRepeat + 1) % this.repeats;
                } else {
                    this.currentRepeat = (this.currentRepeat - 1 + this.repeats) % this.repeats;
                }

                // In macro mode, roll new random values at section boundaries
                if (this.mode === 'macro') {
                    if (this.bendEnabled && this.bendAmount > 0.01) {
                        const bendResult = this._rollMacroBend('L');
                        this.targetPlaybackSpeed = bendResult.speed;
                        this.isReversed = bendResult.reversed;
                        if (!this.slewActive) {
                            this.currentPlaybackSpeed = this.targetPlaybackSpeed;
                        }
                    }

                    if (this.breakEnabled && this.breakAmount > 0.01) {
                        const breakResult = this._rollMacroBreak('L');
                        if (breakResult.section !== undefined) {
                            this.currentRepeat = breakResult.section % this.repeats;
                        }
                        if (breakResult.silence) {
                            this.silenceInserted = true;
                        } else {
                            this.silenceInserted = false;
                        }
                    }
                }
            }
        }

        return true;
    }
}

registerProcessor('databender-processor', DataBenderProcessor);
