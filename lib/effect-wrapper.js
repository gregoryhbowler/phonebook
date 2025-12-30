// ============================================================================
// EFFECT WRAPPER
// Unified interface for both internal (built-in) and external (advanced) effects
// ============================================================================

/**
 * Base class for effect wrappers
 * Provides a consistent interface for the pedalboard system
 */
export class EffectWrapper {
  constructor(type, audioContext, slot = 0) {
    this.type = type;
    this.ctx = audioContext;
    this.slot = slot;
    this.isInitialized = false;
    this.isBypassed = false;
    this.params = {};
    this.onParamChange = null;
  }

  /**
   * Initialize the effect (async for worklet loading)
   */
  async initialize() {
    throw new Error('EffectWrapper.initialize() must be implemented by subclass');
  }

  /**
   * Get the input node for audio routing
   */
  get input() {
    throw new Error('EffectWrapper.input must be implemented by subclass');
  }

  /**
   * Get the output node for audio routing
   */
  get output() {
    throw new Error('EffectWrapper.output must be implemented by subclass');
  }

  /**
   * Connect output to a destination
   */
  connect(destination) {
    this.output.connect(destination);
    return this;
  }

  /**
   * Disconnect output
   */
  disconnect() {
    this.output.disconnect();
  }

  /**
   * Set a parameter value
   */
  setParam(name, value) {
    throw new Error('EffectWrapper.setParam() must be implemented by subclass');
  }

  /**
   * Get current parameter value
   */
  getParam(name) {
    return this.params[name];
  }

  /**
   * Get all parameters
   */
  getParams() {
    return { ...this.params };
  }

  /**
   * Set multiple parameters at once
   */
  setParams(params) {
    for (const [name, value] of Object.entries(params)) {
      this.setParam(name, value);
    }
  }

  /**
   * Toggle bypass state
   */
  bypass(state) {
    this.isBypassed = state;
  }

  /**
   * Get bypass state
   */
  getBypassed() {
    return this.isBypassed;
  }

  /**
   * Reset effect state (clear buffers, etc.)
   */
  reset() {
    // Override in subclass if needed
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.disconnect();
    this.isInitialized = false;
  }

  /**
   * Get preset data for saving
   */
  getPreset() {
    return {
      type: this.type,
      params: this.getParams(),
      bypassed: this.isBypassed
    };
  }

  /**
   * Load preset data
   */
  loadPreset(preset) {
    if (preset.params) {
      this.setParams(preset.params);
    }
    if (preset.bypassed !== undefined) {
      this.bypass(preset.bypassed);
    }
  }

  /**
   * Check if this is an external (advanced) effect
   */
  get isExternal() {
    return false; // Override in ExternalEffectWrapper
  }

  /**
   * Get effect metadata
   */
  static get id() {
    throw new Error('EffectWrapper.id must be defined by subclass');
  }

  static get name() {
    throw new Error('EffectWrapper.name must be defined by subclass');
  }

  static get category() {
    return 'Uncategorized';
  }

  static get params() {
    return {};
  }
}


/**
 * Wrapper for internal effects (those running in effect-chain-processor)
 * This proxies parameter changes to the shared worklet
 */
export class InternalEffectWrapper extends EffectWrapper {
  constructor(type, audioContext, slot, workletPort) {
    super(type, audioContext, slot);
    this.workletPort = workletPort;
    this._inputGain = audioContext.createGain();
    this._outputGain = audioContext.createGain();
  }

  async initialize() {
    // Internal effects don't need separate initialization
    // They're already loaded as part of effect-chain-processor
    this.isInitialized = true;
    return this;
  }

  get input() {
    return this._inputGain;
  }

  get output() {
    return this._outputGain;
  }

  setParam(name, value) {
    this.params[name] = value;
    if (this.workletPort) {
      this.workletPort.postMessage({
        action: 'setParam',
        slot: this.slot,
        param: name,
        value: value
      });
    }
    if (this.onParamChange) {
      this.onParamChange(name, value);
    }
  }

  bypass(state) {
    super.bypass(state);
    if (this.workletPort) {
      this.workletPort.postMessage({
        action: 'setBypass',
        slot: this.slot,
        bypassed: state
      });
    }
  }

  reset() {
    if (this.workletPort) {
      this.workletPort.postMessage({
        action: 'reset',
        slot: this.slot
      });
    }
  }

  get isExternal() {
    return false;
  }
}


/**
 * Wrapper for external effects (those with their own worklet processors)
 * These have their own AudioWorkletNode and audio routing
 */
export class ExternalEffectWrapper extends EffectWrapper {
  constructor(type, audioContext, slot) {
    super(type, audioContext, slot);
    this.effectNode = null; // The actual effect node (NautilusNode, etc.)
    this._inputGain = audioContext.createGain();
    this._outputGain = audioContext.createGain();
    this._bypassGain = audioContext.createGain();
    this._bypassGain.gain.value = 0;
  }

  /**
   * Set the effect node instance
   * Called by the adapter after creating the specific effect node
   */
  setEffectNode(node) {
    this.effectNode = node;

    // Connect bypass routing
    // Input splits to both effect and bypass path
    this._inputGain.connect(node.input || node.inputGain);
    this._inputGain.connect(this._bypassGain);

    // Effect output and bypass merge to output
    (node.output || node.outputGain).connect(this._outputGain);
    this._bypassGain.connect(this._outputGain);

    // Forward parameter changes
    if (node.onParamChange) {
      const originalCallback = node.onParamChange;
      node.onParamChange = (name, value) => {
        this.params[name] = value;
        if (originalCallback) originalCallback(name, value);
        if (this.onParamChange) this.onParamChange(name, value);
      };
    } else {
      node.onParamChange = (name, value) => {
        this.params[name] = value;
        if (this.onParamChange) this.onParamChange(name, value);
      };
    }

    // Sync initial params
    if (node.getParams) {
      this.params = { ...node.getParams() };
    }
  }

  get input() {
    return this._inputGain;
  }

  get output() {
    return this._outputGain;
  }

  setParam(name, value) {
    this.params[name] = value;
    if (this.effectNode?.setParam) {
      this.effectNode.setParam(name, value);
    }
    if (this.onParamChange) {
      this.onParamChange(name, value);
    }
  }

  bypass(state) {
    super.bypass(state);
    const now = this.ctx.currentTime;
    const rampTime = 0.02; // 20ms crossfade

    if (state) {
      // Bypass on: mute effect, unmute bypass
      if (this.effectNode?.outputGain) {
        this.effectNode.outputGain.gain.linearRampToValueAtTime(0, now + rampTime);
      }
      this._bypassGain.gain.linearRampToValueAtTime(1, now + rampTime);
    } else {
      // Bypass off: unmute effect, mute bypass
      if (this.effectNode?.outputGain) {
        this.effectNode.outputGain.gain.linearRampToValueAtTime(1, now + rampTime);
      }
      this._bypassGain.gain.linearRampToValueAtTime(0, now + rampTime);
    }
  }

  reset() {
    if (this.effectNode?.reset) {
      this.effectNode.reset();
    } else if (this.effectNode?.purge) {
      this.effectNode.purge();
    }
  }

  dispose() {
    if (this.effectNode?.dispose) {
      this.effectNode.dispose();
    }
    this._inputGain.disconnect();
    this._outputGain.disconnect();
    this._bypassGain.disconnect();
    super.dispose();
  }

  get isExternal() {
    return true;
  }

  getPreset() {
    const preset = super.getPreset();
    // Include any effect-specific preset data
    if (this.effectNode?.getPreset) {
      preset.effectPreset = this.effectNode.getPreset();
    }
    return preset;
  }

  loadPreset(preset) {
    super.loadPreset(preset);
    if (preset.effectPreset && this.effectNode?.loadPreset) {
      this.effectNode.loadPreset(preset.effectPreset);
    }
  }
}


/**
 * Registry of available external effect types
 * Maps effect type ID to adapter class
 */
export const ExternalEffectRegistry = new Map();

/**
 * Register an external effect adapter
 */
export function registerExternalEffect(id, adapterClass) {
  ExternalEffectRegistry.set(id, adapterClass);
}

/**
 * Check if an effect type is external
 */
export function isExternalEffect(type) {
  return ExternalEffectRegistry.has(type);
}

/**
 * Create an effect wrapper (internal or external) based on type
 */
export async function createEffectWrapper(type, audioContext, slot, workletPort = null) {
  if (ExternalEffectRegistry.has(type)) {
    const AdapterClass = ExternalEffectRegistry.get(type);
    const adapter = new AdapterClass(audioContext, slot);
    await adapter.initialize();
    return adapter;
  } else {
    // Internal effect
    const wrapper = new InternalEffectWrapper(type, audioContext, slot, workletPort);
    await wrapper.initialize();
    return wrapper;
  }
}
