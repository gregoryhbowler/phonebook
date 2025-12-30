// ============================================================================
// PHONEBOOK FEATURES
// Unified loader for MIDI, Recording, and Modulation features
// Can be used as a script tag in HTML (non-module) patches
// ============================================================================

(async function() {
  'use strict';

  // Dynamically import all features
  const FEATURES_BASE = new URL('./', import.meta.url).href;

  // Import MIDI system
  const { MidiManager } = await import(`${FEATURES_BASE}midi/midi-manager.js`);
  const { MidiLearn, getMidiLearn } = await import(`${FEATURES_BASE}midi/midi-learn.js`);
  const { MidiKeyboard } = await import(`${FEATURES_BASE}midi/midi-keyboard.js`);

  // Import Recording system
  const { WavEncoder } = await import(`${FEATURES_BASE}recording/wav-encoder.js`);
  const { WavRecorder } = await import(`${FEATURES_BASE}recording/wav-recorder.js`);

  // Import Modulation system
  const { LFOGenerator, ALL_SHAPES, SHAPE_CATEGORIES } = await import(`${FEATURES_BASE}modulation/mod-shapes.js`);
  const { ModulationMatrix, ModulatableParam, getModulationMatrix } = await import(`${FEATURES_BASE}modulation/mod-matrix.js`);
  const { ModMatrixUI } = await import(`${FEATURES_BASE}modulation/mod-matrix-ui.js`);

  // Import Sticky Header
  const { StickyHeader } = await import(`${FEATURES_BASE}sticky-header.js`);

  // Expose all features globally
  window.MidiManager = MidiManager;
  window.MidiLearn = MidiLearn;
  window.getMidiLearn = getMidiLearn;
  window.MidiKeyboard = MidiKeyboard;
  window.WavEncoder = WavEncoder;
  window.WavRecorder = WavRecorder;
  window.LFOGenerator = LFOGenerator;
  window.MOD_SHAPES = ALL_SHAPES;
  window.MOD_SHAPE_CATEGORIES = SHAPE_CATEGORIES;
  window.ModulationMatrix = ModulationMatrix;
  window.ModulatableParam = ModulatableParam;
  window.getModulationMatrix = getModulationMatrix;
  window.ModMatrixUI = ModMatrixUI;
  window.StickyHeader = StickyHeader;

  /**
   * Auto-register all sliders for MIDI Learn and Mod Matrix
   * Call this at the end of your patch's audio initialization
   * @param {Object} options
   * @param {string} options.patchId - Unique patch identifier for MIDI mappings
   * @param {string} options.prefix - Optional prefix for param IDs
   * @param {ModMatrixUI} options.modMatrixUI - Optional ModMatrixUI instance to refresh
   */
  window.autoRegisterControls = async function(options = {}) {
    const { patchId, prefix = '', modMatrixUI = null } = options;

    // Auto-register for MIDI Learn
    if (typeof getMidiLearn !== 'undefined') {
      const midiLearn = await getMidiLearn(patchId || 'default');
      midiLearn.autoRegisterAll(prefix);
    }

    // Auto-register for Mod Matrix
    if (typeof getModulationMatrix !== 'undefined') {
      const modMatrix = getModulationMatrix();
      modMatrix.autoRegisterAll(prefix);

      // Refresh the UI if provided
      if (modMatrixUI) {
        modMatrixUI.refreshDestinations();
      }
    }
  };

  // Dispatch ready event
  window.dispatchEvent(new CustomEvent('phonebook-features-loaded'));

  console.log('[Phonebook] Features loaded: MIDI, Recording, Modulation');
})();
