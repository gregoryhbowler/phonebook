// ============================================================================
// WORKLET MANAGER
// Centralized loading and management of AudioWorklet modules
// ============================================================================

export class WorkletManager {
  constructor(audioContext) {
    this.ctx = audioContext;
    this.loadedWorklets = new Map(); // name -> { loaded: boolean, promise: Promise }
    this.workletPaths = {
      // Built-in pedalboard effects (single processor)
      'effect-chain': '/lib/effect-chain-processor.js',

      // Advanced effects from add_to_pedalboard
      'nautilus': '/add_to_pedalboard/worklets/nautilus-processor.js',
      'arbhar': '/add_to_pedalboard/worklets/arbhar-processor.js',
      'morphagene': '/add_to_pedalboard/worklets/morphagene-processor.js',
      'lubadh': '/add_to_pedalboard/worklets/lubadh-processor.js',
      'databender': '/add_to_pedalboard/worklets/databender-processor.js',
      'basil': '/add_to_pedalboard/worklets/basil-processor.js',
      'fdnr': '/add_to_pedalboard/worklets/fdnr-processor.js',
      'mimeophon': null // Mimeophon uses inline blob URL, handled separately
    };
  }

  /**
   * Check if a worklet is already loaded
   */
  isLoaded(name) {
    const entry = this.loadedWorklets.get(name);
    return entry?.loaded === true;
  }

  /**
   * Get list of loaded worklet names
   */
  getLoadedWorklets() {
    return Array.from(this.loadedWorklets.entries())
      .filter(([_, entry]) => entry.loaded)
      .map(([name]) => name);
  }

  /**
   * Load a worklet module by name
   * Returns a promise that resolves when loading is complete
   * If already loading, returns the existing promise
   */
  async loadWorklet(name, customPath = null) {
    // Check if already loaded or loading
    const existing = this.loadedWorklets.get(name);
    if (existing) {
      if (existing.loaded) {
        return true;
      }
      // Already loading, wait for it
      return existing.promise;
    }

    // Get path
    const path = customPath || this.workletPaths[name];
    if (!path && name !== 'mimeophon') {
      throw new Error(`WorkletManager: Unknown worklet "${name}" and no custom path provided`);
    }

    // Create loading promise
    const loadPromise = this._doLoad(name, path);

    // Store the promise
    this.loadedWorklets.set(name, {
      loaded: false,
      promise: loadPromise
    });

    try {
      await loadPromise;
      this.loadedWorklets.set(name, { loaded: true, promise: null });
      console.log(`WorkletManager: Loaded "${name}"`);
      return true;
    } catch (error) {
      this.loadedWorklets.delete(name);
      console.error(`WorkletManager: Failed to load "${name}":`, error);
      throw error;
    }
  }

  /**
   * Internal load implementation
   */
  async _doLoad(name, path) {
    if (path) {
      await this.ctx.audioWorklet.addModule(path);
    }
    // For effects with no path (like mimeophon with blob URL),
    // loading is handled by the effect adapter itself
  }

  /**
   * Preload multiple worklets in parallel
   */
  async preloadWorklets(names) {
    const promises = names.map(name => this.loadWorklet(name).catch(err => {
      console.warn(`WorkletManager: Failed to preload "${name}":`, err);
      return false;
    }));
    return Promise.all(promises);
  }

  /**
   * Get the registered processor name for a worklet
   * Most processors use "{name}-processor" naming convention
   */
  getProcessorName(name) {
    const processorNames = {
      'effect-chain': 'effect-chain-processor',
      'nautilus': 'nautilus-processor',
      'arbhar': 'arbhar-processor',
      'morphagene': 'morphagene-processor',
      'lubadh': 'lubadh-processor',
      'databender': 'databender-processor',
      'basil': 'basil-processor',
      'fdnr': 'fdnr-processor',
      'mimeophon': 'mimeophon-processor'
    };
    return processorNames[name] || `${name}-processor`;
  }
}

// Singleton instance (created when audio context is available)
let workletManagerInstance = null;

export function getWorkletManager(audioContext) {
  if (!workletManagerInstance && audioContext) {
    workletManagerInstance = new WorkletManager(audioContext);
  }
  return workletManagerInstance;
}

export function resetWorkletManager() {
  workletManagerInstance = null;
}
