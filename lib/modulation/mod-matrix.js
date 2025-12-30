// ============================================================================
// MODULATION MATRIX
// 6 mod sources, 2 destinations each, with depth control
// ============================================================================

import { LFOGenerator, SHAPE_CATEGORIES } from './mod-shapes.js';

/**
 * Modulatable parameter wrapper
 * Tracks base value and applies modulation
 */
class ModulatableParam {
  constructor(id, config) {
    this.id = id;
    this.label = config.label || id;
    this.min = config.min;
    this.max = config.max;
    this.baseValue = config.default || (config.min + config.max) / 2;
    this.modulatedValue = this.baseValue;
    this.onChange = config.onChange;

    // Accumulated modulation amount
    this._modAmount = 0;
    this._lastModulatedValue = this.baseValue;
    this._isBeingModulated = false;
  }

  setBase(value) {
    this.baseValue = Math.max(this.min, Math.min(this.max, value));
    // Don't call onChange here - user is setting the value directly
  }

  addModulation(amount) {
    this._modAmount += amount;
    this._isBeingModulated = true;
  }

  clearModulation() {
    this._modAmount = 0;
    this._isBeingModulated = false;
  }

  _applyModulation() {
    const range = this.max - this.min;
    // Apply exponential scaling to modulation amount for finer control at low depths
    // _modAmount is already depth * LFO value, so we scale the effective range
    // Using squared scaling: small depths stay small, large depths can still reach full range
    const scaledModAmount = this._modAmount * Math.abs(this._modAmount);
    const modulated = this.baseValue + scaledModAmount * range;
    this.modulatedValue = Math.max(this.min, Math.min(this.max, modulated));

    // Only call onChange if there's actual modulation happening
    // and the value has changed
    if (this._isBeingModulated && this.onChange &&
        Math.abs(this.modulatedValue - this._lastModulatedValue) > 0.0001) {
      this.onChange(this.modulatedValue);
      this._lastModulatedValue = this.modulatedValue;
    }
  }

  applyAndReset() {
    this._applyModulation();
    this._modAmount = 0;
    this._isBeingModulated = false;
  }
}

/**
 * Modulation source with 2 destinations
 */
class ModSource {
  constructor(index) {
    this.index = index;
    this.generator = new LFOGenerator();
    this.enabled = false;

    // Two destinations per source
    this.destinations = [
      { targetId: null, depth: 0 },
      { targetId: null, depth: 0 }
    ];
  }

  setShape(shape) {
    this.generator.setShape(shape);
  }

  setRate(hz) {
    this.generator.setRate(hz);
  }

  setPolarity(polarity) {
    this.generator.setPolarity(polarity);
  }

  setSmoothing(amount) {
    this.generator.setSmoothing(amount);
  }

  setPhaseOffset(offset) {
    this.generator.setPhaseOffset(offset);
  }

  setDestination(destIndex, targetId, depth) {
    if (destIndex < 0 || destIndex > 1) return;
    this.destinations[destIndex] = { targetId, depth };
  }

  setDestinationTarget(destIndex, targetId) {
    if (destIndex < 0 || destIndex > 1) return;
    this.destinations[destIndex].targetId = targetId;
  }

  setDestinationDepth(destIndex, depth) {
    if (destIndex < 0 || destIndex > 1) return;
    this.destinations[destIndex].depth = Math.max(-1, Math.min(1, depth));
  }

  reset() {
    this.generator.reset();
  }
}

/**
 * Main modulation matrix
 */
class ModulationMatrix {
  constructor() {
    // 6 mod sources
    this.sources = [];
    for (let i = 0; i < 6; i++) {
      this.sources.push(new ModSource(i));
    }

    // Parameter registry
    this.params = new Map(); // id -> ModulatableParam

    // Update state
    this.isRunning = false;
    this.lastTime = 0;
    this._animationFrame = null;

    // Callbacks
    this.onUpdate = null;
  }

  /**
   * Register a parameter for modulation
   */
  registerParam(id, config) {
    const param = new ModulatableParam(id, config);
    this.params.set(id, param);
    return param;
  }

  /**
   * Unregister a parameter
   */
  unregisterParam(id) {
    this.params.delete(id);

    // Clear any destinations pointing to this param
    this.sources.forEach(source => {
      source.destinations.forEach(dest => {
        if (dest.targetId === id) {
          dest.targetId = null;
        }
      });
    });
  }

  /**
   * Update base value of a parameter
   */
  setParamBase(id, value) {
    const param = this.params.get(id);
    if (param) {
      param.setBase(value);
    }
  }

  /**
   * Get all registered parameter IDs for destination selection
   */
  getDestinationOptions() {
    const options = [];

    // Add all registered params
    this.params.forEach((param, id) => {
      options.push({
        id,
        label: param.label,
        group: 'Parameters'
      });
    });

    // Add mod source rates as targets (mod-of-mod)
    for (let i = 0; i < 6; i++) {
      options.push({
        id: `_mod${i}_rate`,
        label: `Mod ${i + 1} Rate`,
        group: 'Modulation'
      });
      options.push({
        id: `_mod${i}_depth0`,
        label: `Mod ${i + 1} Dest 1 Depth`,
        group: 'Modulation'
      });
      options.push({
        id: `_mod${i}_depth1`,
        label: `Mod ${i + 1} Dest 2 Depth`,
        group: 'Modulation'
      });
    }

    return options;
  }

  /**
   * Process one frame of modulation
   */
  tick(dt) {
    // Clear all mod amounts
    this.params.forEach(param => param.clearModulation());

    // Process each source
    this.sources.forEach((source, srcIdx) => {
      if (!source.enabled) return;

      // Get LFO value
      const modValue = source.generator.tick(dt);

      // Apply to destinations
      source.destinations.forEach(dest => {
        if (!dest.targetId || dest.depth === 0) return;

        // Check if targeting another mod source
        if (dest.targetId.startsWith('_mod')) {
          this._applyModToMod(dest.targetId, modValue * dest.depth);
        } else {
          // Regular parameter
          const param = this.params.get(dest.targetId);
          if (param) {
            param.addModulation(modValue * dest.depth);
          }
        }
      });
    });

    // Apply accumulated modulation to all params
    this.params.forEach(param => param.applyAndReset());

    // Callback
    if (this.onUpdate) {
      this.onUpdate(this.sources.map(s => s.generator.getValue()));
    }
  }

  _applyModToMod(targetId, amount) {
    // Parse target: _mod{idx}_{param}
    const match = targetId.match(/_mod(\d)_(\w+)/);
    if (!match) return;

    const modIdx = parseInt(match[1]);
    const paramType = match[2];
    const source = this.sources[modIdx];
    if (!source) return;

    switch (paramType) {
      case 'rate':
        // Modulate rate (exponential scaling)
        const baseRate = source.generator.rate;
        const newRate = baseRate * Math.pow(2, amount * 2);
        source.generator.rate = Math.max(0.01, Math.min(100, newRate));
        break;
      case 'depth0':
        source.destinations[0].depth += amount;
        source.destinations[0].depth = Math.max(-1, Math.min(1, source.destinations[0].depth));
        break;
      case 'depth1':
        source.destinations[1].depth += amount;
        source.destinations[1].depth = Math.max(-1, Math.min(1, source.destinations[1].depth));
        break;
    }
  }

  /**
   * Start modulation update loop
   */
  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.lastTime = performance.now();

    const update = () => {
      if (!this.isRunning) return;

      const now = performance.now();
      const dt = (now - this.lastTime) / 1000;
      this.lastTime = now;

      this.tick(dt);

      this._animationFrame = requestAnimationFrame(update);
    };

    this._animationFrame = requestAnimationFrame(update);
  }

  /**
   * Stop modulation update loop
   */
  stop() {
    this.isRunning = false;
    if (this._animationFrame) {
      cancelAnimationFrame(this._animationFrame);
      this._animationFrame = null;
    }
  }

  /**
   * Reset all sources
   */
  reset() {
    this.sources.forEach(s => s.reset());
  }

  /**
   * Get state for serialization
   */
  getState() {
    return {
      sources: this.sources.map(s => ({
        enabled: s.enabled,
        shape: s.generator.shape,
        rate: s.generator.rate,
        polarity: s.generator.polarity,
        smoothing: s.generator.smoothing,
        phaseOffset: s.generator.phaseOffset,
        destinations: s.destinations.map(d => ({
          targetId: d.targetId,
          depth: d.depth
        }))
      }))
    };
  }

  /**
   * Load state from serialization
   */
  loadState(state) {
    if (!state?.sources) return;

    state.sources.forEach((srcState, i) => {
      if (i >= this.sources.length) return;

      const source = this.sources[i];
      source.enabled = srcState.enabled || false;
      source.generator.shape = srcState.shape || 'sine';
      source.generator.rate = srcState.rate || 1;
      source.generator.polarity = srcState.polarity || 'bipolar';
      source.generator.smoothing = srcState.smoothing || 0;
      source.generator.phaseOffset = srcState.phaseOffset || 0;

      srcState.destinations?.forEach((destState, j) => {
        if (j >= 2) return;
        source.destinations[j] = {
          targetId: destState.targetId || null,
          depth: destState.depth || 0
        };
      });
    });
  }

  /**
   * Auto-register all eligible elements on the page as mod destinations
   * Finds input[type=range] elements with IDs and registers them
   * Uses the element's min/max attributes (or sensible defaults)
   * @param {string} prefix - Optional prefix for param IDs (e.g., 'bent808')
   * @param {HTMLElement} container - Optional container to search within (default: document)
   */
  autoRegisterAll(prefix = '', container = document) {
    const elements = container.querySelectorAll('input[type="range"][id]');
    let count = 0;

    elements.forEach(el => {
      // Create param ID
      const paramId = prefix ? `${prefix}_${el.id}` : el.id;

      // Skip elements that are already registered
      if (this.params.has(paramId)) return;

      // Get min/max from element attributes or use defaults
      const min = parseFloat(el.min) || 0;
      const max = parseFloat(el.max) || 1;

      // Create a human-readable label from the ID
      const label = el.id
        .replace(/([A-Z])/g, ' $1')  // camelCase to spaces
        .replace(/[-_]/g, ' ')        // kebab/snake to spaces
        .replace(/^\w/, c => c.toUpperCase())  // capitalize first letter
        .trim();

      // Register the param
      this.registerParam(paramId, {
        label: label,
        min: min,
        max: max,
        default: parseFloat(el.value) || (min + max) / 2,
        onChange: (val) => {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });

      count++;
    });

    if (count > 0) {
      console.log(`[ModMatrix] Auto-registered ${count} parameters`);
    }
  }

  /**
   * Cleanup
   */
  dispose() {
    this.stop();
    this.params.clear();
  }
}

// Singleton
let modMatrixInstance = null;

function getModulationMatrix() {
  if (!modMatrixInstance) {
    modMatrixInstance = new ModulationMatrix();
  }
  return modMatrixInstance;
}

// Export
if (typeof window !== 'undefined') {
  window.ModulationMatrix = ModulationMatrix;
  window.ModulatableParam = ModulatableParam;
  window.getModulationMatrix = getModulationMatrix;
}

export { ModulationMatrix, ModulatableParam, ModSource, getModulationMatrix };
