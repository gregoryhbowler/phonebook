// BASIL PROCESSOR - AudioWorkletProcessor
// Bastl Instruments Basil "Flexible Stereo Space Delay" emulation
// Runs in audio thread - stereo delay with SPACE section (blur, filter, taps)

// Hardware specs: 41.66 kHz max, 16-bit
// Max delay: 0.5s stereo at full speed, 1s via ping-pong, up to 4s at 1/8 speed
const MAX_DELAY_SAMPLES = 192000;  // ~4 seconds @ 48kHz (for 1/8 speed mode)
const DIFFUSER_DELAYS = [149, 211, 307, 419];  // Prime-based delays for blur
const ALLPASS_DELAYS = [113, 173, 241, 337];   // For blur in feedback path

class BasilProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        this.sampleRate = options.processorOptions?.sampleRate || 48000;

        // === STEREO DELAY BUFFERS ===
        // Two independent delay lines for true stereo
        this.delayBufferL = new Float32Array(MAX_DELAY_SAMPLES);
        this.delayBufferR = new Float32Array(MAX_DELAY_SAMPLES);
        this.writeIndexL = 0;
        this.writeIndexR = 0;

        // === DELAY TIME STATE ===
        this.baseDelayTime = this.sampleRate * 0.25;      // Current base delay in samples
        this.targetDelayTime = this.sampleRate * 0.25;    // Target for smooth changes
        this.stereoSpread = 0;                            // 0-1: stereo time difference
        this.fineAdjust = 0;                              // -1 to 1: fine tuning

        // Actual delay times per channel (computed from base + stereo + fine)
        this.delayTimeL = this.baseDelayTime;
        this.delayTimeR = this.baseDelayTime;
        this.targetDelayTimeL = this.baseDelayTime;
        this.targetDelayTimeR = this.baseDelayTime;

        // === SMOOTHED PARAMETERS ===
        this.params = {
            mix: { current: 0.5, target: 0.5 },           // Dry/wet (constant power)
            feedback: { current: 0.5, target: 0.5 },      // 0-1 with sign for ping-pong
            blur: { current: 0, target: 0 },              // -1 to 1 (left=pre, right=post feedback)
            filter: { current: 0, target: 0 },            // -1 to 1 (left=LP, right=HP)
            taps: { current: 0, target: 0 },              // -1 to 1 (left=odd+even, right=even only)
            inputGain: { current: 1, target: 1 }          // Input level control
        };
        this.smoothingRate = 0.0005;  // Slower smoothing for smooth transitions

        // === DISCRETE PARAMETERS ===
        this.speedMode = 0;           // 0=1x, 1=1/2, 2=1/4, 3=1/8
        this.lofiMode = false;        // Anti-aliasing filter bypass
        this.feedbackMode = 'normal'; // 'normal' or 'pingPong'

        // === CLOCK SYNC ===
        this.bpm = 120;
        this.syncEnabled = false;
        this.clockDivision = 1;       // Beat multiplier

        // === FREEZE STATE ===
        this.freezeActive = false;
        this.freezeBufferL = null;
        this.freezeBufferR = null;
        this.freezeLength = 0;
        this.freezePlayhead = 0;

        // === SPACE SECTION STATES ===

        // Blur (diffusion) - allpass network for smearing
        this.blurPreStates = this._createDiffuserStates();
        this.blurPostStates = this._createDiffuserStates();

        // Filter in feedback path (LP or HP based on filter param sign)
        this.filterStateL = this._createFilterState();
        this.filterStateR = this._createFilterState();

        // === FEEDBACK PATH PROCESSING ===

        // Compressor/limiter state (to prevent feedback explosion)
        this.compressorStateL = { envelope: 0, gain: 1 };
        this.compressorStateR = { envelope: 0, gain: 1 };

        // Anti-aliasing filter for lower sample rates
        this.antiAliasStateL = this._createFilterState();
        this.antiAliasStateR = this._createFilterState();

        // === TAPS (multi-tap delay) ===
        // Tap positions are fractions of the main delay time
        // Odd taps: 1/3, 1/5, 1/7, 1/9
        // Even taps: 1/2, 1/4, 1/6, 1/8

        // === SAMPLE RATE DECIMATION FOR SPEED MODES ===
        this.decimationCounter = 0;
        this.holdSampleL = 0;
        this.holdSampleR = 0;

        // === MESSAGE HANDLING ===
        this.port.onmessage = (e) => this._handleMessage(e.data);

        // Initialize delay times
        this._updateDelayTimes();
    }

    // Create diffuser states for blur effect
    _createDiffuserStates() {
        return {
            // 4 allpass filters for diffusion
            allpasses: DIFFUSER_DELAYS.map(d => ({
                buffer: new Float32Array(d),
                index: 0,
                feedback: 0.5
            })),
            // Additional allpasses for stereo spread
            allpassesR: ALLPASS_DELAYS.map(d => ({
                buffer: new Float32Array(d),
                index: 0,
                feedback: 0.5
            }))
        };
    }

    // Create filter state (biquad)
    _createFilterState() {
        return {
            x1: 0, x2: 0,
            y1: 0, y2: 0
        };
    }

    // Handle messages from main thread
    _handleMessage(data) {
        switch (data.type) {
            case 'setParam':
                this._setParam(data.name, data.value);
                break;
            case 'setSpeedMode':
                this.speedMode = Math.max(0, Math.min(3, Math.round(data.mode)));
                this._updateDelayTimes();
                break;
            case 'setLoFi':
                this.lofiMode = !!data.active;
                break;
            case 'setFeedbackMode':
                this.feedbackMode = data.mode === 'pingPong' ? 'pingPong' : 'normal';
                break;
            case 'setBPM':
                this.bpm = data.bpm;
                if (this.syncEnabled) {
                    this._updateDelayTimes();
                }
                break;
            case 'setSync':
                this.syncEnabled = !!data.enabled;
                if (data.division !== undefined) {
                    this.clockDivision = data.division;
                }
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
            case 'time':
                // Time parameter: 0 = longest delay, 1 = shortest
                // Maps to actual delay time based on speed mode
                this._setDelayTime(value);
                break;
            case 'stereo':
                // Stereo spread: 0 = identical, 1 = L is 2x R delay
                this.stereoSpread = Math.max(0, Math.min(1, value));
                this._updateDelayTimes();
                break;
            case 'fine':
                // Fine adjustment: -1 to 1
                this.fineAdjust = Math.max(-1, Math.min(1, value));
                this._updateDelayTimes();
                break;
            case 'mix':
            case 'blur':
            case 'filter':
            case 'taps':
            case 'inputGain':
                if (this.params[name]) {
                    this.params[name].target = value;
                }
                break;
            case 'feedback':
                // Feedback: -1 to 1
                // Negative = ping-pong mode, positive = normal
                // Abs value is the amount
                this.params.feedback.target = Math.max(-1, Math.min(1, value));
                this.feedbackMode = value < 0 ? 'pingPong' : 'normal';
                break;
        }
    }

    // Set delay time from normalized parameter (0-1)
    _setDelayTime(normalized) {
        // Get max delay based on speed mode
        const speedMultipliers = [1, 2, 4, 8];
        const speedMult = speedMultipliers[this.speedMode];

        // Base max delay at full speed is 0.5s stereo
        const maxDelaySeconds = 0.5 * speedMult;
        const minDelaySeconds = 0.001;

        // Invert: 0 = longest (CCW), 1 = shortest (CW)
        const delaySeconds = minDelaySeconds + (1 - normalized) * (maxDelaySeconds - minDelaySeconds);
        this.targetDelayTime = delaySeconds * this.sampleRate;

        this._updateDelayTimes();
    }

    // Update actual delay times based on all factors
    _updateDelayTimes() {
        let baseDelay = this.targetDelayTime;

        // Apply sync if enabled
        if (this.syncEnabled) {
            const beatDuration = 60.0 / this.bpm;
            const syncedDelay = beatDuration * this.clockDivision * this.sampleRate;
            // Quantize to sync divisions
            baseDelay = this._quantizeToSync(syncedDelay);
        }

        // Apply stereo spread
        // At stereo=1: L delay = 2x base, R delay = 0.5x base
        // This maintains the same center while spreading
        const spreadFactor = this.stereoSpread;
        const delayL = baseDelay * (1 + spreadFactor * 0.5);
        const delayR = baseDelay * (1 - spreadFactor * 0.5);

        // Apply fine adjustment (small percentage)
        const fineRange = baseDelay * 0.1;  // 10% range
        const fineOffset = this.fineAdjust * fineRange;

        this.targetDelayTimeL = Math.max(1, Math.min(MAX_DELAY_SAMPLES - 1, delayL + fineOffset));
        this.targetDelayTimeR = Math.max(1, Math.min(MAX_DELAY_SAMPLES - 1, delayR + fineOffset));
    }

    // Quantize delay to sync divisions
    _quantizeToSync(targetDelay) {
        const divisions = [
            32, 24, 16, 12, 8, 6, 4, 3, 2, 1,
            0.75, 0.5, 0.333, 0.25, 0.167, 0.125
        ];

        const beatDuration = 60.0 / this.bpm;
        const beatSamples = beatDuration * this.sampleRate;

        // Find closest division
        let closestDelay = targetDelay;
        let closestDiff = Infinity;

        for (const div of divisions) {
            const divDelay = beatSamples * div;
            const diff = Math.abs(divDelay - targetDelay);
            if (diff < closestDiff) {
                closestDiff = diff;
                closestDelay = divDelay;
            }
        }

        return closestDelay;
    }

    // Activate freeze mode
    _activateFreeze() {
        const freezeLen = Math.min(
            Math.floor(this.delayTimeL),
            MAX_DELAY_SAMPLES / 2
        );

        this.freezeLength = freezeLen;
        this.freezeBufferL = new Float32Array(freezeLen);
        this.freezeBufferR = new Float32Array(freezeLen);

        // Copy current buffer contents
        for (let i = 0; i < freezeLen; i++) {
            const idxL = (this.writeIndexL - freezeLen + i + MAX_DELAY_SAMPLES) % MAX_DELAY_SAMPLES;
            const idxR = (this.writeIndexR - freezeLen + i + MAX_DELAY_SAMPLES) % MAX_DELAY_SAMPLES;
            this.freezeBufferL[i] = this.delayBufferL[idxL];
            this.freezeBufferR[i] = this.delayBufferR[idxR];
        }

        this.freezePlayhead = 0;
        this.freezeActive = true;

        this.port.postMessage({ type: 'freezeComplete' });
    }

    // Purge all buffers
    _purge() {
        this.delayBufferL.fill(0);
        this.delayBufferR.fill(0);
        this.freezeActive = false;
    }

    // Smooth parameter transition
    _smoothParam(param) {
        param.current += (param.target - param.current) * this.smoothingRate;
    }

    // Read from delay buffer with linear interpolation
    _readDelay(buffer, writeIndex, delaySamples) {
        const readPos = (writeIndex - delaySamples + MAX_DELAY_SAMPLES) % MAX_DELAY_SAMPLES;
        const floor = Math.floor(readPos);
        const frac = readPos - floor;
        const next = (floor + 1) % MAX_DELAY_SAMPLES;

        return buffer[floor] * (1 - frac) + buffer[next] * frac;
    }

    // Read multiple taps and sum
    _readTaps(buffer, writeIndex, baseDelay, tapsAmount) {
        if (Math.abs(tapsAmount) < 0.01) return 0;

        const absAmount = Math.abs(tapsAmount);
        const useEvenOnly = tapsAmount > 0;  // Right side = even only

        let sum = 0;
        let count = 0;

        if (useEvenOnly) {
            // Even divisions: 1/2, 1/4, 1/6, 1/8
            const evenTaps = [0.5, 0.25, 0.167, 0.125];
            for (let i = 0; i < 4; i++) {
                if (absAmount > i * 0.25) {
                    const tapDelay = baseDelay * evenTaps[i];
                    sum += this._readDelay(buffer, writeIndex, tapDelay);
                    count++;
                }
            }
        } else {
            // Odd + even divisions: 1/2, 1/3, 1/4, 1/5, 1/6, 1/7, 1/8
            const allTaps = [0.5, 0.333, 0.25, 0.2, 0.167, 0.143, 0.125];
            for (let i = 0; i < 7; i++) {
                if (absAmount > i * 0.143) {
                    const tapDelay = baseDelay * allTaps[i];
                    sum += this._readDelay(buffer, writeIndex, tapDelay);
                    count++;
                }
            }
        }

        return count > 0 ? (sum / count) * absAmount : 0;
    }

    // Process blur (diffusion) through allpass network
    _processBlur(sampleL, sampleR, states, amount) {
        if (Math.abs(amount) < 0.01) return [sampleL, sampleR];

        const absAmount = Math.abs(amount);
        let outL = sampleL;
        let outR = sampleR;

        // Process through cascaded allpasses
        for (let i = 0; i < states.allpasses.length; i++) {
            const apL = states.allpasses[i];
            const apR = states.allpassesR[i];

            // Allpass: output = -input + delayed + (delayed * feedback)
            const delayedL = apL.buffer[apL.index];
            const delayedR = apR.buffer[apR.index];

            const newL = -outL + delayedL;
            const newR = -outR + delayedR;

            apL.buffer[apL.index] = outL + delayedL * apL.feedback;
            apR.buffer[apR.index] = outR + delayedR * apR.feedback;

            apL.index = (apL.index + 1) % apL.buffer.length;
            apR.index = (apR.index + 1) % apR.buffer.length;

            outL = newL;
            outR = newR;
        }

        // Mix original with diffused
        return [
            sampleL * (1 - absAmount) + outL * absAmount,
            sampleR * (1 - absAmount) + outR * absAmount
        ];
    }

    // Process filter (LP when filter < 0, HP when filter > 0)
    _processFilter(sample, state, filterAmount) {
        if (Math.abs(filterAmount) < 0.01) return sample;

        const absAmount = Math.abs(filterAmount);
        const isLowpass = filterAmount < 0;

        // Calculate cutoff frequency
        // LP: 20kHz -> 200Hz as amount increases
        // HP: 20Hz -> 2000Hz as amount increases
        let cutoff;
        if (isLowpass) {
            cutoff = 20000 * Math.pow(0.01, absAmount);
        } else {
            cutoff = 20 + absAmount * 1980;
        }

        // Calculate biquad coefficients
        const omega = 2 * Math.PI * cutoff / this.sampleRate;
        const sin = Math.sin(omega);
        const cos = Math.cos(omega);
        const alpha = sin / (2 * Math.SQRT2);
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

        // Apply filter
        const y = b0 * sample + b1 * state.x1 + b2 * state.x2
                - a1 * state.y1 - a2 * state.y2;

        state.x2 = state.x1;
        state.x1 = sample;
        state.y2 = state.y1;
        state.y1 = y;

        return y;
    }

    // Process anti-aliasing filter for lower sample rates
    _processAntiAlias(sample, state, speedMode) {
        if (speedMode === 0 || this.lofiMode) return sample;

        // Nyquist frequencies for each speed mode
        // 1/2 speed: 10.4kHz, 1/4: 5.2kHz, 1/8: 2.6kHz
        const nyquistFreqs = [20000, 10400, 5200, 2600];
        const cutoff = nyquistFreqs[speedMode] * 0.9;  // Slight margin

        return this._processFilter(sample, state, -0.8);  // Use LP filter
    }

    // Compressor/limiter in feedback path
    _processCompressor(sample, state) {
        const threshold = 0.8;
        const ratio = 4;
        const attack = 0.001;
        const release = 0.1;

        const absSample = Math.abs(sample);

        // Envelope follower
        const attackCoeff = 1 - Math.exp(-1 / (attack * this.sampleRate));
        const releaseCoeff = 1 - Math.exp(-1 / (release * this.sampleRate));

        if (absSample > state.envelope) {
            state.envelope += (absSample - state.envelope) * attackCoeff;
        } else {
            state.envelope += (absSample - state.envelope) * releaseCoeff;
        }

        // Calculate gain reduction
        if (state.envelope > threshold) {
            const excess = state.envelope - threshold;
            const compressed = threshold + excess / ratio;
            state.gain = compressed / state.envelope;
        } else {
            state.gain = 1;
        }

        // Soft saturation for overdrive character
        const compressed = sample * state.gain;
        return Math.tanh(compressed * 1.2) / 1.2;
    }

    // Constant power crossfade
    _constantPowerMix(dry, wet, mix) {
        const dryGain = Math.cos(mix * Math.PI * 0.5);
        const wetGain = Math.sin(mix * Math.PI * 0.5);
        return dry * dryGain + wet * wetGain;
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

        // Speed mode decimation factors
        const decimationFactors = [1, 2, 4, 8];
        const decimation = decimationFactors[this.speedMode];

        for (let i = 0; i < inputL.length; i++) {
            // Smooth all parameters
            this._smoothParam(this.params.mix);
            this._smoothParam(this.params.feedback);
            this._smoothParam(this.params.blur);
            this._smoothParam(this.params.filter);
            this._smoothParam(this.params.taps);
            this._smoothParam(this.params.inputGain);

            // Smooth delay time transitions (prevents clicks)
            this.delayTimeL += (this.targetDelayTimeL - this.delayTimeL) * 0.0001;
            this.delayTimeR += (this.targetDelayTimeR - this.delayTimeR) * 0.0001;

            // Get input samples with gain
            let inL = inputL[i] * this.params.inputGain.current;
            let inR = inputR[i] * this.params.inputGain.current;

            // === SAMPLE RATE DECIMATION FOR SPEED MODES ===
            this.decimationCounter++;
            if (this.decimationCounter >= decimation) {
                this.decimationCounter = 0;
                this.holdSampleL = inL;
                this.holdSampleR = inR;
            }

            // Use held samples for lower sample rates
            if (decimation > 1) {
                inL = this.holdSampleL;
                inR = this.holdSampleR;
            }

            // === READ FROM DELAY BUFFERS ===
            let wetL, wetR;

            if (this.freezeActive && this.freezeBufferL) {
                // In freeze mode, read from frozen buffer
                wetL = this.freezeBufferL[this.freezePlayhead];
                wetR = this.freezeBufferR[this.freezePlayhead];
                this.freezePlayhead = (this.freezePlayhead + 1) % this.freezeLength;
            } else {
                // Normal delay read
                wetL = this._readDelay(this.delayBufferL, this.writeIndexL, this.delayTimeL);
                wetR = this._readDelay(this.delayBufferR, this.writeIndexR, this.delayTimeR);

                // Add multi-taps
                const tapsAmount = this.params.taps.current;
                wetL += this._readTaps(this.delayBufferL, this.writeIndexL, this.delayTimeL, tapsAmount);
                wetR += this._readTaps(this.delayBufferR, this.writeIndexR, this.delayTimeR, tapsAmount);
            }

            // === APPLY BLUR (PRE-FEEDBACK) ===
            const blurAmount = this.params.blur.current;
            if (blurAmount < 0) {
                // Negative blur = pre-feedback diffusion
                [wetL, wetR] = this._processBlur(wetL, wetR, this.blurPreStates, -blurAmount);
            }

            // === FILTER IN FEEDBACK PATH ===
            const filterAmount = this.params.filter.current;
            let filteredL = this._processFilter(wetL, this.filterStateL, filterAmount);
            let filteredR = this._processFilter(wetR, this.filterStateR, filterAmount);

            // === APPLY BLUR (POST-FEEDBACK / IN FEEDBACK PATH) ===
            if (blurAmount > 0) {
                // Positive blur = in feedback path (more lush/resonant)
                [filteredL, filteredR] = this._processBlur(filteredL, filteredR, this.blurPostStates, blurAmount);
            }

            // === FEEDBACK ROUTING ===
            const fbAmount = Math.abs(this.params.feedback.current);
            const fbSafe = Math.min(0.98, fbAmount);  // Safety limit

            let feedbackL, feedbackR;
            if (this.feedbackMode === 'pingPong') {
                // Ping-pong: cross-feedback
                feedbackL = filteredR * fbSafe;
                feedbackR = filteredL * fbSafe;
            } else {
                // Normal feedback
                feedbackL = filteredL * fbSafe;
                feedbackR = filteredR * fbSafe;
            }

            // === COMPRESSOR/OVERDRIVE IN FEEDBACK PATH ===
            feedbackL = this._processCompressor(feedbackL, this.compressorStateL);
            feedbackR = this._processCompressor(feedbackR, this.compressorStateR);

            // === ANTI-ALIASING FILTER FOR LOWER SPEEDS ===
            if (!this.lofiMode && this.speedMode > 0) {
                feedbackL = this._processAntiAlias(feedbackL, this.antiAliasStateL, this.speedMode);
                feedbackR = this._processAntiAlias(feedbackR, this.antiAliasStateR, this.speedMode);
            }

            // === WRITE TO DELAY BUFFERS ===
            if (!this.freezeActive) {
                this.delayBufferL[this.writeIndexL] = inL + feedbackL;
                this.delayBufferR[this.writeIndexR] = inR + feedbackR;

                this.writeIndexL = (this.writeIndexL + 1) % MAX_DELAY_SAMPLES;
                this.writeIndexR = (this.writeIndexR + 1) % MAX_DELAY_SAMPLES;
            }

            // === DRY/WET MIX (CONSTANT POWER) ===
            const mix = this.params.mix.current;
            outputL[i] = this._constantPowerMix(inputL[i], wetL, mix);
            outputR[i] = this._constantPowerMix(inputR[i], wetR, mix);
        }

        return true;
    }
}

registerProcessor('basil-processor', BasilProcessor);
