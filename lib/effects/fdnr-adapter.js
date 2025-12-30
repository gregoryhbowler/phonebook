// ============================================================================
// FDNR ADAPTER
// Integrates FDNR Reverb into pedalboard system
// ============================================================================

import { ExternalEffectWrapper, registerExternalEffect } from '../effect-wrapper.js';

// FDNR processor is large - referencing external file
// The processor uses AudioParam descriptors so we handle params differently

export class FDNRAdapter extends ExternalEffectWrapper {
  constructor(audioContext, slot) {
    super('fdnr', audioContext, slot);

    this.params = {
      mix: 50,
      width: 100,
      delay: 100,
      warp: 0,
      feedback: 50,
      density: 0,
      modRate: 0.5,
      modDepth: 50,
      ducking: 0,
      saturation: 0,
      eq3Low: 0,
      eq3Mid: 0,
      eq3High: 0
    };
  }

  async initialize() {
    // Load the FDNR processor from external file
    try {
      await this.ctx.audioWorklet.addModule('/add_to_pedalboard/worklets/fdnr-processor.js');
    } catch (e) {
      if (!e.message.includes('already been added')) {
        console.warn('FDNRAdapter: Worklet registration note:', e.message);
      }
    }

    this.workletNode = new AudioWorkletNode(this.ctx, 'fdnr-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { sampleRate: this.ctx.sampleRate }
    });

    this._inputGain = this.ctx.createGain();
    this._outputGain = this.ctx.createGain();
    this._bypassGain = this.ctx.createGain();
    this._bypassGain.gain.value = 0;

    this._inputGain.connect(this.workletNode);
    this.workletNode.connect(this._outputGain);
    this._inputGain.connect(this._bypassGain);
    this._bypassGain.connect(this._outputGain);

    this._bypassed = false;
    this._isLoaded = true;

    // Apply initial parameters via AudioParams
    this._syncAllParams();

    return this;
  }

  get input() { return this._inputGain; }
  get output() { return this._outputGain; }

  _syncAllParams() {
    if (!this.workletNode) return;
    const params = this.workletNode.parameters;
    for (const [name, value] of Object.entries(this.params)) {
      const param = params.get(name);
      if (param) {
        param.setValueAtTime(value, this.ctx.currentTime);
      }
    }
  }

  setParam(name, value) {
    if (!(name in this.params)) {
      console.warn(`FDNRAdapter: Unknown parameter "${name}"`);
      return;
    }
    this.params[name] = value;

    // FDNR uses AudioParams instead of message port
    if (this.workletNode) {
      const param = this.workletNode.parameters.get(name);
      if (param) {
        param.setTargetAtTime(value, this.ctx.currentTime, 0.02);
      }
    }
  }

  getParam(name) { return this.params[name]; }

  bypass(bypassed) {
    this._bypassed = bypassed;
    const now = this.ctx.currentTime;
    if (bypassed) {
      this._bypassGain.gain.setTargetAtTime(1, now, 0.01);
      const mixParam = this.workletNode?.parameters.get('mix');
      if (mixParam) mixParam.setTargetAtTime(0, now, 0.01);
    } else {
      this._bypassGain.gain.setTargetAtTime(0, now, 0.01);
      const mixParam = this.workletNode?.parameters.get('mix');
      if (mixParam) mixParam.setTargetAtTime(this.params.mix, now, 0.01);
    }
  }

  reset() {
    this.workletNode?.port.postMessage({ type: 'reset' });
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

registerExternalEffect('fdnr', FDNRAdapter);
