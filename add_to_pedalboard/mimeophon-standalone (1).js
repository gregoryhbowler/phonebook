/**
 * MIMEOPHON - Standalone Stereo Delay Effect
 * 
 * A complete Mimeophon-inspired delay effect with UI
 * Updated to match Phase 5 pastel aesthetic
 */

export class StandaloneMimeophon {
    constructor(audioContext) {
        this.context = audioContext;
        this.node = null;
        this.inputGain = null;
        this.outputGain = null;
        this.params = {};
        this.isReady = false;
        this.uiContainer = null;
    }
    
    /**
     * Initialize the worklet and create the processing node
     */
    async init() {
        if (this.isReady) return;
        
        try {
            // Register the processor
            await this.context.audioWorklet.addModule(this.getProcessorURL());
            
            // Create the worklet node
            this.node = new AudioWorkletNode(this.context, 'mimeophon-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2],
                processorOptions: {
                    sampleRate: this.context.sampleRate
                }
            });
            
            // Create input and output gain nodes
            this.inputGain = this.context.createGain();
            this.outputGain = this.context.createGain();
            
            // Connect: input -> worklet -> output
            this.inputGain.connect(this.node);
            this.node.connect(this.outputGain);
            
            // Store parameter references
            this.params = {
                zone: this.node.parameters.get('zone'),
                rate: this.node.parameters.get('rate'),
                microRate: this.node.parameters.get('microRate'),
                microRateFreq: this.node.parameters.get('microRateFreq'),
                skew: this.node.parameters.get('skew'),
                repeats: this.node.parameters.get('repeats'),
                color: this.node.parameters.get('color'),
                halo: this.node.parameters.get('halo'),
                mix: this.node.parameters.get('mix'),
                hold: this.node.parameters.get('hold'),
                flip: this.node.parameters.get('flip'),
                pingPong: this.node.parameters.get('pingPong'),
                swap: this.node.parameters.get('swap')
            };
            
            this.isReady = true;
        } catch (error) {
            console.error('Failed to initialize Mimeophon:', error);
            throw error;
        }
    }
    
    /**
     * Get processor code as blob URL
     */
    getProcessorURL() {
        const processorCode = `
// Mimeophon-Inspired Stereo Delay Processor
class MimeophonProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'zone', defaultValue: 1, minValue: 0, maxValue: 3 },
            { name: 'rate', defaultValue: 0.5, minValue: 0, maxValue: 1 },
            { name: 'microRate', defaultValue: 0, minValue: 0, maxValue: 1 },
            { name: 'microRateFreq', defaultValue: 2, minValue: 0.1, maxValue: 8 },
            { name: 'skew', defaultValue: 0, minValue: -1, maxValue: 1 },
            { name: 'repeats', defaultValue: 0.3, minValue: 0, maxValue: 1.2 },
            { name: 'color', defaultValue: 0.5, minValue: 0, maxValue: 1 },
            { name: 'halo', defaultValue: 0, minValue: 0, maxValue: 1 },
            { name: 'mix', defaultValue: 0.0, minValue: 0, maxValue: 1 },
            { name: 'hold', defaultValue: 0, minValue: 0, maxValue: 1 },
            { name: 'flip', defaultValue: 0, minValue: 0, maxValue: 1 },
            { name: 'pingPong', defaultValue: 0, minValue: 0, maxValue: 1 },
            { name: 'swap', defaultValue: 0, minValue: 0, maxValue: 1 }
        ];
    }
    
    constructor(options) {
        super();
        
        this.sampleRate = options.processorOptions?.sampleRate || 48000;
        
        const maxDelaySamples = Math.ceil(this.sampleRate * 10);
        this.bufferL = new Float32Array(maxDelaySamples);
        this.bufferR = new Float32Array(maxDelaySamples);
        this.writeIndex = 0;
        this.bufferSize = maxDelaySamples;
        
        this.zones = [
            { min: 0.005, max: 0.050 },
            { min: 0.050, max: 0.400 },
            { min: 0.400, max: 2.000 },
            { min: 2.000, max: 10.000 }
        ];
        
        this.delayTimeL = 0.1;
        this.delayTimeR = 0.1;
        this.targetDelayTimeL = 0.1;
        this.targetDelayTimeR = 0.1;
        this.lfoPhase = 0;
        
        this.filterStateL = this.createFilterState();
        this.filterStateR = this.createFilterState();
        this.haloStateL = this.createHaloState();
        this.haloStateR = this.createHaloState();
        
        this.feedbackL = 0;
        this.feedbackR = 0;
        this.holdActive = false;
        this.holdBufferL = new Float32Array(maxDelaySamples);
        this.holdBufferR = new Float32Array(maxDelaySamples);
        this.flipActive = false;
        this.crossfadeActive = false;
        this.crossfadeProgress = 0;
        this.crossfadeDuration = 0.02;
        this.prevZone = 1;
        this.prevRate = 0.5;
        this.pingPongPhase = 0;
    }
    
    createFilterState() {
        return {
            b1: { x1: 0, x2: 0, y1: 0, y2: 0 },
            b2: { x1: 0, x2: 0, y1: 0, y2: 0 },
            coefs1: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 },
            coefs2: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
        };
    }
    
    createHaloState() {
        // Allpass diffuser buffers - longer delays for more audible reverb effect
        // Prime numbers reduce metallic resonances
        return {
            buffers: [
                new Float32Array(1307),   // ~27ms at 48kHz
                new Float32Array(1811),   // ~38ms
                new Float32Array(2473),   // ~52ms
                new Float32Array(3181)    // ~66ms
            ],
            indices: [0, 0, 0, 0],
            g: [0.6, 0.55, 0.5, 0.45]  // Slightly higher coefficients for more diffusion
        };
    }
    
    getDelayTime(zone, rate) {
        const z = Math.floor(zone);
        const zoneData = this.zones[Math.min(z, 3)];
        return zoneData.min + rate * (zoneData.max - zoneData.min);
    }
    
    readBuffer(buffer, delaySamples) {
        const size = this.bufferSize;
        const readPos = (this.writeIndex - delaySamples + size) % size;
        const readIndex = Math.floor(readPos);
        const frac = readPos - readIndex;
        const idx1 = readIndex % size;
        const idx2 = (readIndex + 1) % size;
        return buffer[idx1] * (1 - frac) + buffer[idx2] * frac;
    }
    
    readBufferReverse(buffer, delaySamples) {
        const size = this.bufferSize;
        const readPos = (this.writeIndex + delaySamples) % size;
        const readIndex = Math.floor(readPos);
        const frac = readPos - readIndex;
        const idx1 = readIndex % size;
        const idx2 = (readIndex + 1) % size;
        return buffer[idx1] * (1 - frac) + buffer[idx2] * frac;
    }
    
    softSaturate(x) {
        if (x > 1) return 1 - Math.exp(-(x - 1));
        if (x < -1) return -1 + Math.exp(x + 1);
        return x;
    }
    
    asymmetricSaturate(x, bias = 0.3) {
        const shifted = x + bias;
        return Math.tanh(shifted * 1.5) - Math.tanh(bias * 1.5);
    }
    
    updateColorFilter(color, filterState) {
        if (color < 0.2) {
            const freq = 4000 + color * 5 * 7000;
            this.setLowpass(filterState.coefs1, freq, 0.707);
            this.setLowpass(filterState.coefs2, freq * 0.5, 0.707);
        } else if (color < 0.4) {
            const t = (color - 0.2) / 0.2;
            const freq = 4000 + t * 6000;
            this.setLowpass(filterState.coefs1, freq, 1.5);
            this.setBandpass(filterState.coefs2, 2000, 2);
        } else if (color < 0.6) {
            const t = (color - 0.4) / 0.2;
            const freq = 8000 - t * 2000;
            this.setHighShelf(filterState.coefs1, freq, -3, 0.707);
            this.setLowpass(filterState.coefs2, 12000, 0.707);
        } else if (color < 0.8) {
            const t = (color - 0.6) / 0.2;
            this.setHighShelf(filterState.coefs1, 8000, t * 2, 0.707);
            this.setAllpass(filterState.coefs2, 0);
        } else {
            const t = (color - 0.8) / 0.2;
            this.setHighShelf(filterState.coefs1, 6000, 3 + t * 2, 0.707);
            this.setPeaking(filterState.coefs2, 3000, 2, 1.5);
        }
    }
    
    setLowpass(coefs, freq, Q) {
        const w0 = 2 * Math.PI * freq / this.sampleRate;
        const cosw0 = Math.cos(w0);
        const sinw0 = Math.sin(w0);
        const alpha = sinw0 / (2 * Q);
        const b0 = (1 - cosw0) / 2;
        const b1 = 1 - cosw0;
        const b2 = (1 - cosw0) / 2;
        const a0 = 1 + alpha;
        const a1 = -2 * cosw0;
        const a2 = 1 - alpha;
        coefs.b0 = b0 / a0;
        coefs.b1 = b1 / a0;
        coefs.b2 = b2 / a0;
        coefs.a1 = a1 / a0;
        coefs.a2 = a2 / a0;
    }
    
    setHighShelf(coefs, freq, gainDB, Q) {
        const A = Math.pow(10, gainDB / 40);
        const w0 = 2 * Math.PI * freq / this.sampleRate;
        const cosw0 = Math.cos(w0);
        const sinw0 = Math.sin(w0);
        const alpha = sinw0 / (2 * Q);
        const b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha);
        const b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
        const b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha);
        const a0 = (A + 1) - (A - 1) * cosw0 + 2 * Math.sqrt(A) * alpha;
        const a1 = 2 * ((A - 1) - (A + 1) * cosw0);
        const a2 = (A + 1) - (A - 1) * cosw0 - 2 * Math.sqrt(A) * alpha;
        coefs.b0 = b0 / a0;
        coefs.b1 = b1 / a0;
        coefs.b2 = b2 / a0;
        coefs.a1 = a1 / a0;
        coefs.a2 = a2 / a0;
    }
    
    setBandpass(coefs, freq, Q) {
        const w0 = 2 * Math.PI * freq / this.sampleRate;
        const cosw0 = Math.cos(w0);
        const sinw0 = Math.sin(w0);
        const alpha = sinw0 / (2 * Q);
        const b0 = alpha;
        const b1 = 0;
        const b2 = -alpha;
        const a0 = 1 + alpha;
        const a1 = -2 * cosw0;
        const a2 = 1 - alpha;
        coefs.b0 = b0 / a0;
        coefs.b1 = b1 / a0;
        coefs.b2 = b2 / a0;
        coefs.a1 = a1 / a0;
        coefs.a2 = a2 / a0;
    }
    
    setPeaking(coefs, freq, gainDB, Q) {
        const A = Math.pow(10, gainDB / 40);
        const w0 = 2 * Math.PI * freq / this.sampleRate;
        const cosw0 = Math.cos(w0);
        const sinw0 = Math.sin(w0);
        const alpha = sinw0 / (2 * Q);
        const b0 = 1 + alpha * A;
        const b1 = -2 * cosw0;
        const b2 = 1 - alpha * A;
        const a0 = 1 + alpha / A;
        const a1 = -2 * cosw0;
        const a2 = 1 - alpha / A;
        coefs.b0 = b0 / a0;
        coefs.b1 = b1 / a0;
        coefs.b2 = b2 / a0;
        coefs.a1 = a1 / a0;
        coefs.a2 = a2 / a0;
    }
    
    setAllpass(coefs, freq) {
        if (freq === 0) {
            coefs.b0 = 1;
            coefs.b1 = 0;
            coefs.b2 = 0;
            coefs.a1 = 0;
            coefs.a2 = 0;
        } else {
            const w0 = 2 * Math.PI * freq / this.sampleRate;
            const cosw0 = Math.cos(w0);
            const sinw0 = Math.sin(w0);
            const alpha = sinw0 / 2;
            const b0 = 1 - alpha;
            const b1 = -2 * cosw0;
            const b2 = 1 + alpha;
            const a0 = 1 + alpha;
            const a1 = -2 * cosw0;
            const a2 = 1 - alpha;
            coefs.b0 = b0 / a0;
            coefs.b1 = b1 / a0;
            coefs.b2 = b2 / a0;
            coefs.a1 = a1 / a0;
            coefs.a2 = a2 / a0;
        }
    }
    
    processBiquad(input, state, coefs) {
        const output = coefs.b0 * input + 
                      coefs.b1 * state.x1 + 
                      coefs.b2 * state.x2 - 
                      coefs.a1 * state.y1 - 
                      coefs.a2 * state.y2;
        state.x2 = state.x1;
        state.x1 = input;
        state.y2 = state.y1;
        state.y1 = output;
        return output;
    }
    
    processHalo(input, haloState, amount) {
        if (amount < 0.001) return input;
        let signal = input;
        for (let i = 0; i < 4; i++) {
            const buffer = haloState.buffers[i];
            const index = haloState.indices[i];
            const g = haloState.g[i] * amount;
            const delayed = buffer[index];
            const output = -g * signal + delayed;
            buffer[index] = signal + g * output;
            haloState.indices[i] = (index + 1) % buffer.length;
            signal = output;
        }
        // Mix depends on amount: low halo = more dry, high halo = more wet
        const wetMix = 0.5 + amount * 0.4;  // 0.5-0.9 wet
        const dryMix = 1.0 - wetMix;         // 0.1-0.5 dry
        return signal * wetMix + input * dryMix;
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        
        if (!input || !output || !input[0]) {
            return true;
        }
        
        const inputL = input[0];
        const inputR = input[1] || input[0];
        const outputL = output[0];
        const outputR = output[1] || output[0];
        const blockSize = outputL.length;
        
        const getParam = (param, index) => {
            return param.length > 1 ? param[index] : param[0];
        };
        
        for (let i = 0; i < blockSize; i++) {
            const zone = getParam(parameters.zone, i);
            const rate = getParam(parameters.rate, i);
            const microRate = getParam(parameters.microRate, i);
            const microRateFreq = getParam(parameters.microRateFreq, i);
            const skew = getParam(parameters.skew, i);
            const repeats = getParam(parameters.repeats, i);
            const color = getParam(parameters.color, i);
            const halo = getParam(parameters.halo, i);
            const mix = getParam(parameters.mix, i);
            const hold = getParam(parameters.hold, i);
            const flip = getParam(parameters.flip, i);
            const pingPong = getParam(parameters.pingPong, i);
            const swap = getParam(parameters.swap, i);
            
            const holdNow = hold > 0.5;
            if (holdNow && !this.holdActive) {
                this.holdBufferL.set(this.bufferL);
                this.holdBufferR.set(this.bufferR);
                this.holdActive = true;
            } else if (!holdNow && this.holdActive) {
                this.holdActive = false;
            }
            
            this.flipActive = flip > 0.5;
            
            const baseDelayTime = this.getDelayTime(zone, rate);
            
            this.lfoPhase += 2 * Math.PI * microRateFreq / this.sampleRate;
            if (this.lfoPhase > 2 * Math.PI) this.lfoPhase -= 2 * Math.PI;
            const lfoValue = Math.sin(this.lfoPhase);
            const microRateOffset = lfoValue * microRate * 0.015;
            
            const skewAmount = skew * baseDelayTime * 0.5;
            this.targetDelayTimeL = baseDelayTime - skewAmount + microRateOffset;
            this.targetDelayTimeR = baseDelayTime + skewAmount + microRateOffset;
            
            if (swap > 0.5) {
                [this.targetDelayTimeL, this.targetDelayTimeR] = 
                    [this.targetDelayTimeR, this.targetDelayTimeL];
            }
            
            const smoothingCoef = 0.999;
            this.delayTimeL = this.delayTimeL * smoothingCoef + 
                             this.targetDelayTimeL * (1 - smoothingCoef);
            this.delayTimeR = this.delayTimeR * smoothingCoef + 
                             this.targetDelayTimeR * (1 - smoothingCoef);
            
            const delayL = Math.max(0.001, this.delayTimeL) * this.sampleRate;
            const delayR = Math.max(0.001, this.delayTimeR) * this.sampleRate;
            
            let delayedL, delayedR;
            
            if (this.holdActive) {
                if (this.flipActive) {
                    delayedL = this.readBufferReverse(this.holdBufferL, delayL);
                    delayedR = this.readBufferReverse(this.holdBufferR, delayR);
                } else {
                    delayedL = this.readBuffer(this.holdBufferL, delayL);
                    delayedR = this.readBuffer(this.holdBufferR, delayR);
                }
            } else {
                if (this.flipActive) {
                    delayedL = this.readBufferReverse(this.bufferL, delayL);
                    delayedR = this.readBufferReverse(this.bufferR, delayR);
                } else {
                    delayedL = this.readBuffer(this.bufferL, delayL);
                    delayedR = this.readBuffer(this.bufferR, delayR);
                }
            }
            
            if (pingPong > 0.5) {
                const temp = delayedL;
                delayedL = this.feedbackR;
                delayedR = this.feedbackL;
            }
            
            this.updateColorFilter(color, this.filterStateL);
            this.updateColorFilter(color, this.filterStateR);
            
            let coloredL = this.processBiquad(delayedL, this.filterStateL.b1, 
                                             this.filterStateL.coefs1);
            coloredL = this.processBiquad(coloredL, this.filterStateL.b2, 
                                         this.filterStateL.coefs2);
            
            let coloredR = this.processBiquad(delayedR, this.filterStateR.b1, 
                                             this.filterStateR.coefs1);
            coloredR = this.processBiquad(coloredR, this.filterStateR.b2, 
                                         this.filterStateR.coefs2);
            
            const haloedL = this.processHalo(coloredL, this.haloStateL, halo);
            const haloedR = this.processHalo(coloredR, this.haloStateR, halo);
            
            let saturatedL, saturatedR;
            if (color < 0.6) {
                saturatedL = this.asymmetricSaturate(haloedL * 1.5, 0.2);
                saturatedR = this.asymmetricSaturate(haloedR * 1.5, 0.2);
            } else {
                saturatedL = this.softSaturate(haloedL * 1.2);
                saturatedR = this.softSaturate(haloedR * 1.2);
            }
            
            const feedbackAmount = Math.min(1.1, repeats);
            this.feedbackL = saturatedL * feedbackAmount;
            this.feedbackR = saturatedR * feedbackAmount;
            
            if (!this.holdActive) {
                this.bufferL[this.writeIndex] = inputL[i] + this.feedbackL * 0.9;
                this.bufferR[this.writeIndex] = inputR[i] + this.feedbackR * 0.9;
                this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
            }
            
            outputL[i] = inputL[i] * (1 - mix) + saturatedL * mix;
            outputR[i] = inputR[i] * (1 - mix) + saturatedR * mix;
        }
        
        return true;
    }
}

registerProcessor('mimeophon-processor', MimeophonProcessor);
        `;
        
        const blob = new Blob([processorCode], { type: 'application/javascript' });
        return URL.createObjectURL(blob);
    }
    
    /**
     * Connect an audio source to the Mimeophon input
     */
    connectInput(sourceNode) {
        if (!this.isReady) {
            console.warn('Mimeophon not initialized');
            return;
        }
        sourceNode.connect(this.inputGain);
    }
    
    /**
     * Connect the Mimeophon output to a destination
     */
    connectOutput(destinationNode) {
        if (!this.isReady) {
            console.warn('Mimeophon not initialized');
            return;
        }
        this.outputGain.connect(destinationNode);
    }
    
    /**
     * Disconnect all inputs and outputs
     */
    disconnect() {
        if (!this.isReady) return;
        this.inputGain.disconnect();
        this.outputGain.disconnect();
    }
    
    /**
     * Set input gain level (0-1)
     */
    setInputLevel(level) {
        if (this.inputGain) {
            this.inputGain.gain.setValueAtTime(level, this.context.currentTime);
        }
    }
    
    /**
     * Set output gain level (0-1)
     */
    setOutputLevel(level) {
        if (this.outputGain) {
            this.outputGain.gain.setValueAtTime(level, this.context.currentTime);
        }
    }
    
    // Parameter setters
    setParam(paramName, value, time) {
        if (!this.isReady || !this.params[paramName]) {
            console.warn(`Parameter ${paramName} not found`);
            return;
        }
        const param = this.params[paramName];
        const when = time !== undefined ? time : this.context.currentTime;
        param.setValueAtTime(value, when);
    }
    
    setZone(zone) {
        this.setParam('zone', Math.max(0, Math.min(3, zone)));
    }
    
    setRate(rate) {
        this.setParam('rate', Math.max(0, Math.min(1, rate)));
    }
    
    setDelayTime(seconds) {
        let zone, rate;
        if (seconds < 0.050) {
            zone = 0;
            rate = (seconds - 0.005) / 0.045;
        } else if (seconds < 0.400) {
            zone = 1;
            rate = (seconds - 0.050) / 0.350;
        } else if (seconds < 2.000) {
            zone = 2;
            rate = (seconds - 0.400) / 1.600;
        } else {
            zone = 3;
            rate = (seconds - 2.000) / 8.000;
        }
        this.setZone(zone);
        this.setRate(Math.max(0, Math.min(1, rate)));
    }
    
    setMicroRate(amount) {
        this.setParam('microRate', Math.max(0, Math.min(1, amount)));
    }
    
    setMicroRateFreq(freq) {
        this.setParam('microRateFreq', Math.max(0.1, Math.min(8, freq)));
    }
    
    setSkew(skew) {
        this.setParam('skew', Math.max(-1, Math.min(1, skew)));
    }
    
    setRepeats(repeats) {
        this.setParam('repeats', Math.max(0, Math.min(1.2, repeats)));
    }
    
    setColor(color) {
        this.setParam('color', Math.max(0, Math.min(1, color)));
    }
    
    setHalo(halo) {
        this.setParam('halo', Math.max(0, Math.min(1, halo)));
    }
    
    setMix(mix) {
        this.setParam('mix', Math.max(0, Math.min(1, mix)));
    }
    
    setHold(hold) {
        this.setParam('hold', hold ? 1 : 0);
    }
    
    setFlip(flip) {
        this.setParam('flip', flip ? 1 : 0);
    }
    
    setPingPong(pingPong) {
        this.setParam('pingPong', pingPong ? 1 : 0);
    }
    
    setSwap(swap) {
        this.setParam('swap', swap ? 1 : 0);
    }
    
    /**
     * Load a preset
     */
    loadPreset(preset) {
        Object.entries(preset).forEach(([param, value]) => {
            this.setParam(param, value);
        });
    }
    
    /**
     * Get presets
     */
    static getPresets() {
        return {
            karplus: {
                zone: 0, rate: 0.8, microRate: 0, skew: 0,
                repeats: 0.85, color: 0.3, halo: 0, mix: 0.5
            },
            flange: {
                zone: 0, rate: 0.3, microRate: 0.8, microRateFreq: 0.3,
                skew: 0.5, repeats: 0.7, color: 0.5, halo: 0.3, mix: 0.5
            },
            chorus: {
                zone: 1, rate: 0.2, microRate: 0.6, microRateFreq: 1.5,
                skew: 0.3, repeats: 0.3, color: 0.6, halo: 0.5, mix: 0.4
            },
            slapback: {
                zone: 1, rate: 0.4, microRate: 0, skew: 0,
                repeats: 0.3, color: 0.4, halo: 0.2, mix: 0.3
            },
            dubEcho: {
                zone: 2, rate: 0.5, microRate: 0.1, skew: 0.2,
                repeats: 0.6, color: 0.3, halo: 0.6, mix: 0.5
            },
            tapeDelay: {
                zone: 2, rate: 0.6, microRate: 0.2, microRateFreq: 0.5,
                skew: 0, repeats: 0.5, color: 0.45, halo: 0.4, mix: 0.4
            },
            ambient: {
                zone: 3, rate: 0.5, microRate: 0.3, microRateFreq: 0.2,
                skew: 0.4, repeats: 0.8, color: 0.7, halo: 0.8, mix: 0.6
            },
            shimmer: {
                zone: 3, rate: 0.7, microRate: 0.4, microRateFreq: 2,
                skew: 0.6, repeats: 0.9, color: 0.85, halo: 1.0, mix: 0.7
            }
        };
    }
    
    /**
     * Create UI for the Mimeophon - matches Phase 5 aesthetic
     */
    createUI() {
        if (this.uiContainer) {
            return this.uiContainer;
        }
        
        const container = document.createElement('div');
        container.className = 'mimeophon-module';
        
        container.innerHTML = `
            <!-- Header -->
            <div class="mimeophon-header">
                <h3 class="mimeophon-title">Mimeophon</h3>
                <select class="mimeophon-preset-select" id="mimeophon-preset">
                    <option value="">-- select --</option>
                    <option value="karplus">Karplus String</option>
                    <option value="flange">Flange</option>
                    <option value="chorus">Chorus</option>
                    <option value="slapback">Slapback</option>
                    <option value="dubEcho">Dub Echo</option>
                    <option value="tapeDelay">Tape Delay</option>
                    <option value="ambient">Ambient</option>
                    <option value="shimmer">Shimmer</option>
                </select>
            </div>
            
            <!-- Main Grid -->
            <div class="mimeophon-grid">
                
                <!-- Zone & Delay Section -->
                <div class="mimeophon-section">
                    <div class="mimeophon-section-title">Zone & Delay</div>
                    
                    <div class="mimeophon-zone-grid">
                        <button class="mimeophon-zone-btn" data-zone="0">
                            <span class="zone-letter">A</span>
                            <span class="zone-range">5-50ms</span>
                        </button>
                        <button class="mimeophon-zone-btn active" data-zone="1">
                            <span class="zone-letter">B</span>
                            <span class="zone-range">50-400ms</span>
                        </button>
                        <button class="mimeophon-zone-btn" data-zone="2">
                            <span class="zone-letter">C</span>
                            <span class="zone-range">0.4-2s</span>
                        </button>
                        <button class="mimeophon-zone-btn" data-zone="3">
                            <span class="zone-letter">D</span>
                            <span class="zone-range">2-10s</span>
                        </button>
                    </div>
                    
                    <div class="mimeophon-param">
                        <div class="mimeophon-param-header">
                            <span class="mimeophon-param-label">rate</span>
                            <span class="mimeophon-param-value" id="mimeophon-rate-val">50%</span>
                        </div>
                        <input type="range" class="mimeophon-slider" id="mimeophon-rate" min="0" max="1" step="0.01" value="0.5">
                    </div>
                    
                    <div class="mimeophon-param">
                        <div class="mimeophon-param-header">
                            <span class="mimeophon-param-label">mrate amount</span>
                            <span class="mimeophon-param-value" id="mimeophon-microrate-val">0%</span>
                        </div>
                        <input type="range" class="mimeophon-slider" id="mimeophon-microrate" min="0" max="1" step="0.01" value="0">
                    </div>
                    
                    <div class="mimeophon-param">
                        <div class="mimeophon-param-header">
                            <span class="mimeophon-param-label">mrate freq</span>
                            <span class="mimeophon-param-value" id="mimeophon-microrate-freq-val">2.0 Hz</span>
                        </div>
                        <input type="range" class="mimeophon-slider" id="mimeophon-microrate-freq" min="0.1" max="8" step="0.1" value="2">
                    </div>
                    
                    <div class="mimeophon-param">
                        <div class="mimeophon-param-header">
                            <span class="mimeophon-param-label">skew</span>
                            <span class="mimeophon-param-value" id="mimeophon-skew-val">0</span>
                        </div>
                        <input type="range" class="mimeophon-slider" id="mimeophon-skew" min="-1" max="1" step="0.01" value="0">
                    </div>
                </div>
                
                <!-- Feedback Section -->
                <div class="mimeophon-section">
                    <div class="mimeophon-section-title">Feedback</div>
                    
                    <div class="mimeophon-param">
                        <div class="mimeophon-param-header">
                            <span class="mimeophon-param-label">repeats</span>
                            <span class="mimeophon-param-value" id="mimeophon-repeats-val">30%</span>
                        </div>
                        <input type="range" class="mimeophon-slider" id="mimeophon-repeats" min="0" max="1.2" step="0.01" value="0.3">
                    </div>
                    
                    <div class="mimeophon-param">
                        <div class="mimeophon-param-header">
                            <span class="mimeophon-param-label">color</span>
                            <span class="mimeophon-param-value" id="mimeophon-color-val">tape</span>
                        </div>
                        <input type="range" class="mimeophon-slider" id="mimeophon-color" min="0" max="1" step="0.01" value="0.5">
                    </div>
                    
                    <div class="mimeophon-param">
                        <div class="mimeophon-param-header">
                            <span class="mimeophon-param-label">halo</span>
                            <span class="mimeophon-param-value" id="mimeophon-halo-val">0%</span>
                        </div>
                        <input type="range" class="mimeophon-slider" id="mimeophon-halo" min="0" max="1" step="0.01" value="0">
                    </div>
                    
                    <div class="mimeophon-param">
                        <div class="mimeophon-param-header">
                            <span class="mimeophon-param-label">mix</span>
                            <span class="mimeophon-param-value" id="mimeophon-mix-val">22%</span>
                        </div>
                        <input type="range" class="mimeophon-slider" id="mimeophon-mix" min="0" max="1" step="0.01" value="0.22">
                    </div>
                    
                    <div class="mimeophon-toggles">
                        <button class="mimeophon-toggle-btn" id="mimeophon-pingpong">ping-pong</button>
                        <button class="mimeophon-toggle-btn" id="mimeophon-swap">swap</button>
                    </div>
                </div>
                
                <!-- Special Section -->
                <div class="mimeophon-section">
                    <div class="mimeophon-section-title">Special</div>
                    
                    <div class="mimeophon-toggles" style="margin-bottom: var(--space-md);">
                        <button class="mimeophon-toggle-btn" id="mimeophon-hold">hold</button>
                        <button class="mimeophon-toggle-btn" id="mimeophon-flip">flip</button>
                    </div>
                    
                    <div class="mimeophon-tips">
                        <strong>Tips:</strong><br>
                        • <strong>hold</strong> freezes buffer<br>
                        • <strong>flip</strong> reverses playback<br>
                        • <strong>ping-pong</strong> bounces L/R<br>
                        • <strong>swap</strong> exchanges L/R times
                    </div>
                </div>
            </div>
            
            <!-- I/O Controls -->
            <div class="mimeophon-io-row">
                <div class="mimeophon-io-control">
                    <span class="mimeophon-io-label">input level</span>
                    <input type="range" class="mimeophon-slider" id="mimeophon-input" min="0" max="1" step="0.01" value="1">
                    <span class="mimeophon-io-value" id="mimeophon-input-val">100%</span>
                </div>
                <div class="mimeophon-io-control">
                    <span class="mimeophon-io-label">output level</span>
                    <input type="range" class="mimeophon-slider" id="mimeophon-output" min="0" max="1" step="0.01" value="1">
                    <span class="mimeophon-io-value" id="mimeophon-output-val">100%</span>
                </div>
            </div>
        `;
        
        this.uiContainer = container;
        this.attachUIListeners();
        
        return container;
    }
    
    /**
     * Attach event listeners to UI controls
     */
    attachUIListeners() {
        if (!this.uiContainer) return;
        
        const getColorName = (val) => {
            if (val < 0.2) return 'dark';
            if (val < 0.4) return 'BBD';
            if (val < 0.6) return 'tape';
            if (val < 0.8) return 'bright';
            return 'crisp';
        };
        
        // Zone buttons
        this.uiContainer.querySelectorAll('.mimeophon-zone-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const zone = parseInt(btn.dataset.zone);
                this.uiContainer.querySelectorAll('.mimeophon-zone-btn').forEach(b => 
                    b.classList.remove('active'));
                btn.classList.add('active');
                this.setZone(zone);
            });
        });
        
        // Rate
        const rateSlider = this.uiContainer.querySelector('#mimeophon-rate');
        const rateValue = this.uiContainer.querySelector('#mimeophon-rate-val');
        rateSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            rateValue.textContent = Math.round(val * 100) + '%';
            this.setRate(val);
        });
        
        // μRate
        const microRateSlider = this.uiContainer.querySelector('#mimeophon-microrate');
        const microRateValue = this.uiContainer.querySelector('#mimeophon-microrate-val');
        microRateSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            microRateValue.textContent = Math.round(val * 100) + '%';
            this.setMicroRate(val);
        });
        
        // μRate Freq
        const microRateFreqSlider = this.uiContainer.querySelector('#mimeophon-microrate-freq');
        const microRateFreqValue = this.uiContainer.querySelector('#mimeophon-microrate-freq-val');
        microRateFreqSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            microRateFreqValue.textContent = val.toFixed(1) + ' Hz';
            this.setMicroRateFreq(val);
        });
        
        // Skew
        const skewSlider = this.uiContainer.querySelector('#mimeophon-skew');
        const skewValue = this.uiContainer.querySelector('#mimeophon-skew-val');
        skewSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (val > 0) {
                skewValue.textContent = 'R' + Math.round(val * 100);
            } else if (val < 0) {
                skewValue.textContent = 'L' + Math.round(Math.abs(val) * 100);
            } else {
                skewValue.textContent = '0';
            }
            this.setSkew(val);
        });
        
        // Repeats
        const repeatsSlider = this.uiContainer.querySelector('#mimeophon-repeats');
        const repeatsValue = this.uiContainer.querySelector('#mimeophon-repeats-val');
        repeatsSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            repeatsValue.textContent = Math.round(val * 100) + '%';
            this.setRepeats(val);
        });
        
        // Color
        const colorSlider = this.uiContainer.querySelector('#mimeophon-color');
        const colorValue = this.uiContainer.querySelector('#mimeophon-color-val');
        colorSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            colorValue.textContent = getColorName(val);
            this.setColor(val);
        });
        
        // Halo
        const haloSlider = this.uiContainer.querySelector('#mimeophon-halo');
        const haloValue = this.uiContainer.querySelector('#mimeophon-halo-val');
        haloSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            haloValue.textContent = Math.round(val * 100) + '%';
            this.setHalo(val);
        });

        // Mix
        const mixSlider = this.uiContainer.querySelector('#mimeophon-mix');
        const mixValue = this.uiContainer.querySelector('#mimeophon-mix-val');
        mixSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            mixValue.textContent = Math.round(val * 100) + '%';
            this.setMix(val);
        });
        
        // Toggles
        const pingPongBtn = this.uiContainer.querySelector('#mimeophon-pingpong');
        pingPongBtn.addEventListener('click', () => {
            pingPongBtn.classList.toggle('active');
            this.setPingPong(pingPongBtn.classList.contains('active'));
        });
        
        const swapBtn = this.uiContainer.querySelector('#mimeophon-swap');
        swapBtn.addEventListener('click', () => {
            swapBtn.classList.toggle('active');
            this.setSwap(swapBtn.classList.contains('active'));
        });
        
        const holdBtn = this.uiContainer.querySelector('#mimeophon-hold');
        holdBtn.addEventListener('click', () => {
            holdBtn.classList.toggle('active');
            this.setHold(holdBtn.classList.contains('active'));
        });
        
        const flipBtn = this.uiContainer.querySelector('#mimeophon-flip');
        flipBtn.addEventListener('click', () => {
            flipBtn.classList.toggle('active');
            this.setFlip(flipBtn.classList.contains('active'));
        });
        
        // Input/Output levels
        const inputSlider = this.uiContainer.querySelector('#mimeophon-input');
        const inputValue = this.uiContainer.querySelector('#mimeophon-input-val');
        inputSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            inputValue.textContent = Math.round(val * 100) + '%';
            this.setInputLevel(val);
        });
        
        const outputSlider = this.uiContainer.querySelector('#mimeophon-output');
        const outputValue = this.uiContainer.querySelector('#mimeophon-output-val');
        outputSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            outputValue.textContent = Math.round(val * 100) + '%';
            this.setOutputLevel(val);
        });
        
        // Preset selector
        const presetSelect = this.uiContainer.querySelector('#mimeophon-preset');
        presetSelect.addEventListener('change', (e) => {
            const presetName = e.target.value;
            if (!presetName) return;
            
            const preset = StandaloneMimeophon.getPresets()[presetName];
            if (preset) {
                this.loadPreset(preset);
                this.updateUIFromPreset(preset);
            }
            
            setTimeout(() => {
                presetSelect.value = '';
            }, 100);
        });
    }
    
    /**
     * Update UI to reflect preset values
     */
    updateUIFromPreset(preset) {
        if (!this.uiContainer) return;
        
        const getColorName = (val) => {
            if (val < 0.2) return 'dark';
            if (val < 0.4) return 'BBD';
            if (val < 0.6) return 'tape';
            if (val < 0.8) return 'bright';
            return 'crisp';
        };
        
        if (preset.zone !== undefined) {
            this.uiContainer.querySelectorAll('.mimeophon-zone-btn').forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.dataset.zone) === preset.zone);
            });
        }
        
        if (preset.rate !== undefined) {
            this.uiContainer.querySelector('#mimeophon-rate').value = preset.rate;
            this.uiContainer.querySelector('#mimeophon-rate-val').textContent = Math.round(preset.rate * 100) + '%';
        }
        
        if (preset.microRate !== undefined) {
            this.uiContainer.querySelector('#mimeophon-microrate').value = preset.microRate;
            this.uiContainer.querySelector('#mimeophon-microrate-val').textContent = Math.round(preset.microRate * 100) + '%';
        }
        
        if (preset.microRateFreq !== undefined) {
            this.uiContainer.querySelector('#mimeophon-microrate-freq').value = preset.microRateFreq;
            this.uiContainer.querySelector('#mimeophon-microrate-freq-val').textContent = preset.microRateFreq.toFixed(1) + ' Hz';
        }
        
        if (preset.skew !== undefined) {
            this.uiContainer.querySelector('#mimeophon-skew').value = preset.skew;
            const val = preset.skew;
            let display = val > 0 ? 'R' + Math.round(val * 100) : val < 0 ? 'L' + Math.round(Math.abs(val) * 100) : '0';
            this.uiContainer.querySelector('#mimeophon-skew-val').textContent = display;
        }
        
        if (preset.repeats !== undefined) {
            this.uiContainer.querySelector('#mimeophon-repeats').value = preset.repeats;
            this.uiContainer.querySelector('#mimeophon-repeats-val').textContent = Math.round(preset.repeats * 100) + '%';
        }
        
        if (preset.color !== undefined) {
            this.uiContainer.querySelector('#mimeophon-color').value = preset.color;
            this.uiContainer.querySelector('#mimeophon-color-val').textContent = getColorName(preset.color);
        }
        
        if (preset.halo !== undefined) {
            this.uiContainer.querySelector('#mimeophon-halo').value = preset.halo;
            this.uiContainer.querySelector('#mimeophon-halo-val').textContent = Math.round(preset.halo * 100) + '%';
        }
        
        if (preset.mix !== undefined) {
            this.uiContainer.querySelector('#mimeophon-mix').value = preset.mix;
            this.uiContainer.querySelector('#mimeophon-mix-val').textContent = Math.round(preset.mix * 100) + '%';
        }
    }
}
