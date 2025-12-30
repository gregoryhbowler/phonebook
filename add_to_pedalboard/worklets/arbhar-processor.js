// ARBHAR PROCESSOR - AudioWorkletProcessor
// Instruō Arbhar Granular Audio Processor Emulation
// 48kHz, 32-bit depth, six 10-second audio layers
// Up to 88 polyphonic grains between two granular engines

// Buffer configuration: 10 seconds per layer at 48kHz
const LAYER_DURATION = 10; // seconds
const MAX_SAMPLE_RATE = 48000;
const SAMPLES_PER_LAYER = MAX_SAMPLE_RATE * LAYER_DURATION;
const NUM_LAYERS = 6;

// Grain configuration
const MAX_GRAINS_PER_ENGINE = 44;
const MAX_TOTAL_GRAINS = 88;

// Grain length range (in seconds)
const MIN_GRAIN_LENGTH = 0.004;  // ~4ms
const MAX_GRAIN_LENGTH = 3.0;    // 3 seconds

// Pitch range (in octaves from center)
const PITCH_RANGE_OCTAVES = 2;   // -2 to +2 octaves

// Grain window types
const WINDOW_GAUSSIAN = 0;
const WINDOW_SQUARE = 1;
const WINDOW_SAWTOOTH = 2;

// Scan modes
const MODE_SCAN = 0;
const MODE_FOLLOW = 1;
const MODE_WAVETABLE = 2;

// Pitch quantization scales (semitones from root)
const SCALES = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],  // Chromatic
    [0, 2, 4, 5, 7, 9, 11],                   // Major
    [0, 2, 3, 5, 7, 8, 10],                   // Minor
    [0, 2, 4, 7, 9],                          // Pentatonic
    [0, 2, 4, 6, 8, 10],                      // Whole Tone
    [0, 7],                                    // Fifths
    [0]                                        // Octaves
];

class Grain {
    constructor() {
        this.active = false;
        this.layer = 0;
        this.startPosition = 0;     // Sample position in buffer
        this.currentPosition = 0;   // Current read position
        this.length = 0;            // Grain length in samples
        this.progress = 0;          // 0-1 progress through grain
        this.pitch = 1;             // Playback rate
        this.direction = 1;         // 1 = forward, -1 = reverse
        this.pan = 0.5;             // 0 = left, 1 = right
        this.amplitude = 1;         // Grain amplitude
        this.windowType = WINDOW_GAUSSIAN;
        this.tilt = 0.5;            // For sawtooth window
    }

    reset() {
        this.active = false;
        this.progress = 0;
        this.currentPosition = 0;
    }
}

class ArbharProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        this.sampleRate = options.processorOptions?.sampleRate || 48000;

        // === AUDIO BUFFERS (6 layers x 10 seconds stereo) ===
        this.layers = [];
        for (let i = 0; i < NUM_LAYERS; i++) {
            this.layers.push({
                bufferL: new Float32Array(SAMPLES_PER_LAYER),
                bufferR: new Float32Array(SAMPLES_PER_LAYER),
                writeHead: 0,
                length: 0,          // Amount of buffer filled
                isRecording: false
            });
        }

        // === GRAIN POOLS ===
        // Continuous engine grains
        this.continuousGrains = [];
        for (let i = 0; i < MAX_GRAINS_PER_ENGINE; i++) {
            this.continuousGrains.push(new Grain());
        }

        // Strike engine grains
        this.strikeGrains = [];
        for (let i = 0; i < MAX_GRAINS_PER_ENGINE; i++) {
            this.strikeGrains.push(new Grain());
        }

        // === PARAMETERS ===
        this.params = {
            scan: 0.5,
            spray: 0,
            intensity: 0.25,
            length: 0.3,
            pitch: 0.5,
            pitchSpray: 0,
            grainWindow: WINDOW_GAUSSIAN,
            tilt: 0.5,
            direction: 0.5,
            reverbMix: 0,
            reverbDecay: 0.5,
            feedback: 0,
            feedbackDelay: 0.3,
            pan: 0.5,
            panSpray: 0.5,
            mix: 0.5,
            grainLevel: 1,
            directLevel: 0
        };

        // === STATE ===
        this.scanMode = MODE_SCAN;
        this.activeLayer = 0;
        this.continuousEngineEnabled = true;
        this.strikeEngineEnabled = false;
        this.freezeActive = false;

        // Recording state
        this.isRecording = false;
        this.autoCapture = true;
        this.captureThreshold = 0.1;
        this.autoCaptureActive = false;
        this.autoCaptureHoldoff = 0;

        // Pitch quantization
        this.pitchQuantize = false;
        this.pitchScale = 0;

        // Follow mode state
        this.followPosition = 0;
        this.followSpeed = 1;

        // Clock/timing
        this.clockBPM = 120;
        this.externalClock = false;
        this.grainClock = 0;
        this.lastGrainTime = 0;

        // === REVERB STATE (Schroeder reverb) ===
        this.reverbBufferSize = Math.floor(this.sampleRate * 0.1);
        this.combDelays = [1557, 1617, 1491, 1422].map(d =>
            Math.floor(d * this.sampleRate / 44100));
        this.allpassDelays = [225, 556].map(d =>
            Math.floor(d * this.sampleRate / 44100));

        this.combBuffersL = this.combDelays.map(d => new Float32Array(d));
        this.combBuffersR = this.combDelays.map(d => new Float32Array(d));
        this.combIndices = this.combDelays.map(() => 0);

        this.allpassBuffersL = this.allpassDelays.map(d => new Float32Array(d));
        this.allpassBuffersR = this.allpassDelays.map(d => new Float32Array(d));
        this.allpassIndices = this.allpassDelays.map(() => 0);

        // === FEEDBACK DELAY STATE ===
        this.maxDelayTime = 2; // seconds
        this.delayBufferL = new Float32Array(Math.floor(this.sampleRate * this.maxDelayTime));
        this.delayBufferR = new Float32Array(Math.floor(this.sampleRate * this.maxDelayTime));
        this.delayWriteHead = 0;

        // === ONSET DETECTION STATE ===
        this.onsetEnvelope = 0;
        this.onsetThreshold = 0.1;
        this.onsetHoldoff = 0;
        this.onsetAttack = 0.001;
        this.onsetRelease = 0.01;

        // === SMOOTHING ===
        this.smoothedMix = 0.5;

        // === MESSAGE HANDLING ===
        this.port.onmessage = (e) => this._handleMessage(e.data);
    }

    // === MESSAGE HANDLING ===

    _handleMessage(data) {
        switch (data.type) {
            case 'setParam':
                this._setParam(data.name, data.value);
                break;
            case 'setScanMode':
                this.scanMode = Math.max(0, Math.min(2, data.mode));
                break;
            case 'setActiveLayer':
                this.activeLayer = Math.max(0, Math.min(5, data.layer));
                break;
            case 'setContinuousEngine':
                this.continuousEngineEnabled = !!data.enabled;
                break;
            case 'setStrikeEngine':
                this.strikeEngineEnabled = !!data.enabled;
                break;
            case 'strike':
                this._triggerStrike();
                break;
            case 'startRecording':
                this._startRecording();
                break;
            case 'stopRecording':
                this._stopRecording();
                break;
            case 'setAutoCapture':
                this.autoCapture = !!data.enabled;
                break;
            case 'setCaptureThreshold':
                this.captureThreshold = Math.max(0, Math.min(1, data.threshold));
                this.onsetThreshold = this.captureThreshold * 0.5;
                break;
            case 'freeze':
                this.freezeActive = !!data.active;
                break;
            case 'setPitchQuantize':
                this.pitchQuantize = !!data.enabled;
                break;
            case 'setPitchScale':
                this.pitchScale = Math.max(0, Math.min(SCALES.length - 1, data.scale));
                break;
            case 'clearLayer':
                this._clearLayer(data.layer);
                break;
            case 'clearAllLayers':
                for (let i = 0; i < NUM_LAYERS; i++) {
                    this._clearLayer(i);
                }
                break;
            case 'setBPM':
                this.clockBPM = Math.max(20, Math.min(300, data.bpm));
                break;
            case 'setExternalClock':
                this.externalClock = !!data.enabled;
                break;
        }
    }

    _setParam(name, value) {
        if (name in this.params) {
            this.params[name] = value;
        }
    }

    // === RECORDING ===

    _startRecording() {
        const layer = this.layers[this.activeLayer];
        layer.isRecording = true;
        layer.writeHead = 0;
        layer.length = 0;
        this.isRecording = true;
    }

    _stopRecording() {
        const layer = this.layers[this.activeLayer];
        layer.isRecording = false;
        layer.length = layer.writeHead;
        this.isRecording = false;
        this.autoCaptureActive = false;
    }

    _clearLayer(layerIndex) {
        if (layerIndex < 0 || layerIndex >= NUM_LAYERS) return;
        const layer = this.layers[layerIndex];
        layer.bufferL.fill(0);
        layer.bufferR.fill(0);
        layer.writeHead = 0;
        layer.length = 0;
        layer.isRecording = false;
    }

    // === ONSET DETECTION ===

    _detectOnset(inputL, inputR) {
        if (!this.autoCapture || this.autoCaptureActive) return false;
        if (this.onsetHoldoff > 0) {
            this.onsetHoldoff--;
            return false;
        }

        // Envelope follower
        const inputLevel = Math.max(Math.abs(inputL), Math.abs(inputR));

        if (inputLevel > this.onsetEnvelope) {
            this.onsetEnvelope += (inputLevel - this.onsetEnvelope) * this.onsetAttack * this.sampleRate;
        } else {
            this.onsetEnvelope += (inputLevel - this.onsetEnvelope) * this.onsetRelease;
        }

        // Check for onset
        if (inputLevel > this.onsetThreshold && inputLevel > this.onsetEnvelope * 1.5) {
            this.onsetHoldoff = Math.floor(this.sampleRate * 0.1); // 100ms holdoff
            return true;
        }

        return false;
    }

    // === GRAIN MANAGEMENT ===

    _getGrainLength() {
        // Logarithmic mapping from ~4ms to ~3s
        const minLog = Math.log(MIN_GRAIN_LENGTH);
        const maxLog = Math.log(MAX_GRAIN_LENGTH);
        const lengthSeconds = Math.exp(minLog + this.params.length * (maxLog - minLog));
        return Math.floor(lengthSeconds * this.sampleRate);
    }

    _getGrainPitch(withSpray = true) {
        // Map 0-1 to -2 to +2 octaves
        let pitch = (this.params.pitch - 0.5) * 2 * PITCH_RANGE_OCTAVES;

        // Add spray
        if (withSpray && this.params.pitchSpray > 0) {
            pitch += (Math.random() * 2 - 1) * this.params.pitchSpray * PITCH_RANGE_OCTAVES;
        }

        // Quantize if enabled
        if (this.pitchQuantize) {
            pitch = this._quantizePitch(pitch);
        }

        // Convert octaves to rate
        return Math.pow(2, pitch);
    }

    _quantizePitch(pitchOctaves) {
        // Convert octaves to semitones
        const semitones = pitchOctaves * 12;
        const scale = SCALES[this.pitchScale];

        // Find octave and note within octave
        const octave = Math.floor(semitones / 12);
        let note = ((semitones % 12) + 12) % 12;

        // Find closest scale degree
        let closestNote = scale[0];
        let minDist = Math.abs(note - scale[0]);

        for (const scaleNote of scale) {
            const dist = Math.abs(note - scaleNote);
            if (dist < minDist) {
                minDist = dist;
                closestNote = scaleNote;
            }
            // Also check wrapping
            const distWrap = Math.abs(note - (scaleNote + 12));
            if (distWrap < minDist) {
                minDist = distWrap;
                closestNote = scaleNote;
            }
        }

        // Convert back to octaves
        return (octave * 12 + closestNote) / 12;
    }

    _getGrainDirection() {
        // direction param: 0 = all reverse, 0.5 = 50/50, 1 = all forward
        return Math.random() < this.params.direction ? 1 : -1;
    }

    _getGrainPan() {
        // Base pan with spray
        let pan = this.params.pan;
        if (this.params.panSpray > 0) {
            // Coin-toss style panning
            pan = Math.random() < 0.5 ?
                this.params.pan - this.params.panSpray * 0.5 :
                this.params.pan + this.params.panSpray * 0.5;
        }
        return Math.max(0, Math.min(1, pan));
    }

    _getGrainStartPosition(layer) {
        const bufferLength = layer.length || SAMPLES_PER_LAYER;
        let position;

        switch (this.scanMode) {
            case MODE_SCAN:
                // Scan mode: position based on scan param with spray
                position = this.params.scan * bufferLength;
                if (this.params.spray > 0) {
                    position += (Math.random() * 2 - 1) * this.params.spray * bufferLength;
                }
                break;

            case MODE_FOLLOW:
                // Follow mode: position follows playhead
                position = this.followPosition;
                if (this.params.spray > 0) {
                    position += (Math.random() * 2 - 1) * this.params.spray * bufferLength * 0.1;
                }
                break;

            case MODE_WAVETABLE:
                // Wavetable mode: treat buffer as single cycle, scan selects position
                position = this.params.scan * bufferLength;
                break;

            default:
                position = this.params.scan * bufferLength;
        }

        // Wrap position
        position = ((position % bufferLength) + bufferLength) % bufferLength;
        return Math.floor(position);
    }

    _spawnGrain(grainPool, layer) {
        // Find inactive grain
        let grain = null;
        for (const g of grainPool) {
            if (!g.active) {
                grain = g;
                break;
            }
        }

        if (!grain) {
            // Steal oldest grain (lowest progress)
            grain = grainPool[0];
            for (const g of grainPool) {
                if (g.progress < grain.progress) {
                    grain = g;
                }
            }
        }

        // Initialize grain
        grain.active = true;
        grain.layer = this.activeLayer;
        grain.length = this._getGrainLength();
        grain.startPosition = this._getGrainStartPosition(layer);
        grain.currentPosition = grain.startPosition;
        grain.progress = 0;
        grain.pitch = this._getGrainPitch();
        grain.direction = this._getGrainDirection();
        grain.pan = this._getGrainPan();
        grain.amplitude = 1;
        grain.windowType = Math.floor(this.params.grainWindow);
        grain.tilt = this.params.tilt;

        return grain;
    }

    _triggerStrike() {
        if (!this.strikeEngineEnabled) return;

        const layer = this.layers[this.activeLayer];
        if (layer.length === 0) return;

        // Spawn multiple grains based on intensity
        const grainCount = this._getGrainCount();
        for (let i = 0; i < grainCount; i++) {
            this._spawnGrain(this.strikeGrains, layer);
        }
    }

    _getGrainCount() {
        // Exponential mapping: 1 grain at 0, up to 44 at 1
        return Math.max(1, Math.floor(Math.pow(this.params.intensity, 2) * (MAX_GRAINS_PER_ENGINE - 1) + 1));
    }

    // === GRAIN WINDOWING ===

    _getWindowValue(progress, windowType, tilt) {
        switch (windowType) {
            case WINDOW_GAUSSIAN:
                // Gaussian bell curve
                const x = (progress - 0.5) * 4; // -2 to +2
                return Math.exp(-x * x);

            case WINDOW_SQUARE:
                // Square window with tiny fade to prevent clicks
                const fadeLen = 0.01;
                if (progress < fadeLen) {
                    return progress / fadeLen;
                } else if (progress > 1 - fadeLen) {
                    return (1 - progress) / fadeLen;
                }
                return 1;

            case WINDOW_SAWTOOTH:
                // Asymmetric sawtooth based on tilt
                // tilt 0 = instant attack, slow decay
                // tilt 1 = slow attack, instant decay
                const attackLen = tilt;
                const decayLen = 1 - tilt;

                if (progress < attackLen) {
                    return attackLen > 0 ? progress / attackLen : 1;
                } else {
                    return decayLen > 0 ? (1 - progress) / decayLen : 1;
                }

            default:
                return 1;
        }
    }

    // === PROCESS GRAINS ===

    _processGrain(grain, outputL, outputR, i) {
        if (!grain.active) return;

        const layer = this.layers[grain.layer];
        const bufferLength = layer.length || SAMPLES_PER_LAYER;

        // Get window amplitude
        const windowAmp = this._getWindowValue(grain.progress, grain.windowType, grain.tilt);

        // Read from buffer with interpolation
        const readPos = grain.currentPosition;
        const readPosInt = Math.floor(readPos);
        const frac = readPos - readPosInt;

        const idx0 = ((readPosInt % bufferLength) + bufferLength) % bufferLength;
        const idx1 = ((readPosInt + 1) % bufferLength + bufferLength) % bufferLength;

        // Linear interpolation
        const sampleL = layer.bufferL[idx0] * (1 - frac) + layer.bufferL[idx1] * frac;
        const sampleR = layer.bufferR[idx0] * (1 - frac) + layer.bufferR[idx1] * frac;

        // Apply window and amplitude
        const ampL = windowAmp * grain.amplitude * this.params.grainLevel;
        const ampR = windowAmp * grain.amplitude * this.params.grainLevel;

        // Apply panning (constant power)
        const panAngle = grain.pan * Math.PI * 0.5;
        const panL = Math.cos(panAngle);
        const panR = Math.sin(panAngle);

        outputL[i] += sampleL * ampL * panL;
        outputR[i] += sampleR * ampR * panR;

        // Advance grain position
        grain.currentPosition += grain.pitch * grain.direction;
        grain.progress += 1 / grain.length;

        // Check if grain is complete
        if (grain.progress >= 1) {
            grain.active = false;
        }
    }

    // === REVERB PROCESSING ===

    _processReverb(inputL, inputR) {
        if (this.params.reverbMix < 0.01) return [inputL, inputR];

        const decay = 0.5 + this.params.reverbDecay * 0.45; // 0.5 to 0.95
        const combGains = [decay, decay * 0.95, decay * 0.9, decay * 0.85];

        // Comb filters in parallel
        let combOutL = 0;
        let combOutR = 0;

        for (let c = 0; c < this.combDelays.length; c++) {
            const delay = this.combDelays[c];
            const idx = this.combIndices[c];

            // Read from delay
            const delayedL = this.combBuffersL[c][idx];
            const delayedR = this.combBuffersR[c][idx];

            // Write to delay with feedback
            this.combBuffersL[c][idx] = inputL + delayedL * combGains[c];
            this.combBuffersR[c][idx] = inputR + delayedR * combGains[c];

            combOutL += delayedL;
            combOutR += delayedR;

            // Advance index
            this.combIndices[c] = (idx + 1) % delay;
        }

        combOutL *= 0.25;
        combOutR *= 0.25;

        // Allpass filters in series
        let allpassOutL = combOutL;
        let allpassOutR = combOutR;
        const allpassGain = 0.5;

        for (let a = 0; a < this.allpassDelays.length; a++) {
            const delay = this.allpassDelays[a];
            const idx = this.allpassIndices[a];

            const delayedL = this.allpassBuffersL[a][idx];
            const delayedR = this.allpassBuffersR[a][idx];

            const tempL = allpassOutL + delayedL * allpassGain;
            const tempR = allpassOutR + delayedR * allpassGain;

            this.allpassBuffersL[a][idx] = allpassOutL - delayedL * allpassGain;
            this.allpassBuffersR[a][idx] = allpassOutR - delayedR * allpassGain;

            allpassOutL = delayedL - tempL * allpassGain;
            allpassOutR = delayedR - tempR * allpassGain;

            this.allpassIndices[a] = (idx + 1) % delay;
        }

        // Mix
        const wet = this.params.reverbMix;
        return [
            inputL * (1 - wet) + allpassOutL * wet,
            inputR * (1 - wet) + allpassOutR * wet
        ];
    }

    // === FEEDBACK DELAY PROCESSING ===

    _processFeedbackDelay(inputL, inputR) {
        if (this.params.feedback < 0.01) return [inputL, inputR];

        // Calculate delay time
        // At low values, sync to grain length; at high values, longer delays
        const grainLengthSec = this._getGrainLength() / this.sampleRate;
        const maxDelaySec = this.maxDelayTime;
        const delaySec = grainLengthSec + this.params.feedbackDelay * (maxDelaySec - grainLengthSec);
        const delaySamples = Math.floor(delaySec * this.sampleRate);

        // Read from delay buffer
        const readHead = (this.delayWriteHead - delaySamples + this.delayBufferL.length) % this.delayBufferL.length;
        const delayedL = this.delayBufferL[readHead];
        const delayedR = this.delayBufferR[readHead];

        // Write to delay buffer with feedback
        const feedbackAmount = this.params.feedback * 0.85; // Limit to prevent runaway
        this.delayBufferL[this.delayWriteHead] = inputL + delayedL * feedbackAmount;
        this.delayBufferR[this.delayWriteHead] = inputR + delayedR * feedbackAmount;

        this.delayWriteHead = (this.delayWriteHead + 1) % this.delayBufferL.length;

        // Return mixed signal
        return [
            inputL + delayedL * this.params.feedback,
            inputR + delayedR * this.params.feedback
        ];
    }

    // === MAIN PROCESS ===

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!output || !output[0]) return true;

        const outputL = output[0];
        const outputR = output[1] || output[0];

        const hasInput = input && input[0] && input[0].length > 0;
        const inputL = hasInput ? input[0] : new Float32Array(outputL.length);
        const inputR = hasInput ? (input[1] || input[0]) : new Float32Array(outputR.length);

        // Smooth mix parameter
        this.smoothedMix += (this.params.mix - this.smoothedMix) * 0.001;

        // Get active layer
        const layer = this.layers[this.activeLayer];

        // Calculate grain spawn interval based on intensity
        const grainCount = this._getGrainCount();
        const grainInterval = this._getGrainLength() / grainCount;

        for (let i = 0; i < outputL.length; i++) {
            const inL = inputL[i] || 0;
            const inR = inputR[i] || 0;

            // === ONSET DETECTION & AUTO-CAPTURE ===
            if (this._detectOnset(inL, inR)) {
                this._startRecording();
                this.autoCaptureActive = true;
                this.autoCaptureHoldoff = Math.floor(this.sampleRate * LAYER_DURATION);
                this.port.postMessage({ type: 'onsetDetected' });
            }

            // Auto-stop recording after buffer is full
            if (this.autoCaptureActive) {
                this.autoCaptureHoldoff--;
                if (this.autoCaptureHoldoff <= 0 || layer.writeHead >= SAMPLES_PER_LAYER - 1) {
                    this._stopRecording();
                    this.port.postMessage({ type: 'bufferFull', layer: this.activeLayer });
                }
            }

            // === RECORD TO BUFFER ===
            if (layer.isRecording && !this.freezeActive) {
                layer.bufferL[layer.writeHead] = inL;
                layer.bufferR[layer.writeHead] = inR;
                layer.writeHead = (layer.writeHead + 1) % SAMPLES_PER_LAYER;
                if (layer.writeHead > layer.length) {
                    layer.length = layer.writeHead;
                }
            }

            // === UPDATE FOLLOW POSITION ===
            if (this.scanMode === MODE_FOLLOW && layer.length > 0) {
                // scan param controls speed in follow mode (-2x to +2x)
                this.followSpeed = (this.params.scan - 0.5) * 4;
                this.followPosition += this.followSpeed;

                // Wrap
                if (this.followPosition < 0) {
                    this.followPosition += layer.length;
                } else if (this.followPosition >= layer.length) {
                    this.followPosition -= layer.length;
                }
            }

            // === SPAWN CONTINUOUS GRAINS ===
            if (this.continuousEngineEnabled && layer.length > 0) {
                this.grainClock++;
                if (this.grainClock >= grainInterval) {
                    this.grainClock = 0;
                    this._spawnGrain(this.continuousGrains, layer);
                }
            }

            // === PROCESS ALL GRAINS ===
            let grainOutL = 0;
            let grainOutR = 0;

            // Temporary output arrays for accumulation
            const tempOutL = new Float32Array(1);
            const tempOutR = new Float32Array(1);

            // Process continuous engine grains
            for (const grain of this.continuousGrains) {
                tempOutL[0] = 0;
                tempOutR[0] = 0;
                this._processGrain(grain, tempOutL, tempOutR, 0);
                grainOutL += tempOutL[0];
                grainOutR += tempOutR[0];
            }

            // Process strike engine grains
            for (const grain of this.strikeGrains) {
                tempOutL[0] = 0;
                tempOutR[0] = 0;
                this._processGrain(grain, tempOutL, tempOutR, 0);
                grainOutL += tempOutL[0];
                grainOutR += tempOutR[0];
            }

            // Soft clip grain output to prevent overload from many grains
            grainOutL = Math.tanh(grainOutL);
            grainOutR = Math.tanh(grainOutR);

            // === APPLY FEEDBACK DELAY ===
            [grainOutL, grainOutR] = this._processFeedbackDelay(grainOutL, grainOutR);

            // === APPLY REVERB ===
            [grainOutL, grainOutR] = this._processReverb(grainOutL, grainOutR);

            // === DIRECT MONITORING ===
            const directL = inL * this.params.directLevel;
            const directR = inR * this.params.directLevel;

            // === DRY/WET MIX ===
            const wetL = grainOutL + directL;
            const wetR = grainOutR + directR;

            outputL[i] = inL * (1 - this.smoothedMix) + wetL * this.smoothedMix;
            outputR[i] = inR * (1 - this.smoothedMix) + wetR * this.smoothedMix;
        }

        return true;
    }
}

registerProcessor('arbhar-processor', ArbharProcessor);
