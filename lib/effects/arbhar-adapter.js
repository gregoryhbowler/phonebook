// ============================================================================
// ARBHAR ADAPTER
// Integrates Instruō Arbhar Granular Processor into pedalboard system
// ============================================================================

import { ExternalEffectWrapper, registerExternalEffect } from '../effect-wrapper.js';

// Inline processor code for blob URL loading
const ARBHAR_PROCESSOR_CODE = `
// ARBHAR PROCESSOR - AudioWorkletProcessor
// Instruō Arbhar Granular Audio Processor Emulation
// 48kHz, 32-bit depth, six 10-second audio layers
// Up to 88 polyphonic grains between two granular engines

const LAYER_DURATION = 10;
const MAX_SAMPLE_RATE = 48000;
const SAMPLES_PER_LAYER = MAX_SAMPLE_RATE * LAYER_DURATION;
const NUM_LAYERS = 6;

const MAX_GRAINS_PER_ENGINE = 44;
const MIN_GRAIN_LENGTH = 0.004;
const MAX_GRAIN_LENGTH = 3.0;
const PITCH_RANGE_OCTAVES = 2;

const WINDOW_GAUSSIAN = 0;
const WINDOW_SQUARE = 1;
const WINDOW_SAWTOOTH = 2;

const MODE_SCAN = 0;
const MODE_FOLLOW = 1;
const MODE_WAVETABLE = 2;

const SCALES = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    [0, 2, 4, 5, 7, 9, 11],
    [0, 2, 3, 5, 7, 8, 10],
    [0, 2, 4, 7, 9],
    [0, 2, 4, 6, 8, 10],
    [0, 7],
    [0]
];

class Grain {
    constructor() {
        this.active = false;
        this.layer = 0;
        this.startPosition = 0;
        this.currentPosition = 0;
        this.length = 0;
        this.progress = 0;
        this.pitch = 1;
        this.direction = 1;
        this.pan = 0.5;
        this.amplitude = 1;
        this.windowType = WINDOW_GAUSSIAN;
        this.tilt = 0.5;
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

        this.layers = [];
        for (let i = 0; i < NUM_LAYERS; i++) {
            this.layers.push({
                bufferL: new Float32Array(SAMPLES_PER_LAYER),
                bufferR: new Float32Array(SAMPLES_PER_LAYER),
                writeHead: 0,
                length: 0,
                isRecording: false
            });
        }

        this.continuousGrains = [];
        for (let i = 0; i < MAX_GRAINS_PER_ENGINE; i++) {
            this.continuousGrains.push(new Grain());
        }
        this.strikeGrains = [];
        for (let i = 0; i < MAX_GRAINS_PER_ENGINE; i++) {
            this.strikeGrains.push(new Grain());
        }

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

        this.scanMode = MODE_SCAN;
        this.activeLayer = 0;
        this.continuousEngineEnabled = true;
        this.strikeEngineEnabled = false;
        this.freezeActive = false;
        this.isRecording = false;
        this.autoCapture = true;
        this.captureThreshold = 0.1;
        this.autoCaptureActive = false;
        this.autoCaptureHoldoff = 0;
        this.pitchQuantize = false;
        this.pitchScale = 0;
        this.followPosition = 0;
        this.followSpeed = 1;
        this.clockBPM = 120;
        this.externalClock = false;
        this.grainClock = 0;
        this.lastGrainTime = 0;

        this.reverbBufferSize = Math.floor(this.sampleRate * 0.1);
        this.combDelays = [1557, 1617, 1491, 1422].map(d => Math.floor(d * this.sampleRate / 44100));
        this.allpassDelays = [225, 556].map(d => Math.floor(d * this.sampleRate / 44100));
        this.combBuffersL = this.combDelays.map(d => new Float32Array(d));
        this.combBuffersR = this.combDelays.map(d => new Float32Array(d));
        this.combIndices = this.combDelays.map(() => 0);
        this.allpassBuffersL = this.allpassDelays.map(d => new Float32Array(d));
        this.allpassBuffersR = this.allpassDelays.map(d => new Float32Array(d));
        this.allpassIndices = this.allpassDelays.map(() => 0);

        this.maxDelayTime = 2;
        this.delayBufferL = new Float32Array(Math.floor(this.sampleRate * this.maxDelayTime));
        this.delayBufferR = new Float32Array(Math.floor(this.sampleRate * this.maxDelayTime));
        this.delayWriteHead = 0;

        this.onsetEnvelope = 0;
        this.onsetThreshold = 0.1;
        this.onsetHoldoff = 0;
        this.onsetAttack = 0.001;
        this.onsetRelease = 0.01;
        this.smoothedMix = 0.5;

        this.port.onmessage = (e) => this._handleMessage(e.data);
    }

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
            case 'freeze':
                this.freezeActive = !!data.active;
                break;
            case 'clearLayer':
                this._clearLayer(data.layer);
                break;
            case 'clearAllLayers':
                for (let i = 0; i < NUM_LAYERS; i++) this._clearLayer(i);
                break;
        }
    }

    _setParam(name, value) {
        if (name in this.params) this.params[name] = value;
    }

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

    _detectOnset(inputL, inputR) {
        if (!this.autoCapture || this.autoCaptureActive) return false;
        if (this.onsetHoldoff > 0) { this.onsetHoldoff--; return false; }
        const inputLevel = Math.max(Math.abs(inputL), Math.abs(inputR));
        if (inputLevel > this.onsetEnvelope) {
            this.onsetEnvelope += (inputLevel - this.onsetEnvelope) * this.onsetAttack * this.sampleRate;
        } else {
            this.onsetEnvelope += (inputLevel - this.onsetEnvelope) * this.onsetRelease;
        }
        if (inputLevel > this.onsetThreshold && inputLevel > this.onsetEnvelope * 1.5) {
            this.onsetHoldoff = Math.floor(this.sampleRate * 0.1);
            return true;
        }
        return false;
    }

    _getGrainLength() {
        const minLog = Math.log(MIN_GRAIN_LENGTH);
        const maxLog = Math.log(MAX_GRAIN_LENGTH);
        const lengthSeconds = Math.exp(minLog + this.params.length * (maxLog - minLog));
        return Math.floor(lengthSeconds * this.sampleRate);
    }

    _getGrainPitch(withSpray = true) {
        let pitch = (this.params.pitch - 0.5) * 2 * PITCH_RANGE_OCTAVES;
        if (withSpray && this.params.pitchSpray > 0) {
            pitch += (Math.random() * 2 - 1) * this.params.pitchSpray * PITCH_RANGE_OCTAVES;
        }
        if (this.pitchQuantize) pitch = this._quantizePitch(pitch);
        return Math.pow(2, pitch);
    }

    _quantizePitch(pitchOctaves) {
        const semitones = pitchOctaves * 12;
        const scale = SCALES[this.pitchScale];
        const octave = Math.floor(semitones / 12);
        let note = ((semitones % 12) + 12) % 12;
        let closestNote = scale[0];
        let minDist = Math.abs(note - scale[0]);
        for (const scaleNote of scale) {
            const dist = Math.abs(note - scaleNote);
            if (dist < minDist) { minDist = dist; closestNote = scaleNote; }
            const distWrap = Math.abs(note - (scaleNote + 12));
            if (distWrap < minDist) { minDist = distWrap; closestNote = scaleNote; }
        }
        return (octave * 12 + closestNote) / 12;
    }

    _getGrainDirection() {
        return Math.random() < this.params.direction ? 1 : -1;
    }

    _getGrainPan() {
        let pan = this.params.pan;
        if (this.params.panSpray > 0) {
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
                position = this.params.scan * bufferLength;
                if (this.params.spray > 0) {
                    position += (Math.random() * 2 - 1) * this.params.spray * bufferLength;
                }
                break;
            case MODE_FOLLOW:
                position = this.followPosition;
                if (this.params.spray > 0) {
                    position += (Math.random() * 2 - 1) * this.params.spray * bufferLength * 0.1;
                }
                break;
            case MODE_WAVETABLE:
                position = this.params.scan * bufferLength;
                break;
            default:
                position = this.params.scan * bufferLength;
        }
        position = ((position % bufferLength) + bufferLength) % bufferLength;
        return Math.floor(position);
    }

    _spawnGrain(grainPool, layer) {
        let grain = null;
        for (const g of grainPool) { if (!g.active) { grain = g; break; } }
        if (!grain) {
            grain = grainPool[0];
            for (const g of grainPool) { if (g.progress < grain.progress) grain = g; }
        }
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
        const grainCount = this._getGrainCount();
        for (let i = 0; i < grainCount; i++) this._spawnGrain(this.strikeGrains, layer);
    }

    _getGrainCount() {
        return Math.max(1, Math.floor(Math.pow(this.params.intensity, 2) * (MAX_GRAINS_PER_ENGINE - 1) + 1));
    }

    _getWindowValue(progress, windowType, tilt) {
        switch (windowType) {
            case WINDOW_GAUSSIAN:
                const x = (progress - 0.5) * 4;
                return Math.exp(-x * x);
            case WINDOW_SQUARE:
                const fadeLen = 0.01;
                if (progress < fadeLen) return progress / fadeLen;
                else if (progress > 1 - fadeLen) return (1 - progress) / fadeLen;
                return 1;
            case WINDOW_SAWTOOTH:
                const attackLen = tilt;
                const decayLen = 1 - tilt;
                if (progress < attackLen) return attackLen > 0 ? progress / attackLen : 1;
                else return decayLen > 0 ? (1 - progress) / decayLen : 1;
            default:
                return 1;
        }
    }

    _processGrain(grain, outputL, outputR, i) {
        if (!grain.active) return;
        const layer = this.layers[grain.layer];
        const bufferLength = layer.length || SAMPLES_PER_LAYER;
        const windowAmp = this._getWindowValue(grain.progress, grain.windowType, grain.tilt);
        const readPos = grain.currentPosition;
        const readPosInt = Math.floor(readPos);
        const frac = readPos - readPosInt;
        const idx0 = ((readPosInt % bufferLength) + bufferLength) % bufferLength;
        const idx1 = ((readPosInt + 1) % bufferLength + bufferLength) % bufferLength;
        const sampleL = layer.bufferL[idx0] * (1 - frac) + layer.bufferL[idx1] * frac;
        const sampleR = layer.bufferR[idx0] * (1 - frac) + layer.bufferR[idx1] * frac;
        const ampL = windowAmp * grain.amplitude * this.params.grainLevel;
        const ampR = windowAmp * grain.amplitude * this.params.grainLevel;
        const panAngle = grain.pan * Math.PI * 0.5;
        const panL = Math.cos(panAngle);
        const panR = Math.sin(panAngle);
        outputL[i] += sampleL * ampL * panL;
        outputR[i] += sampleR * ampR * panR;
        grain.currentPosition += grain.pitch * grain.direction;
        grain.progress += 1 / grain.length;
        if (grain.progress >= 1) grain.active = false;
    }

    _processReverb(inputL, inputR) {
        if (this.params.reverbMix < 0.01) return [inputL, inputR];
        const decay = 0.5 + this.params.reverbDecay * 0.45;
        const combGains = [decay, decay * 0.95, decay * 0.9, decay * 0.85];
        let combOutL = 0, combOutR = 0;
        for (let c = 0; c < this.combDelays.length; c++) {
            const delay = this.combDelays[c];
            const idx = this.combIndices[c];
            const delayedL = this.combBuffersL[c][idx];
            const delayedR = this.combBuffersR[c][idx];
            this.combBuffersL[c][idx] = inputL + delayedL * combGains[c];
            this.combBuffersR[c][idx] = inputR + delayedR * combGains[c];
            combOutL += delayedL;
            combOutR += delayedR;
            this.combIndices[c] = (idx + 1) % delay;
        }
        combOutL *= 0.25; combOutR *= 0.25;
        let allpassOutL = combOutL, allpassOutR = combOutR;
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
        const wet = this.params.reverbMix;
        return [inputL * (1 - wet) + allpassOutL * wet, inputR * (1 - wet) + allpassOutR * wet];
    }

    _processFeedbackDelay(inputL, inputR) {
        if (this.params.feedback < 0.01) return [inputL, inputR];
        const grainLengthSec = this._getGrainLength() / this.sampleRate;
        const maxDelaySec = this.maxDelayTime;
        const delaySec = grainLengthSec + this.params.feedbackDelay * (maxDelaySec - grainLengthSec);
        const delaySamples = Math.floor(delaySec * this.sampleRate);
        const readHead = (this.delayWriteHead - delaySamples + this.delayBufferL.length) % this.delayBufferL.length;
        const delayedL = this.delayBufferL[readHead];
        const delayedR = this.delayBufferR[readHead];
        const feedbackAmount = this.params.feedback * 0.85;
        this.delayBufferL[this.delayWriteHead] = inputL + delayedL * feedbackAmount;
        this.delayBufferR[this.delayWriteHead] = inputR + delayedR * feedbackAmount;
        this.delayWriteHead = (this.delayWriteHead + 1) % this.delayBufferL.length;
        return [inputL + delayedL * this.params.feedback, inputR + delayedR * this.params.feedback];
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!output || !output[0]) return true;

        const outputL = output[0];
        const outputR = output[1] || output[0];
        const hasInput = input && input[0] && input[0].length > 0;
        const inputL = hasInput ? input[0] : new Float32Array(outputL.length);
        const inputR = hasInput ? (input[1] || input[0]) : new Float32Array(outputR.length);

        this.smoothedMix += (this.params.mix - this.smoothedMix) * 0.001;
        const layer = this.layers[this.activeLayer];
        const grainCount = this._getGrainCount();
        const grainInterval = this._getGrainLength() / grainCount;

        for (let i = 0; i < outputL.length; i++) {
            const inL = inputL[i] || 0;
            const inR = inputR[i] || 0;

            if (this._detectOnset(inL, inR)) {
                this._startRecording();
                this.autoCaptureActive = true;
                this.autoCaptureHoldoff = Math.floor(this.sampleRate * LAYER_DURATION);
            }

            if (this.autoCaptureActive) {
                this.autoCaptureHoldoff--;
                if (this.autoCaptureHoldoff <= 0 || layer.writeHead >= SAMPLES_PER_LAYER - 1) {
                    this._stopRecording();
                }
            }

            if (layer.isRecording && !this.freezeActive) {
                layer.bufferL[layer.writeHead] = inL;
                layer.bufferR[layer.writeHead] = inR;
                layer.writeHead = (layer.writeHead + 1) % SAMPLES_PER_LAYER;
                if (layer.writeHead > layer.length) layer.length = layer.writeHead;
            }

            if (this.scanMode === MODE_FOLLOW && layer.length > 0) {
                this.followSpeed = (this.params.scan - 0.5) * 4;
                this.followPosition += this.followSpeed;
                if (this.followPosition < 0) this.followPosition += layer.length;
                else if (this.followPosition >= layer.length) this.followPosition -= layer.length;
            }

            if (this.continuousEngineEnabled && layer.length > 0) {
                this.grainClock++;
                if (this.grainClock >= grainInterval) {
                    this.grainClock = 0;
                    this._spawnGrain(this.continuousGrains, layer);
                }
            }

            let grainOutL = 0, grainOutR = 0;
            const tempOutL = new Float32Array(1);
            const tempOutR = new Float32Array(1);

            for (const grain of this.continuousGrains) {
                tempOutL[0] = 0; tempOutR[0] = 0;
                this._processGrain(grain, tempOutL, tempOutR, 0);
                grainOutL += tempOutL[0];
                grainOutR += tempOutR[0];
            }
            for (const grain of this.strikeGrains) {
                tempOutL[0] = 0; tempOutR[0] = 0;
                this._processGrain(grain, tempOutL, tempOutR, 0);
                grainOutL += tempOutL[0];
                grainOutR += tempOutR[0];
            }

            grainOutL = Math.tanh(grainOutL);
            grainOutR = Math.tanh(grainOutR);

            [grainOutL, grainOutR] = this._processFeedbackDelay(grainOutL, grainOutR);
            [grainOutL, grainOutR] = this._processReverb(grainOutL, grainOutR);

            const directL = inL * this.params.directLevel;
            const directR = inR * this.params.directLevel;

            const wetL = grainOutL + directL;
            const wetR = grainOutR + directR;

            outputL[i] = inL * (1 - this.smoothedMix) + wetL * this.smoothedMix;
            outputR[i] = inR * (1 - this.smoothedMix) + wetR * this.smoothedMix;
        }
        return true;
    }
}

registerProcessor('arbhar-processor', ArbharProcessor);
`;

export class ArbharAdapter extends ExternalEffectWrapper {
  constructor(audioContext, slot) {
    super('arbhar', audioContext, slot);

    // Default parameter values
    this.params = {
      scan: 0.5,
      spray: 0,
      intensity: 0.25,
      length: 0.3,
      pitch: 0.5,
      pitchSpray: 0,
      grainWindow: 0,
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
      directLevel: 0,
      scanMode: 0,
      layer: 0,
      freeze: 0
    };
  }

  async initialize() {
    // Create blob URL for the processor
    const blob = new Blob([ARBHAR_PROCESSOR_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    try {
      await this.ctx.audioWorklet.addModule(url);
    } catch (e) {
      // Module may already be registered
      if (!e.message.includes('already been added')) {
        console.warn('ArbharAdapter: Worklet registration note:', e.message);
      }
    }

    URL.revokeObjectURL(url);

    // Create the worklet node
    this.workletNode = new AudioWorkletNode(this.ctx, 'arbhar-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        sampleRate: this.ctx.sampleRate
      }
    });

    // Create audio routing nodes
    this._inputGain = this.ctx.createGain();
    this._outputGain = this.ctx.createGain();
    this._bypassGain = this.ctx.createGain();
    this._bypassGain.gain.value = 0;

    // Wet path: Input -> worklet -> output
    this._inputGain.connect(this.workletNode);
    this.workletNode.connect(this._outputGain);

    // Dry/bypass path: Input -> bypassGain -> output
    this._inputGain.connect(this._bypassGain);
    this._bypassGain.connect(this._outputGain);

    this._bypassed = false;
    this._isLoaded = true;

    return this;
  }

  get input() {
    return this._inputGain;
  }

  get output() {
    return this._outputGain;
  }

  setParam(name, value) {
    if (!(name in this.params)) {
      console.warn(`ArbharAdapter: Unknown parameter "${name}"`);
      return;
    }

    this.params[name] = value;

    // Handle special mode parameters
    if (name === 'scanMode') {
      this.workletNode?.port.postMessage({
        type: 'setScanMode',
        mode: Math.floor(value)
      });
      return;
    }

    if (name === 'layer') {
      this.workletNode?.port.postMessage({
        type: 'setActiveLayer',
        layer: Math.floor(value)
      });
      return;
    }

    if (name === 'freeze') {
      this.workletNode?.port.postMessage({
        type: 'freeze',
        active: value > 0.5
      });
      return;
    }

    // Send regular parameter to processor
    this.workletNode?.port.postMessage({
      type: 'setParam',
      name: name,
      value: value
    });
  }

  getParam(name) {
    return this.params[name];
  }

  bypass(bypassed) {
    this._bypassed = bypassed;
    const now = this.ctx.currentTime;

    if (bypassed) {
      this._bypassGain.gain.setTargetAtTime(1, now, 0.01);
      this.workletNode?.port.postMessage({ type: 'setParam', name: 'mix', value: 0 });
    } else {
      this._bypassGain.gain.setTargetAtTime(0, now, 0.01);
      this.workletNode?.port.postMessage({ type: 'setParam', name: 'mix', value: this.params.mix });
    }
  }

  // === SPECIAL CONTROLS ===

  startRecording() {
    this.workletNode?.port.postMessage({ type: 'startRecording' });
  }

  stopRecording() {
    this.workletNode?.port.postMessage({ type: 'stopRecording' });
  }

  strike() {
    this.workletNode?.port.postMessage({ type: 'strike' });
  }

  clearLayer(layerIndex = null) {
    if (layerIndex !== null) {
      this.workletNode?.port.postMessage({ type: 'clearLayer', layer: layerIndex });
    } else {
      this.workletNode?.port.postMessage({ type: 'clearAllLayers' });
    }
  }

  setContinuousEngine(enabled) {
    this.workletNode?.port.postMessage({ type: 'setContinuousEngine', enabled });
  }

  setStrikeEngine(enabled) {
    this.workletNode?.port.postMessage({ type: 'setStrikeEngine', enabled });
  }

  setAutoCapture(enabled) {
    this.workletNode?.port.postMessage({ type: 'setAutoCapture', enabled });
  }

  dispose() {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.port.close();
      this.workletNode = null;
    }
    this._inputGain?.disconnect();
    this._outputGain?.disconnect();
    this._bypassGain?.disconnect();
    this._isLoaded = false;
  }
}

// Register this effect type
registerExternalEffect('arbhar', ArbharAdapter);
