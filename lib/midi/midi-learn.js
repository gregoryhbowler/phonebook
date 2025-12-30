// ============================================================================
// MIDI LEARN
// Assign any parameter to MIDI CC controllers
// ============================================================================

import { MidiManager } from './midi-manager.js';

class MidiLearn {
  constructor() {
    this.midiManager = null;
    this.mappings = new Map(); // CC# -> array of mappings
    this.learningTarget = null;
    this.isLearning = false;
    this.isMidiLearnModeActive = false;
    this.storageKey = 'phonebook-midi-mappings';
    this.registeredElements = new Map(); // paramId -> {element, min, max, onChange}

    this._unsubscribeCC = null;
  }

  async init(patchId = 'default') {
    this.patchId = patchId;
    this.storageKey = `phonebook-midi-mappings-${patchId}`;

    this.midiManager = await MidiManager.getInstance();

    if (!this.midiManager.isAvailable) {
      console.warn('MIDI Learn: MIDI not available');
      return false;
    }

    // Listen for CC messages
    this._unsubscribeCC = this.midiManager.onCC((data) => {
      this._handleCC(data);
    });

    // Load saved mappings
    this.loadMappings();

    return true;
  }

  /**
   * Enable/disable MIDI learn mode globally
   */
  setMidiLearnMode(active) {
    this.isMidiLearnModeActive = active;

    if (!active) {
      // Cancel any active learning when exiting mode
      this.cancelLearning();
    }

    // Update visual state of all registered elements
    this.registeredElements.forEach((config, paramId) => {
      if (active) {
        config.element.classList.add('midi-learnable');
      } else {
        config.element.classList.remove('midi-learnable');
      }
    });
  }

  /**
   * Start learning mode for a parameter (called when element is clicked in MIDI learn mode)
   * @param {Object} config - Learning configuration
   * @param {HTMLElement} config.element - The slider/input element
   * @param {string} config.paramId - Unique parameter identifier
   * @param {number} config.min - Parameter minimum
   * @param {number} config.max - Parameter maximum
   * @param {Function} config.onChange - Callback when value changes
   */
  startLearning(config) {
    if (!this.midiManager?.isAvailable) {
      console.warn('MIDI not available');
      return false;
    }

    // If clicking the same element that's already learning, cancel it
    if (this.learningTarget && this.learningTarget.element === config.element) {
      this.cancelLearning();
      return false;
    }

    // Cancel any previous learning target
    if (this.learningTarget) {
      this.learningTarget.element.classList.remove('midi-learning');
    }

    this.learningTarget = {
      element: config.element,
      paramId: config.paramId,
      min: config.min,
      max: config.max,
      onChange: config.onChange
    };

    this.isLearning = true;

    // Add visual indicator
    config.element.classList.add('midi-learning');

    // Dispatch event for UI feedback
    window.dispatchEvent(new CustomEvent('midi-learn-start', {
      detail: { paramId: config.paramId }
    }));

    return true;
  }

  cancelLearning() {
    if (this.learningTarget) {
      this.learningTarget.element.classList.remove('midi-learning');
    }
    this.learningTarget = null;
    this.isLearning = false;

    window.dispatchEvent(new CustomEvent('midi-learn-cancel'));
  }

  _handleCC(data) {
    const { cc, normalized } = data;

    // If in learning mode, assign this CC to the target
    if (this.isLearning && this.learningTarget) {
      this._assignCC(cc, this.learningTarget);
      return;
    }

    // Otherwise, route to mapped parameters
    const mappingsForCC = this.mappings.get(cc);
    if (mappingsForCC) {
      mappingsForCC.forEach(mapping => {
        const scaledValue = mapping.min + normalized * (mapping.max - mapping.min);

        // Update the element value
        if (mapping.element) {
          mapping.element.value = scaledValue;
          // Trigger input event for listeners
          mapping.element.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Call the onChange callback
        if (mapping.onChange) {
          mapping.onChange(scaledValue);
        }
      });
    }
  }

  _assignCC(cc, target) {
    // Remove learning state
    target.element.classList.remove('midi-learning');
    target.element.classList.add('midi-mapped');

    // Store the mapping
    const mapping = {
      paramId: target.paramId,
      element: target.element,
      min: target.min,
      max: target.max,
      onChange: target.onChange
    };

    // Add to mappings (one CC can control multiple params)
    if (!this.mappings.has(cc)) {
      this.mappings.set(cc, []);
    }

    // Check if this param is already mapped to this CC
    const existing = this.mappings.get(cc).findIndex(m => m.paramId === target.paramId);
    if (existing >= 0) {
      // Update existing mapping
      this.mappings.get(cc)[existing] = mapping;
    } else {
      this.mappings.get(cc).push(mapping);
    }

    // Clear learning state
    this.learningTarget = null;
    this.isLearning = false;

    // Save mappings
    this.saveMappings();

    // Dispatch event
    window.dispatchEvent(new CustomEvent('midi-learn-complete', {
      detail: { paramId: target.paramId, cc }
    }));

    console.log(`MIDI Learn: CC${cc} -> ${target.paramId}`);
  }

  /**
   * Clear mapping for a specific parameter
   */
  clearMapping(paramId) {
    let foundCC = null;

    this.mappings.forEach((mappings, cc) => {
      const idx = mappings.findIndex(m => m.paramId === paramId);
      if (idx >= 0) {
        const mapping = mappings[idx];
        if (mapping.element) {
          mapping.element.classList.remove('midi-mapped');
        }
        mappings.splice(idx, 1);
        foundCC = cc;

        if (mappings.length === 0) {
          this.mappings.delete(cc);
        }
      }
    });

    if (foundCC !== null) {
      this.saveMappings();
      window.dispatchEvent(new CustomEvent('midi-mapping-cleared', {
        detail: { paramId }
      }));
    }
  }

  /**
   * Clear all mappings
   */
  clearAllMappings() {
    this.mappings.forEach((mappings) => {
      mappings.forEach(m => {
        if (m.element) {
          m.element.classList.remove('midi-mapped');
        }
      });
    });

    this.mappings.clear();
    this.saveMappings();

    window.dispatchEvent(new CustomEvent('midi-mappings-cleared'));
  }

  /**
   * Get mapping info for a parameter
   */
  getMappingForParam(paramId) {
    for (const [cc, mappings] of this.mappings) {
      const mapping = mappings.find(m => m.paramId === paramId);
      if (mapping) {
        return { cc, ...mapping };
      }
    }
    return null;
  }

  /**
   * Register an element for MIDI Learn
   * When in MIDI learn mode, clicking the element will arm it for assignment
   */
  registerElement(element, paramId, min, max, onChange) {
    // Store registration info
    this.registeredElements.set(paramId, { element, min, max, onChange });

    // Use mousedown for range inputs (click doesn't fire reliably on sliders)
    element.addEventListener('mousedown', (e) => {
      // Only handle if in MIDI learn mode
      if (!this.isMidiLearnModeActive) return;

      // Prevent the slider from moving while selecting for MIDI learn
      e.preventDefault();
      e.stopPropagation();

      // If already mapped, clear the mapping first then start learning
      const existing = this.getMappingForParam(paramId);
      if (existing && !this.isLearning) {
        this.clearMapping(paramId);
      }

      // Start or toggle learning for this element
      this.startLearning({ element, paramId, min, max, onChange });
    });

    // Check if there's a saved mapping for this param
    const savedMapping = this.getMappingForParam(paramId);
    if (savedMapping) {
      element.classList.add('midi-mapped');
      // Update the mapping with the live element/callback
      savedMapping.element = element;
      savedMapping.onChange = onChange;
    }

    // If already in MIDI learn mode, mark as learnable
    if (this.isMidiLearnModeActive) {
      element.classList.add('midi-learnable');
    }
  }

  /**
   * Save mappings to localStorage
   */
  saveMappings() {
    const serialized = {};

    this.mappings.forEach((mappings, cc) => {
      serialized[cc] = mappings.map(m => ({
        paramId: m.paramId,
        min: m.min,
        max: m.max
      }));
    });

    try {
      localStorage.setItem(this.storageKey, JSON.stringify(serialized));
    } catch (e) {
      console.warn('Failed to save MIDI mappings:', e);
    }
  }

  /**
   * Load mappings from localStorage
   */
  loadMappings() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (!saved) return;

      const serialized = JSON.parse(saved);

      Object.entries(serialized).forEach(([cc, mappings]) => {
        this.mappings.set(parseInt(cc), mappings.map(m => ({
          paramId: m.paramId,
          min: m.min,
          max: m.max,
          element: null,
          onChange: null
        })));
      });

      console.log(`Loaded ${this.mappings.size} MIDI mappings`);
    } catch (e) {
      console.warn('Failed to load MIDI mappings:', e);
    }
  }

  /**
   * Auto-register all eligible elements on the page
   * Finds input[type=range] and select elements with IDs and registers them
   * Uses the element's min/max attributes (or sensible defaults)
   * @param {string} prefix - Optional prefix for param IDs (e.g., 'bent808')
   * @param {HTMLElement} container - Optional container to search within (default: document)
   */
  autoRegisterAll(prefix = '', container = document) {
    const elements = container.querySelectorAll('input[type="range"][id], select[id]');
    let count = 0;

    elements.forEach(el => {
      // Skip elements that are already registered
      const paramId = prefix ? `${prefix}_${el.id}` : el.id;
      if (this.registeredElements.has(paramId)) return;

      // Get min/max from element attributes or use defaults
      let min = parseFloat(el.min) || 0;
      let max = parseFloat(el.max) || 1;

      // For select elements, use 0 to options.length-1
      if (el.tagName === 'SELECT') {
        min = 0;
        max = el.options.length - 1;
      }

      // Create onChange callback that updates element and dispatches input event
      const onChange = (val) => {
        if (el.tagName === 'SELECT') {
          el.selectedIndex = Math.round(val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };

      this.registerElement(el, paramId, min, max, onChange);
      count++;
    });

    if (count > 0) {
      console.log(`[MIDI Learn] Auto-registered ${count} elements`);
    }
  }

  /**
   * Cleanup
   */
  dispose() {
    if (this._unsubscribeCC) {
      this._unsubscribeCC();
    }
    this.cancelLearning();
  }
}

// Singleton instance
let midiLearnInstance = null;

async function getMidiLearn(patchId) {
  if (!midiLearnInstance) {
    midiLearnInstance = new MidiLearn();
    await midiLearnInstance.init(patchId);
  }
  return midiLearnInstance;
}

// Export for ES modules and global
if (typeof window !== 'undefined') {
  window.MidiLearn = MidiLearn;
  window.getMidiLearn = getMidiLearn;
}

export { MidiLearn, getMidiLearn };
