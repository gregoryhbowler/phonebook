// NAUTILUS PROCESSOR - AudioWorkletProcessor
// Qu-Bit Nautilus delay emulation - runs in audio thread
// 8 delay lines (4L + 4R), multiple feedback modes, chroma effects, shimmer

const MAX_DELAY_SAMPLES = 480000; // 10 seconds @ 48kHz
const GRAIN_SIZE = 2400;          // 50ms grains for pitch shifter
const GRAIN_HOP = 600;            // 75% overlap
const MAX_GRAINS = 8;

class NautilusProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        this.sampleRate = options.processorOptions?.sampleRate || 48000;

        // === DELAY LINES (8 total: 4L + 4R) ===
        this.delayLines = [];
        for (let i = 0; i < 8; i++) {
            this.delayLines.push({
                buffer: new Float32Array(MAX_DELAY_SAMPLES),
                writeIndex: 0,
                delayTime: this.sampleRate * 0.5,    // Default 500ms
                targetDelayTime: this.sampleRate * 0.5,
                reversed: false,
                // For crossfade mode
                crossfading: false,
                crossfadeProgress: 0,
                crossfadeSamples: 0,
                oldDelayTime: 0
            });
        }

        // === PARAMETERS (smoothed) ===
        this.params = {
            mix: { current: 0.5, target: 0.5 },
            feedback: { current: 0.5, target: 0.5 },
            dispersal: { current: 0, target: 0 },
            depth: { current: 0, target: 0 },
            reverbMix: { current: 0, target: 0 }
        };
        this.smoothingRate = 0.001;

        // === DISCRETE PARAMETERS ===
        this.resolution = 0.4;
        this.sensors = 1;           // 1-8 active lines per channel
        this.reversal = 0;          // 0-1
        this.chroma = 0;            // 0-5 effect selector
        this.shimmerSemitones = 12;
        this.deshimmerSemitones = 12;
        this.reverbPreset = 0;      // 0=normal, 1=bright, 2=dark

        // === MODES ===
        this.delayMode = 'fade';      // fade, doppler, shimmer, deshimmer
        this.feedbackMode = 'normal'; // normal, pingPong, cascade, adrift

        // === CLOCK ===
        this.bpm = 120;

        // === FREEZE STATE ===
        this.freezeActive = false;
        this.freezeBuffer = null;
        this.freezeLength = 0;
        this.freezePlayhead = 0;

        // === CHROMA EFFECT PROCESSORS (per delay line) ===
        this.chromaStates = [];
        for (let i = 0; i < 8; i++) {
            this.chromaStates.push(this._createChromaState());
        }

        // === GRANULAR PITCH SHIFTER (for shimmer modes) ===
        this.pitchShifters = [
            this._createPitchShifter(12),   // Shimmer (default +12)
            this._createPitchShifter(-12)   // De-shimmer (default -12)
        ];

        // === END-OF-CHAIN REVERB ===
        this.reverb = this._createReverb();

        // === MESSAGE HANDLING ===
        this.port.onmessage = (e) => this._handleMessage(e.data);

        // Update delay times based on initial BPM
        this._updateDelayTimes();
    }

    // Create chroma effect state for one delay line
    _createChromaState() {
        return {
            // Lowpass filter (Oceanic) - 2 cascaded biquads
            lpf: [
                { x1: 0, x2: 0, y1: 0, y2: 0 },
                { x1: 0, x2: 0, y1: 0, y2: 0 }
            ],
            // Highpass filter (White Water) - 2 cascaded biquads
            hpf: [
                { x1: 0, x2: 0, y1: 0, y2: 0 },
                { x1: 0, x2: 0, y1: 0, y2: 0 }
            ],
            // Bitcrusher state
            crusherHold: 0,
            crusherCounter: 0
        };
    }

    // Create granular pitch shifter
    _createPitchShifter(semitones) {
        const ratio = Math.pow(2, semitones / 12);
        const window = new Float32Array(GRAIN_SIZE);
        for (let i = 0; i < GRAIN_SIZE; i++) {
            window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (GRAIN_SIZE - 1)));
        }

        return {
            semitones,
            ratio,
            window,
            inputBuffer: new Float32Array(GRAIN_SIZE * 4),
            writeIndex: 0,
            grains: [],
            grainCounter: 0
        };
    }

    // Create simple reverb (Freeverb-style)
    _createReverb() {
        const scale = this.sampleRate / 44100;
        const combDelays = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map(d =>
            Math.floor(d * scale)
        );
        const allpassDelays = [225, 556, 441, 341].map(d =>
            Math.floor(d * scale)
        );

        return {
            combs: combDelays.map(d => ({
                buffer: new Float32Array(d),
                index: 0,
                feedback: 0.84
            })),
            allpasses: allpassDelays.map(d => ({
                buffer: new Float32Array(d),
                index: 0
            })),
            lowpassState: 0,
            dampening: 0.3
        };
    }

    // Handle messages from main thread
    _handleMessage(data) {
        switch (data.type) {
            case 'setParam':
                this._setParam(data.name, data.value);
                break;
            case 'setDelayMode':
                this.delayMode = data.mode;
                break;
            case 'setFeedbackMode':
                this.feedbackMode = data.mode;
                break;
            case 'setBPM':
                this.bpm = data.bpm;
                this._updateDelayTimes();
                break;
            case 'freeze':
                if (data.active) {
                    this._activateFreeze();
                } else {
                    this.freezeActive = false;
                }
                break;
            case 'purge':
                this._purge();
                break;
        }
    }

    // Set a parameter
    _setParam(name, value) {
        switch (name) {
            case 'mix':
            case 'feedback':
            case 'dispersal':
            case 'depth':
            case 'reverbMix':
                this.params[name].target = value;
                break;
            case 'resolution':
                this.resolution = value;
                this._updateDelayTimes();
                break;
            case 'sensors':
                this.sensors = Math.max(1, Math.min(8, Math.round(value)));
                break;
            case 'reversal':
                this.reversal = value;
                this._updateReversals();
                break;
            case 'chroma':
                this.chroma = Math.round(value);
                break;
            case 'shimmerSemitones':
                this.shimmerSemitones = Math.round(value);
                this.pitchShifters[0].semitones = this.shimmerSemitones;
                this.pitchShifters[0].ratio = Math.pow(2, this.shimmerSemitones / 12);
                break;
            case 'deshimmerSemitones':
                this.deshimmerSemitones = Math.round(value);
                this.pitchShifters[1].semitones = -this.deshimmerSemitones;
                this.pitchShifters[1].ratio = Math.pow(2, -this.deshimmerSemitones / 12);
                break;
            case 'reverbPreset':
                this.reverbPreset = Math.round(value);
                this._updateReverbPreset();
                break;
        }
    }

    // Update delay times based on BPM and resolution
    _updateDelayTimes() {
        const beatDuration = 60.0 / this.bpm;
        const resolutionMult = this._getResolutionMultiplier(this.resolution);
        const baseDelaySec = beatDuration * resolutionMult;

        for (let i = 0; i < 8; i++) {
            const line = this.delayLines[i];
            const channel = i < 4 ? 'L' : 'R';
            const lineIndex = i % 4;

            // Apply dispersal offset
            const dispersalOffset = lineIndex * this.params.dispersal.target * baseDelaySec * 0.5;
            const totalDelaySec = Math.min(10, Math.max(0.001, baseDelaySec + dispersalOffset));
            const newDelayTime = Math.floor(totalDelaySec * this.sampleRate);

            // Handle delay time change based on mode
            if (this.delayMode === 'fade') {
                // Crossfade to new time
                if (Math.abs(newDelayTime - line.delayTime) > 100) {
                    line.crossfading = true;
                    line.crossfadeProgress = 0;
                    line.crossfadeSamples = Math.floor(0.05 * this.sampleRate); // 50ms fade
                    line.oldDelayTime = line.delayTime;
                }
            }

            line.targetDelayTime = newDelayTime;
        }
    }

    // Get resolution multiplier from 0-1 value
    _getResolutionMultiplier(resolution) {
        const divisions = [
            8,        // 2 bars
            4,        // 1 bar
            3,        // dotted half
            2,        // half
            1.5,      // dotted quarter
            1,        // quarter
            0.75,     // dotted eighth
            0.5,      // eighth
            0.333,    // eighth triplet
            0.25,     // sixteenth
            0.167,    // sixteenth triplet
            0.125,    // 32nd
            0.0625,   // 64th
            0.03125,  // 128th
            0.015625, // 256th
            0.0078125 // 512th
        ];
        const index = Math.floor(resolution * (divisions.length - 1));
        return divisions[index];
    }

    // Update which delay lines are reversed
    _updateReversals() {
        // Reversal goes 1L, 1R, 2L, 2R, 3L, 3R, 4L, 4R
        const totalReversed = Math.floor(this.reversal * 8);
        const order = [0, 4, 1, 5, 2, 6, 3, 7]; // 1L, 1R, 2L, 2R, etc.

        for (let i = 0; i < 8; i++) {
            this.delayLines[order[i]].reversed = i < totalReversed;
        }
    }

    // Update reverb preset
    _updateReverbPreset() {
        switch (this.reverbPreset) {
            case 0: // Normal
                this.reverb.dampening = 0.3;
                this.reverb.combs.forEach(c => c.feedback = 0.84);
                break;
            case 1: // Bright
                this.reverb.dampening = 0.1;
                this.reverb.combs.forEach(c => c.feedback = 0.88);
                break;
            case 2: // Dark
                this.reverb.dampening = 0.6;
                this.reverb.combs.forEach(c => c.feedback = 0.80);
                break;
        }
    }

    // Activate freeze
    _activateFreeze() {
        const baseDelay = this.delayLines[0].delayTime;
        this.freezeLength = Math.min(baseDelay, MAX_DELAY_SAMPLES / 2);

        // Allocate freeze buffer (stereo)
        this.freezeBuffer = new Float32Array(this.freezeLength * 2);

        // Copy from delay lines
        const lineL = this.delayLines[0];
        const lineR = this.delayLines[4];

        for (let i = 0; i < this.freezeLength; i++) {
            const idx = (lineL.writeIndex - this.freezeLength + i + MAX_DELAY_SAMPLES) % MAX_DELAY_SAMPLES;
            this.freezeBuffer[i * 2] = lineL.buffer[idx];
            this.freezeBuffer[i * 2 + 1] = lineR.buffer[idx];
        }

        this.freezePlayhead = 0;
        this.freezeActive = true;

        this.port.postMessage({ type: 'freezeComplete' });
    }

    // Purge all buffers
    _purge() {
        for (const line of this.delayLines) {
            line.buffer.fill(0);
        }
        this.freezeActive = false;
    }

    // Smooth parameter update
    _smoothParam(param) {
        param.current += (param.target - param.current) * this.smoothingRate;
    }

    // Read from delay line with interpolation
    _readDelayLine(line, delaySamples) {
        const readPos = (line.writeIndex - delaySamples + MAX_DELAY_SAMPLES) % MAX_DELAY_SAMPLES;
        const floor = Math.floor(readPos);
        const frac = readPos - floor;
        const next = (floor + 1) % MAX_DELAY_SAMPLES;

        // Linear interpolation
        return line.buffer[floor] * (1 - frac) + line.buffer[next] * frac;
    }

    // Read from delay line (reversed)
    _readDelayLineReversed(line, delaySamples) {
        // For reversed playback, we read forward from the current write position
        const readPos = (line.writeIndex + (delaySamples % line.delayTime)) % MAX_DELAY_SAMPLES;
        const floor = Math.floor(readPos);
        const frac = readPos - floor;
        const next = (floor + 1) % MAX_DELAY_SAMPLES;

        return line.buffer[floor] * (1 - frac) + line.buffer[next] * frac;
    }

    // Read with crossfade (fade mode)
    _readWithFade(line) {
        if (!line.crossfading) {
            if (line.reversed) {
                return this._readDelayLineReversed(line, line.delayTime);
            }
            return this._readDelayLine(line, line.delayTime);
        }

        const t = line.crossfadeProgress / line.crossfadeSamples;
        const fadeOut = Math.cos(t * Math.PI * 0.5);
        const fadeIn = Math.sin(t * Math.PI * 0.5);

        const oldSample = this._readDelayLine(line, line.oldDelayTime);
        const newSample = this._readDelayLine(line, line.targetDelayTime);

        line.crossfadeProgress++;
        if (line.crossfadeProgress >= line.crossfadeSamples) {
            line.crossfading = false;
            line.delayTime = line.targetDelayTime;
        }

        return oldSample * fadeOut + newSample * fadeIn;
    }

    // Read with doppler (vari-speed)
    _readWithDoppler(line) {
        // Smooth interpolation of delay time causes pitch shift
        line.delayTime += (line.targetDelayTime - line.delayTime) * 0.0001;

        if (line.reversed) {
            return this._readDelayLineReversed(line, line.delayTime);
        }
        return this._readDelayLine(line, line.delayTime);
    }

    // Process granular pitch shifter
    _processPitchShifter(shifter, sample) {
        // Write to input buffer
        shifter.inputBuffer[shifter.writeIndex] = sample;
        shifter.writeIndex = (shifter.writeIndex + 1) % shifter.inputBuffer.length;

        // Spawn new grain
        shifter.grainCounter++;
        if (shifter.grainCounter >= GRAIN_HOP && shifter.grains.length < MAX_GRAINS) {
            shifter.grainCounter = 0;
            shifter.grains.push({
                startIndex: (shifter.writeIndex - GRAIN_SIZE + shifter.inputBuffer.length) % shifter.inputBuffer.length,
                position: 0
            });
        }

        // Process active grains
        let output = 0;
        for (let i = shifter.grains.length - 1; i >= 0; i--) {
            const grain = shifter.grains[i];

            // Calculate read position with pitch ratio
            const readPos = grain.startIndex + (grain.position * shifter.ratio);
            const wrappedPos = ((readPos % shifter.inputBuffer.length) + shifter.inputBuffer.length) % shifter.inputBuffer.length;

            // Linear interpolation
            const floor = Math.floor(wrappedPos);
            const frac = wrappedPos - floor;
            const next = (floor + 1) % shifter.inputBuffer.length;

            const grainSample = shifter.inputBuffer[floor] * (1 - frac) + shifter.inputBuffer[next] * frac;
            output += grainSample * shifter.window[grain.position];

            grain.position++;
            if (grain.position >= GRAIN_SIZE) {
                shifter.grains.splice(i, 1);
            }
        }

        return output;
    }

    // Process chroma effect
    _processChroma(sample, state, depth) {
        if (depth < 0.001) return sample;

        switch (this.chroma) {
            case 0: // Oceanic Absorption (lowpass)
                return this._processLowpass(sample, state, depth);
            case 1: // White Water (highpass)
                return this._processHighpass(sample, state, depth);
            case 2: // Refraction Interference (bitcrusher)
                return this._processBitcrusher(sample, state, depth);
            case 3: // Pulse Amplification (saturation)
                return this._processSaturation(sample, depth);
            case 4: // Receptor Malfunction (wavefolder)
                return this._processWavefolder(sample, depth);
            case 5: // SOS (distortion)
                return this._processDistortion(sample, depth);
            default:
                return sample;
        }
    }

    // 4-pole lowpass filter
    _processLowpass(sample, state, depth) {
        // Cutoff: 20000Hz -> 200Hz as depth increases
        const cutoff = 20000 * Math.pow(0.01, depth);
        const coeffs = this._calcBiquadLP(cutoff);

        let x = sample;
        for (const s of state.lpf) {
            const y = coeffs.b0 * x + coeffs.b1 * s.x1 + coeffs.b2 * s.x2
                    - coeffs.a1 * s.y1 - coeffs.a2 * s.y2;
            s.x2 = s.x1; s.x1 = x;
            s.y2 = s.y1; s.y1 = y;
            x = y;
        }
        return x;
    }

    // 4-pole highpass filter
    _processHighpass(sample, state, depth) {
        // Cutoff: 20Hz -> 2000Hz as depth increases
        const cutoff = 20 + depth * 1980;
        const coeffs = this._calcBiquadHP(cutoff);

        let x = sample;
        for (const s of state.hpf) {
            const y = coeffs.b0 * x + coeffs.b1 * s.x1 + coeffs.b2 * s.x2
                    - coeffs.a1 * s.y1 - coeffs.a2 * s.y2;
            s.x2 = s.x1; s.x1 = x;
            s.y2 = s.y1; s.y1 = y;
            x = y;
        }
        return x;
    }

    // Calculate biquad lowpass coefficients
    _calcBiquadLP(cutoff) {
        const omega = 2 * Math.PI * cutoff / this.sampleRate;
        const sin = Math.sin(omega);
        const cos = Math.cos(omega);
        const alpha = sin / (2 * Math.SQRT2);

        const a0 = 1 + alpha;
        return {
            b0: ((1 - cos) / 2) / a0,
            b1: (1 - cos) / a0,
            b2: ((1 - cos) / 2) / a0,
            a1: (-2 * cos) / a0,
            a2: (1 - alpha) / a0
        };
    }

    // Calculate biquad highpass coefficients
    _calcBiquadHP(cutoff) {
        const omega = 2 * Math.PI * cutoff / this.sampleRate;
        const sin = Math.sin(omega);
        const cos = Math.cos(omega);
        const alpha = sin / (2 * Math.SQRT2);

        const a0 = 1 + alpha;
        return {
            b0: ((1 + cos) / 2) / a0,
            b1: -(1 + cos) / a0,
            b2: ((1 + cos) / 2) / a0,
            a1: (-2 * cos) / a0,
            a2: (1 - alpha) / a0
        };
    }

    // Bitcrusher
    _processBitcrusher(sample, state, depth) {
        const bits = Math.max(2, 16 - depth * 14);
        const srReduction = Math.max(1, Math.floor(depth * 32));

        state.crusherCounter++;
        if (state.crusherCounter >= srReduction) {
            state.crusherCounter = 0;
            state.crusherHold = sample;
        }

        const levels = Math.pow(2, bits);
        return Math.round(state.crusherHold * levels) / levels;
    }

    // Saturation
    _processSaturation(sample, depth) {
        const drive = 1 + depth * 4;
        const x = sample * drive;

        // Asymmetric soft clip (warm tube-like)
        if (x > 0) {
            return Math.tanh(x * 1.5) / 1.5;
        } else {
            return Math.tanh(x) / 1.2;
        }
    }

    // Wavefolder
    _processWavefolder(sample, depth) {
        const drive = 1 + depth * 5;
        const x = sample * drive;

        // Sine-based folding (Buchla-style)
        return Math.sin(x * Math.PI) * 0.8;
    }

    // Distortion
    _processDistortion(sample, depth) {
        const drive = 1 + depth * 20;
        const x = sample * drive;

        // Hard clip with saturation
        const clipped = Math.max(-1, Math.min(1, x));
        return Math.tanh(clipped * 3) * 0.7;
    }

    // Apply feedback routing
    _applyFeedbackRouting(delayOutputs, feedbackAmount) {
        const fb = Math.min(0.99, feedbackAmount); // Safety limit

        switch (this.feedbackMode) {
            case 'normal':
                return delayOutputs.map(out => out * fb);

            case 'pingPong':
                // L channels get R outputs, R channels get L outputs
                return [
                    delayOutputs[4] * fb, delayOutputs[5] * fb, delayOutputs[6] * fb, delayOutputs[7] * fb,
                    delayOutputs[0] * fb, delayOutputs[1] * fb, delayOutputs[2] * fb, delayOutputs[3] * fb
                ];

            case 'cascade':
                // Serial: 4L->1L, 1L->2L, 2L->3L, 3L->4L (same for R)
                return [
                    delayOutputs[3] * fb, delayOutputs[0] * fb, delayOutputs[1] * fb, delayOutputs[2] * fb,
                    delayOutputs[7] * fb, delayOutputs[4] * fb, delayOutputs[5] * fb, delayOutputs[6] * fb
                ];

            case 'adrift':
                // Cross-channel cascade
                return [
                    delayOutputs[7] * fb, delayOutputs[4] * fb, delayOutputs[5] * fb, delayOutputs[6] * fb,
                    delayOutputs[0] * fb, delayOutputs[1] * fb, delayOutputs[2] * fb, delayOutputs[3] * fb
                ];

            default:
                return delayOutputs.map(out => out * fb);
        }
    }

    // Process reverb
    _processReverb(inputL, inputR, mix) {
        if (mix < 0.001) return [inputL, inputR];

        const input = (inputL + inputR) * 0.5;

        // Comb filters in parallel
        let combSum = 0;
        for (const comb of this.reverb.combs) {
            const delayed = comb.buffer[comb.index];
            const filtered = this.reverb.lowpassState * this.reverb.dampening +
                            delayed * (1 - this.reverb.dampening);
            this.reverb.lowpassState = filtered;

            comb.buffer[comb.index] = input + filtered * comb.feedback * mix;
            comb.index = (comb.index + 1) % comb.buffer.length;
            combSum += delayed;
        }
        combSum /= this.reverb.combs.length;

        // Allpass filters in series
        let apOut = combSum;
        for (const ap of this.reverb.allpasses) {
            const delayed = ap.buffer[ap.index];
            const output = -apOut + delayed;
            ap.buffer[ap.index] = apOut + delayed * 0.5;
            ap.index = (ap.index + 1) % ap.buffer.length;
            apOut = output;
        }

        return [
            inputL * (1 - mix) + apOut * mix,
            inputR * (1 - mix) + apOut * mix
        ];
    }

    // Main process function
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input[0]) return true;

        const inputL = input[0];
        const inputR = input[1] || input[0];
        const outputL = output[0];
        const outputR = output[1] || output[0];

        for (let i = 0; i < inputL.length; i++) {
            // Smooth parameters
            this._smoothParam(this.params.mix);
            this._smoothParam(this.params.feedback);
            this._smoothParam(this.params.dispersal);
            this._smoothParam(this.params.depth);
            this._smoothParam(this.params.reverbMix);

            const inL = inputL[i];
            const inR = inputR[i];

            // === READ FROM DELAY LINES ===
            const delayOutputs = new Array(8);
            for (let j = 0; j < 8; j++) {
                const line = this.delayLines[j];
                const isActive = (j % 4) < this.sensors;

                if (!isActive) {
                    delayOutputs[j] = 0;
                    continue;
                }

                // Read based on delay mode
                let sample;
                if (this.delayMode === 'fade') {
                    sample = this._readWithFade(line);
                } else if (this.delayMode === 'doppler') {
                    sample = this._readWithDoppler(line);
                } else {
                    // shimmer/deshimmer - read normally, pitch shift applied to feedback
                    if (line.reversed) {
                        sample = this._readDelayLineReversed(line, line.delayTime);
                    } else {
                        sample = this._readDelayLine(line, line.delayTime);
                    }
                }

                delayOutputs[j] = sample;
            }

            // === SUM DELAY OUTPUTS PER CHANNEL ===
            let wetL = 0, wetR = 0;
            for (let j = 0; j < 4; j++) {
                wetL += delayOutputs[j] / this.sensors;
                wetR += delayOutputs[j + 4] / this.sensors;
            }

            // === APPLY FREEZE ===
            if (this.freezeActive && this.freezeBuffer) {
                const idx = this.freezePlayhead * 2;
                wetL = this.freezeBuffer[idx];
                wetR = this.freezeBuffer[idx + 1];
                this.freezePlayhead = (this.freezePlayhead + 1) % this.freezeLength;
            }

            // === APPLY REVERB ===
            [wetL, wetR] = this._processReverb(wetL, wetR, this.params.reverbMix.current);

            // === CALCULATE FEEDBACK ===
            let feedbackSignals = this._applyFeedbackRouting(delayOutputs, this.params.feedback.current);

            // Apply chroma effects and pitch shifting to feedback
            for (let j = 0; j < 8; j++) {
                let fb = feedbackSignals[j];

                // Apply chroma effect
                fb = this._processChroma(fb, this.chromaStates[j], this.params.depth.current);

                // Apply pitch shifting in shimmer modes
                if (this.delayMode === 'shimmer') {
                    fb = this._processPitchShifter(this.pitchShifters[0], fb);
                } else if (this.delayMode === 'deshimmer') {
                    fb = this._processPitchShifter(this.pitchShifters[1], fb);
                }

                feedbackSignals[j] = fb;
            }

            // === WRITE TO DELAY LINES ===
            for (let j = 0; j < 4; j++) {
                const lineL = this.delayLines[j];
                const lineR = this.delayLines[j + 4];

                lineL.buffer[lineL.writeIndex] = inL + feedbackSignals[j];
                lineR.buffer[lineR.writeIndex] = inR + feedbackSignals[j + 4];

                lineL.writeIndex = (lineL.writeIndex + 1) % MAX_DELAY_SAMPLES;
                lineR.writeIndex = (lineR.writeIndex + 1) % MAX_DELAY_SAMPLES;
            }

            // === MIX OUTPUT ===
            const mix = this.params.mix.current;
            outputL[i] = inL * (1 - mix) + wetL * mix;
            outputR[i] = inR * (1 - mix) + wetR * mix;
        }

        return true;
    }
}

registerProcessor('nautilus-processor', NautilusProcessor);
