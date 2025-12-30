// ============================================================================
// EFFECT CHAIN PROCESSOR
// AudioWorklet wrapper for the Pedalboard effects chain
// ============================================================================

// This file combines the effects library with the AudioWorklet processor

const EffectChainProcessorCode = `
${typeof PedalboardEffectsCode !== 'undefined' ? PedalboardEffectsCode : ''}

// ============================================================================
// EFFECT CHAIN PROCESSOR
// ============================================================================
class EffectChainProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chain = []; // Array of effect instances
    this.maxSlots = 8;
    this.masterBypass = false;
    this.inputGain = 1;
    this.outputGain = 1;

    // DC blockers for output
    this.dcBlockerL = new DCBlocker();
    this.dcBlockerR = new DCBlocker();

    this.port.onmessage = (e) => {
      const data = e.data;

      switch (data.action) {
        case 'addEffect':
          this.addEffect(data.slot, data.effectType);
          break;

        case 'removeEffect':
          this.removeEffect(data.slot);
          break;

        case 'setParam':
          this.setEffectParam(data.slot, data.param, data.value);
          break;

        case 'setBypass':
          if (data.slot !== undefined && this.chain[data.slot]) {
            this.chain[data.slot].bypassed = data.bypassed;
          }
          break;

        case 'setMasterBypass':
          this.masterBypass = data.bypassed;
          break;

        case 'setInputGain':
          this.inputGain = data.value;
          break;

        case 'setOutputGain':
          this.outputGain = data.value;
          break;

        case 'reorderChain':
          this.reorderChain(data.order);
          break;

        case 'clearChain':
          this.chain = [];
          break;

        case 'getState':
          this.port.postMessage({
            type: 'state',
            chain: this.chain.map((e, i) => e ? {
              slot: i,
              type: e.constructor.id,
              bypassed: e.bypassed
            } : null).filter(e => e)
          });
          break;
      }
    };
  }

  addEffect(slot, effectType) {
    if (slot < 0 || slot >= this.maxSlots) return;

    const EffectClass = EffectRegistry[effectType];
    if (EffectClass) {
      this.chain[slot] = new EffectClass(sampleRate);
      this.port.postMessage({
        type: 'effectAdded',
        slot: slot,
        effectType: effectType
      });
    }
  }

  removeEffect(slot) {
    if (this.chain[slot]) {
      this.chain[slot] = null;
      this.port.postMessage({
        type: 'effectRemoved',
        slot: slot
      });
    }
  }

  setEffectParam(slot, param, value) {
    if (this.chain[slot]) {
      this.chain[slot][param] = value;
    }
  }

  reorderChain(order) {
    const newChain = [];
    for (const slot of order) {
      if (this.chain[slot]) {
        newChain.push(this.chain[slot]);
      }
    }
    // Rebuild chain array
    this.chain = [];
    newChain.forEach((effect, i) => {
      this.chain[i] = effect;
    });
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0]) return true;

    const blockSize = output[0].length;

    for (let s = 0; s < blockSize; s++) {
      let L = (input[0] ? input[0][s] : 0) * this.inputGain;
      let R = (input[1] ? input[1][s] : L) * this.inputGain;

      if (!this.masterBypass) {
        // Process through effect chain
        for (let i = 0; i < this.chain.length; i++) {
          const effect = this.chain[i];
          if (effect && !effect.bypassed) {
            [L, R] = effect.processStereo(L, R);
          }
        }
      }

      // Apply output gain and DC blocking
      L = this.dcBlockerL.process(L * this.outputGain);
      R = this.dcBlockerR.process(R * this.outputGain);

      // Soft limit
      L = Math.tanh(L);
      R = Math.tanh(R);

      output[0][s] = L;
      if (output[1]) output[1][s] = R;
    }

    return true;
  }
}

registerProcessor('effect-chain-processor', EffectChainProcessor);
`;

// Export for use
if (typeof window !== 'undefined') {
  window.EffectChainProcessorCode = EffectChainProcessorCode;
}
