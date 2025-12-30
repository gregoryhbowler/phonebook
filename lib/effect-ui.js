// ============================================================================
// PEDALBOARD UI
// Effect chain user interface component
// ============================================================================

// Note: MIDI Learn and Modulation are loaded dynamically in init()
// to support both ES module and regular script loading

class PedalboardUI {
  constructor(container, audioContext, options = {}) {
    this.container = container;
    this.audioContext = audioContext;
    this.workletNode = null;
    this.slots = [];
    this.maxSlots = 8;
    this.showPicker = false;
    this.selectedSlot = null;

    // MIDI Learn and Modulation (loaded dynamically)
    this.midiLearn = null;
    this.modMatrix = null;
    this.patchId = options.patchId || 'pedalboard';
    this.enableMidiMod = options.enableMidiMod !== false; // default true

    // Effect definitions with parameters
    this.effectDefs = {
      delay: {
        name: 'Delay',
        category: 'Time',
        params: {
          time: { min: 0.03, max: 2, default: 0.5, step: 0.01, label: 'Time' },
          feedback: { min: 0, max: 1, default: 0.4, step: 0.01, label: 'Feedback' },
          quality: { min: 0, max: 3, default: 0, step: 1, label: 'Quality', options: ['Digital', 'Analog', 'Tape', 'Lo-Fi'] },
          mode: { min: 0, max: 2, default: 0, step: 1, label: 'Mode', options: ['Normal', 'Ping-Pong', 'Slapback'] },
          mix: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Mix' }
        }
      },
      reverb: {
        name: 'Reverb',
        category: 'Time',
        params: {
          size: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Size' },
          decay: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Decay' },
          shimmer: { min: 0, max: 1, default: 0, step: 0.01, label: 'Shimmer' },
          tone: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Tone' },
          mix: { min: 0, max: 1, default: 0.3, step: 0.01, label: 'Mix' }
        }
      },
      chorus: {
        name: 'Chorus',
        category: 'Modulation',
        params: {
          rate: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Rate' },
          depth: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Depth' },
          mix: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Mix' }
        }
      },
      tremolo: {
        name: 'Tremolo',
        category: 'Modulation',
        params: {
          time: { min: 0.05, max: 2, default: 0.5, step: 0.01, label: 'Time' },
          depth: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Depth' },
          shape: { min: 0, max: 1, default: 0.33, step: 0.01, label: 'Shape' },
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' }
        }
      },
      flanger: {
        name: 'Flanger',
        category: 'Modulation',
        params: {
          rate: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Rate' },
          depth: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Depth' },
          feedback: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Feedback' },
          predelay: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Pre-delay' },
          mix: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Mix' }
        }
      },
      phaser: {
        name: 'Phaser',
        category: 'Modulation',
        params: {
          rate: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Rate' },
          depth: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Depth' },
          mix: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Mix' }
        }
      },
      overdrive: {
        name: 'Overdrive',
        category: 'Distortion',
        params: {
          drive: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Drive' },
          tone: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Tone' },
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' }
        }
      },
      distortion: {
        name: 'Distortion',
        category: 'Distortion',
        params: {
          drive: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Drive' },
          tone: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Tone' },
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' }
        }
      },
      compressor: {
        name: 'Compressor',
        category: 'Dynamics',
        params: {
          threshold: { min: -60, max: 0, default: -20, step: 1, label: 'Threshold' },
          ratio: { min: 1, max: 20, default: 4, step: 0.5, label: 'Ratio' },
          attack: { min: 0.1, max: 100, default: 10, step: 0.5, label: 'Attack' },
          release: { min: 10, max: 1000, default: 100, step: 10, label: 'Release' },
          makeup: { min: 0, max: 24, default: 0, step: 0.5, label: 'Makeup' },
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' }
        }
      },
      vibrato: {
        name: 'Vibrato',
        category: 'Modulation',
        params: {
          rate: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Rate' },
          depth: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Depth' },
          expression: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Expression' },
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' }
        }
      },
      autowah: {
        name: 'AutoWah',
        category: 'Modulation',
        params: {
          rate: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Rate' },
          depth: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Depth' },
          sensitivity: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Sensitivity' },
          resonance: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Resonance' },
          mode: { min: 0, max: 2, default: 0, step: 1, label: 'Mode', options: ['Lowpass', 'Bandpass', 'Highpass'] },
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' }
        }
      },
      wavefolder: {
        name: 'Wavefolder',
        category: 'Distortion',
        params: {
          amount: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Amount' },
          symmetry: { min: 0, max: 1, default: 1, step: 0.01, label: 'Symmetry' },
          smoothing: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Smoothing' },
          expression: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Expression' },
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' }
        }
      },
      bitcrusher: {
        name: 'Bitcrusher',
        category: 'Distortion',
        params: {
          bitrate: { min: 1, max: 16, default: 12, step: 1, label: 'Bit Depth' },
          samplerate: { min: 0, max: 1, default: 1, step: 0.01, label: 'Sample Rate' },
          tone: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Tone' },
          gate: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Gate' },
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' }
        }
      },
      sustain: {
        name: 'Sustain',
        category: 'Dynamics',
        params: {
          sustain: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Sustain' },
          level: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Level' },
          tone: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Tone' },
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' }
        }
      },
      ringmod: {
        name: 'Ring Mod',
        category: 'Spectral',
        params: {
          freq: { min: 20, max: 2000, default: 220, step: 1, label: 'Frequency' },
          shape: { min: 0, max: 1, default: 0.33, step: 0.01, label: 'Shape' },
          tone: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Tone' },
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' }
        }
      },
      pitchshifter: {
        name: 'Pitch Shifter',
        category: 'Spectral',
        params: {
          shift: { min: -12, max: 12, default: 0, step: 1, label: 'Semitones' },
          drift: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Drift' },
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' }
        }
      },
      subboost: {
        name: 'Sub Boost',
        category: 'Spectral',
        params: {
          octaves: { min: 1, max: 3, default: 2, step: 1, label: 'Octaves', options: ['1 Oct', '2 Oct', '3 Oct'] },
          shape: { min: 0, max: 1, default: 0.33, step: 0.01, label: 'Shape' },
          level: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Level' },
          mix: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Mix' }
        }
      },
      lofi: {
        name: 'Lo-Fi',
        category: 'Spectral',
        params: {
          drive: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Drive' },
          wow: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Wow' },
          noise: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Noise' },
          tone: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Tone' },
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' }
        }
      },
      equalizer: {
        name: 'Equalizer',
        category: 'Spectral',
        params: {
          lowFreq: { min: 40, max: 400, default: 70, step: 1, label: 'Low Freq' },
          lowGain: { min: -12, max: 12, default: 0, step: 0.5, label: 'Low Gain' },
          midFreq: { min: 200, max: 5000, default: 1000, step: 10, label: 'Mid Freq' },
          midQ: { min: 0.5, max: 4, default: 1, step: 0.1, label: 'Mid Q' },
          midGain: { min: -12, max: 12, default: 0, step: 0.5, label: 'Mid Gain' },
          highFreq: { min: 2000, max: 12000, default: 5000, step: 100, label: 'High Freq' },
          highGain: { min: -12, max: 12, default: 0, step: 0.5, label: 'High Gain' },
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' }
        }
      },
      rings: {
        name: 'Rings',
        category: 'Advanced',
        params: {
          pitch: { min: 24, max: 96, default: 60, step: 1, label: 'Pitch' },
          structure: { min: 0, max: 1, default: 0.36, step: 0.01, label: 'Structure' },
          brightness: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Brightness' },
          damping: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Damping' },
          position: { min: 0, max: 1, default: 0.33, step: 0.01, label: 'Position' },
          polyphony: { min: 1, max: 4, default: 4, step: 1, label: 'Polyphony', options: ['1', '2', '3', '4'] },
          mix: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Mix' }
        }
      },
      clouds: {
        name: 'Clouds',
        category: 'Advanced',
        params: {
          position: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Position' },
          size: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Size' },
          pitch: { min: -12, max: 12, default: 0, step: 1, label: 'Pitch' },
          density: { min: 0, max: 1, default: 0.33, step: 0.01, label: 'Density' },
          texture: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Texture' },
          feedback: { min: 0, max: 1, default: 0.2, step: 0.01, label: 'Feedback' },
          reverb: { min: 0, max: 1, default: 0, step: 0.01, label: 'Reverb' },
          freeze: { min: 0, max: 1, default: 0, step: 1, label: 'Freeze', options: ['Off', 'On'] },
          mix: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Mix' }
        }
      },
      ampsimulator: {
        name: 'Amp Sim',
        category: 'Advanced',
        params: {
          drive: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Drive' },
          bass: { min: -12, max: 12, default: 0, step: 0.5, label: 'Bass' },
          mid: { min: -12, max: 12, default: 0, step: 0.5, label: 'Mid' },
          treble: { min: -12, max: 12, default: 0, step: 0.5, label: 'Treble' },
          presence: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Presence' },
          room: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Room' },
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' }
        }
      },
      mastergain: {
        name: 'Master Gain',
        category: 'Dynamics',
        params: {
          gain: { min: -24, max: 24, default: 0, step: 0.5, label: 'Gain (dB)' },
          limiter: { min: 0, max: 1, default: 1, step: 0.01, label: 'Limiter' }
        }
      },
      // === EXTERNAL ADVANCED EFFECTS ===
      mimeophon: {
        name: 'Mimeophon',
        category: 'Advanced',
        external: true, // Flag for external worklet-based effects
        params: {
          zone: { min: 0, max: 3, default: 1, step: 1, label: 'Zone', options: ['A (5-50ms)', 'B (50-400ms)', 'C (0.4-2s)', 'D (2-10s)'] },
          rate: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Rate' },
          microRate: { min: 0, max: 1, default: 0, step: 0.01, label: 'Micro Rate' },
          microRateFreq: { min: 0.1, max: 8, default: 2, step: 0.1, label: 'MRate Freq' },
          skew: { min: -1, max: 1, default: 0, step: 0.01, label: 'Skew' },
          repeats: { min: 0, max: 1.2, default: 0.3, step: 0.01, label: 'Repeats' },
          color: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Color' },
          halo: { min: 0, max: 1, default: 0, step: 0.01, label: 'Halo' },
          mix: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Mix' },
          hold: { min: 0, max: 1, default: 0, step: 1, label: 'Hold', options: ['Off', 'On'] },
          flip: { min: 0, max: 1, default: 0, step: 1, label: 'Flip', options: ['Off', 'On'] },
          pingPong: { min: 0, max: 1, default: 0, step: 1, label: 'Ping-Pong', options: ['Off', 'On'] },
          swap: { min: 0, max: 1, default: 0, step: 1, label: 'Swap', options: ['Off', 'On'] }
        }
      },
      nautilus: {
        name: 'Nautilus',
        category: 'Advanced',
        external: true,
        params: {
          mix: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Mix' },
          resolution: { min: 0, max: 1, default: 0.4, step: 0.01, label: 'Resolution' },
          feedback: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Feedback' },
          sensors: { min: 1, max: 8, default: 1, step: 1, label: 'Sensors', options: ['1', '2', '3', '4', '5', '6', '7', '8'] },
          dispersal: { min: 0, max: 1, default: 0, step: 0.01, label: 'Dispersal' },
          reversal: { min: 0, max: 1, default: 0, step: 0.01, label: 'Reversal' },
          chroma: { min: 0, max: 5, default: 0, step: 1, label: 'Chroma', options: ['Oceanic', 'White Water', 'Refraction', 'Pulse Amp', 'Receptor', 'SOS'] },
          depth: { min: 0, max: 1, default: 0, step: 0.01, label: 'Depth' },
          delayMode: { min: 0, max: 3, default: 0, step: 1, label: 'Delay Mode', options: ['Fade', 'Doppler', 'Shimmer', 'DeShimmer'] },
          feedbackMode: { min: 0, max: 3, default: 0, step: 1, label: 'FB Mode', options: ['Normal', 'Ping-Pong', 'Cascade', 'Adrift'] },
          reverbMix: { min: 0, max: 1, default: 0, step: 0.01, label: 'Reverb' }
        }
      },
      arbhar: {
        name: 'Arbhar',
        category: 'Advanced',
        external: true,
        params: {
          mix: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Mix' },
          scan: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Scan' },
          spray: { min: 0, max: 1, default: 0, step: 0.01, label: 'Spray' },
          intensity: { min: 0, max: 1, default: 0.25, step: 0.01, label: 'Intensity' },
          length: { min: 0, max: 1, default: 0.3, step: 0.01, label: 'Length' },
          pitch: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Pitch' },
          pitchSpray: { min: 0, max: 1, default: 0, step: 0.01, label: 'Pitch Spray' },
          direction: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Direction' },
          feedback: { min: 0, max: 1, default: 0, step: 0.01, label: 'Feedback' },
          reverbMix: { min: 0, max: 1, default: 0, step: 0.01, label: 'Reverb' },
          scanMode: { min: 0, max: 2, default: 0, step: 1, label: 'Mode', options: ['Scan', 'Follow', 'Wavetable'] },
          layer: { min: 0, max: 5, default: 0, step: 1, label: 'Layer', options: ['1', '2', '3', '4', '5', '6'] },
          freeze: { min: 0, max: 1, default: 0, step: 1, label: 'Freeze', options: ['Off', 'On'] }
        },
        actions: [
          { id: 'record', label: 'REC', method: 'startRecording', toggle: 'stopRecording', className: 'action-record' },
          { id: 'strike', label: 'STRIKE', method: 'strike', className: 'action-strike' },
          { id: 'clearLayer', label: 'CLEAR', method: 'clearLayer', className: 'action-clear' }
        ]
      },
      morphagene: {
        name: 'Morphagene',
        category: 'Advanced',
        external: true,
        params: {
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' },
          varispeed: { min: 0, max: 1, default: 0.75, step: 0.01, label: 'Vari-Speed' },
          geneSize: { min: 0, max: 1, default: 0, step: 0.01, label: 'Gene Size' },
          slide: { min: 0, max: 1, default: 0, step: 0.01, label: 'Slide' },
          morph: { min: 0, max: 1, default: 0.3, step: 0.01, label: 'Morph' },
          organize: { min: 0, max: 1, default: 0, step: 0.01, label: 'Organize' },
          sos: { min: 0, max: 1, default: 1, step: 0.01, label: 'S.O.S' },
          freeze: { min: 0, max: 1, default: 0, step: 1, label: 'Freeze', options: ['Off', 'On'] }
        },
        actions: [
          { id: 'record', label: 'REC', method: 'startRecording', toggle: 'stopRecording', className: 'action-record' },
          { id: 'play', label: 'PLAY', method: 'setPlay', toggleParam: true, className: 'action-play' },
          { id: 'splice', label: 'SPLICE', method: 'createSplice', className: 'action-splice' },
          { id: 'shift', label: 'SHIFT', method: 'shiftSplice', className: 'action-shift' },
          { id: 'clear', label: 'CLEAR', method: 'clearReel', className: 'action-clear' }
        ]
      },
      lubadh: {
        name: 'Lubadh',
        category: 'Advanced',
        external: true,
        params: {
          mix: { min: 0, max: 1, default: 1, step: 0.01, label: 'Mix' },
          speedA: { min: 0, max: 1, default: 0.75, step: 0.01, label: 'Speed A' },
          startA: { min: 0, max: 1, default: 0, step: 0.01, label: 'Start A' },
          lengthA: { min: 0, max: 1, default: 1, step: 0.01, label: 'Length A' },
          dubLevelA: { min: 0, max: 1, default: 0.9, step: 0.01, label: 'Dub A' },
          speedB: { min: 0, max: 1, default: 0.75, step: 0.01, label: 'Speed B' },
          startB: { min: 0, max: 1, default: 0, step: 0.01, label: 'Start B' },
          lengthB: { min: 0, max: 1, default: 1, step: 0.01, label: 'Length B' },
          dubLevelB: { min: 0, max: 1, default: 0.9, step: 0.01, label: 'Dub B' },
          tapeEmulation: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Tape' },
          wowFlutter: { min: 0, max: 1, default: 0.3, step: 0.01, label: 'Wow/Flutter' },
          link: { min: 0, max: 1, default: 0, step: 1, label: 'Link', options: ['Off', 'On'] }
        },
        actions: [
          { id: 'recordA', label: 'REC A', method: 'startRecording', methodArg: 'A', toggle: 'stopRecording', className: 'action-record' },
          { id: 'recordB', label: 'REC B', method: 'startRecording', methodArg: 'B', toggle: 'stopRecording', className: 'action-record' },
          { id: 'punchA', label: 'PUNCH A', method: 'punchIn', methodArg: 'A', className: 'action-punch' },
          { id: 'punchB', label: 'PUNCH B', method: 'punchIn', methodArg: 'B', className: 'action-punch' },
          { id: 'eraseA', label: 'ERASE A', method: 'erase', methodArg: 'A', className: 'action-erase' },
          { id: 'eraseB', label: 'ERASE B', method: 'erase', methodArg: 'B', className: 'action-erase' },
          { id: 'retrigA', label: 'RETRIG A', method: 'retrigger', methodArg: 'A', className: 'action-retrig' },
          { id: 'retrigB', label: 'RETRIG B', method: 'retrigger', methodArg: 'B', className: 'action-retrig' }
        ]
      },
      databender: {
        name: 'DataBender',
        category: 'Advanced',
        external: true,
        params: {
          mix: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Mix' },
          time: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Time' },
          repeats: { min: 0, max: 1, default: 0, step: 0.01, label: 'Repeats' },
          bend: { min: 0, max: 1, default: 0, step: 0.01, label: 'Bend' },
          break: { min: 0, max: 1, default: 0, step: 0.01, label: 'Break' },
          corrupt: { min: 0, max: 1, default: 0, step: 0.01, label: 'Corrupt' },
          corruptType: { min: 0, max: 4, default: 0, step: 1, label: 'Corrupt Type', options: ['Decimate', 'Dropout', 'Destroy', 'DJ Filter', 'Vinyl'] },
          mode: { min: 0, max: 1, default: 0, step: 1, label: 'Mode', options: ['Macro', 'Micro'] },
          freeze: { min: 0, max: 1, default: 0, step: 1, label: 'Freeze', options: ['Off', 'On'] }
        }
      },
      basil: {
        name: 'Basil',
        category: 'Advanced',
        external: true,
        params: {
          mix: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Mix' },
          time: { min: 0, max: 1, default: 0.5, step: 0.01, label: 'Time' },
          stereo: { min: 0, max: 1, default: 0, step: 0.01, label: 'Stereo' },
          feedback: { min: -1, max: 1, default: 0.5, step: 0.01, label: 'Feedback' },
          blur: { min: -1, max: 1, default: 0, step: 0.01, label: 'Blur' },
          filter: { min: -1, max: 1, default: 0, step: 0.01, label: 'Filter' },
          taps: { min: -1, max: 1, default: 0, step: 0.01, label: 'Taps' },
          speedMode: { min: 0, max: 3, default: 0, step: 1, label: 'Speed', options: ['1x', '1/2x', '1/4x', '1/8x'] },
          freeze: { min: 0, max: 1, default: 0, step: 1, label: 'Freeze', options: ['Off', 'On'] }
        }
      },
      fdnr: {
        name: 'FDNR',
        category: 'Advanced',
        external: true,
        params: {
          mix: { min: 0, max: 100, default: 50, step: 1, label: 'Mix' },
          width: { min: 0, max: 100, default: 100, step: 1, label: 'Width' },
          delay: { min: 0, max: 1000, default: 100, step: 1, label: 'Pre-Delay' },
          feedback: { min: 0, max: 100, default: 50, step: 1, label: 'Feedback' },
          density: { min: 0, max: 100, default: 0, step: 1, label: 'Density' },
          warp: { min: 0, max: 100, default: 0, step: 1, label: 'Warp' },
          modDepth: { min: 0, max: 100, default: 50, step: 1, label: 'Mod Depth' },
          ducking: { min: 0, max: 100, default: 0, step: 1, label: 'Ducking' },
          eq3Low: { min: -12, max: 12, default: 0, step: 0.5, label: 'Low EQ' },
          eq3Mid: { min: -12, max: 12, default: 0, step: 0.5, label: 'Mid EQ' },
          eq3High: { min: -12, max: 12, default: 0, step: 0.5, label: 'High EQ' }
        }
      }
    };

    this.categories = {
      'Time': ['delay', 'reverb'],
      'Modulation': ['chorus', 'tremolo', 'flanger', 'phaser', 'vibrato', 'autowah'],
      'Distortion': ['overdrive', 'distortion', 'wavefolder', 'bitcrusher'],
      'Dynamics': ['compressor', 'sustain', 'mastergain'],
      'Spectral': ['ringmod', 'pitchshifter', 'subboost', 'lofi', 'equalizer'],
      'Advanced': ['rings', 'clouds', 'ampsimulator', 'mimeophon', 'nautilus', 'arbhar', 'morphagene', 'lubadh', 'databender', 'basil', 'fdnr']
    };

    // External effect adapters (loaded on demand)
    this.externalEffects = new Map(); // slot index -> effect adapter instance
  }

  async init() {
    // Optionally initialize MIDI Learn and Modulation Matrix (dynamic import)
    if (this.enableMidiMod) {
      try {
        // Check if already available globally (from phonebook-features.js)
        if (typeof window !== 'undefined' && window.getMidiLearn) {
          this.midiLearn = await window.getMidiLearn(this.patchId);
          this.modMatrix = window.getModulationMatrix();
        }
      } catch (e) {
        console.warn('MIDI Learn or Mod Matrix not available:', e);
      }
    }

    // Combine the effects code with processor code
    const fullCode = window.PedalboardEffectsCode + `

// ============================================================================
// EFFECT CHAIN PROCESSOR
// ============================================================================
class EffectChainProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chain = [];
    this.maxSlots = 8;
    this.masterBypass = false;
    this.inputGain = 1;
    this.outputGain = 1;
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
        case 'clearChain':
          this.chain = [];
          break;
      }
    };
  }

  addEffect(slot, effectType) {
    if (slot < 0 || slot >= this.maxSlots) return;
    const EffectClass = EffectRegistry[effectType];
    if (EffectClass) {
      this.chain[slot] = new EffectClass(sampleRate);
    }
  }

  removeEffect(slot) {
    if (this.chain[slot]) {
      this.chain[slot] = null;
    }
  }

  setEffectParam(slot, param, value) {
    if (this.chain[slot]) {
      this.chain[slot][param] = value;
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    for (let s = 0; s < output[0].length; s++) {
      let L = (input[0] ? input[0][s] : 0) * this.inputGain;
      let R = (input[1] ? input[1][s] : L) * this.inputGain;

      if (!this.masterBypass) {
        for (let i = 0; i < this.chain.length; i++) {
          const effect = this.chain[i];
          if (effect && !effect.bypassed) {
            [L, R] = effect.processStereo(L, R);
          }
        }
      }

      L = this.dcBlockerL.process(L * this.outputGain);
      R = this.dcBlockerR.process(R * this.outputGain);
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

    const blob = new Blob([fullCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    try {
      await this.audioContext.audioWorklet.addModule(url);
    } catch (e) {
      console.error('Failed to load effect chain processor:', e);
      throw e;
    }

    URL.revokeObjectURL(url);

    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      'effect-chain-processor',
      { outputChannelCount: [2] }
    );

    // Create a merger node for combining internal and external effects
    this.outputMerger = this.audioContext.createGain();
    this.workletNode.connect(this.outputMerger);

    this.render();
    this.bindEvents();

    // Return outputMerger so external effects can be chained after internal ones
    return this.outputMerger;
  }

  /**
   * Connect a source to the pedalboard input
   */
  connect(sourceNode) {
    // Store the source for reconnection when external effects are added
    this.sourceNode = sourceNode;
    sourceNode.connect(this.workletNode);
    return this.outputMerger;
  }

  /**
   * Get the final output node (includes external effects)
   */
  getOutput() {
    return this.outputMerger;
  }

  /**
   * Connect external effects in the signal chain
   * Called when external effects are added/removed
   */
  connectExternalEffects() {
    console.log('[Pedalboard] connectExternalEffects called, external count:', this.externalEffects.size);

    // Only disconnect our own nodes, not the source
    try {
      this.workletNode.disconnect();
      console.log('[Pedalboard] Disconnected workletNode');
    } catch (e) { /* ignore if not connected */ }

    // Disconnect any existing external effects from each other
    for (const [idx, adapter] of this.externalEffects) {
      try {
        adapter.output.disconnect();
        console.log('[Pedalboard] Disconnected external effect at slot', idx);
      } catch (e) { /* ignore */ }
    }

    // If no external effects, simple routing: worklet -> output
    if (this.externalEffects.size === 0) {
      this.workletNode.connect(this.outputMerger);
      console.log('[Pedalboard] No external effects, connected workletNode -> outputMerger');
      return;
    }

    // Chain external effects after the internal worklet
    // Route: worklet -> external effects in order -> outputMerger
    let prevNode = this.workletNode;
    const externalSorted = Array.from(this.externalEffects.entries())
      .sort((a, b) => a[0] - b[0]);

    for (const [slotIdx, adapter] of externalSorted) {
      prevNode.connect(adapter.input);
      console.log('[Pedalboard] Connected', prevNode === this.workletNode ? 'workletNode' : 'prev adapter', '-> external effect at slot', slotIdx);
      prevNode = adapter.output;
    }

    // Connect final output
    prevNode.connect(this.outputMerger);
    console.log('[Pedalboard] Connected last node -> outputMerger');
  }

  render() {
    this.container.innerHTML = `
      <div class="pedalboard">
        <div class="pedalboard-header">
          <span class="pedalboard-title">FX Chain</span>
          <button class="pedalboard-add-btn" title="Add Effect">+</button>
        </div>
        <div class="pedalboard-slots">
          ${this.renderSlots()}
        </div>
        <div class="pedalboard-picker ${this.showPicker ? 'show' : ''}">
          <div class="picker-header">
            <span>Add Effect</span>
            <button class="picker-close">&times;</button>
          </div>
          <div class="picker-categories">
            ${this.renderCategories()}
          </div>
        </div>
      </div>
    `;
  }

  renderSlots() {
    if (this.slots.length === 0) {
      return '<div class="pedalboard-empty">No effects - click + to add</div>';
    }

    return this.slots.map((slot, i) => `
      <div class="pedalboard-slot" data-slot="${i}">
        <div class="slot-header">
          <span class="slot-name">${this.effectDefs[slot.type]?.name || slot.type}</span>
          <div class="slot-controls">
            <button class="slot-bypass ${slot.bypassed ? 'active' : ''}" title="Bypass">B</button>
            <button class="slot-remove" title="Remove">&times;</button>
          </div>
        </div>
        <div class="slot-params">
          ${this.renderParams(slot, i)}
        </div>
      </div>
    `).join('');
  }

  renderParams(slot, slotIndex) {
    const def = this.effectDefs[slot.type];
    if (!def) return '';

    const paramsHtml = Object.entries(def.params).map(([param, config]) => {
      const value = slot.params[param] !== undefined ? slot.params[param] : config.default;

      if (config.options) {
        return `
          <div class="param-group">
            <label>${config.label}</label>
            <select class="param-select" data-slot="${slotIndex}" data-param="${param}">
              ${config.options.map((opt, i) => `
                <option value="${i}" ${Math.round(value) === i ? 'selected' : ''}>${opt}</option>
              `).join('')}
            </select>
          </div>
        `;
      }

      return `
        <div class="param-group">
          <label>${config.label}</label>
          <input type="range"
            class="param-slider"
            data-slot="${slotIndex}"
            data-param="${param}"
            min="${config.min}"
            max="${config.max}"
            step="${config.step || 0.01}"
            value="${value}">
          <span class="param-value">${value.toFixed(2)}</span>
        </div>
      `;
    }).join('');

    // Add action buttons if this effect has them
    const actionsHtml = this.renderActions(slot, slotIndex);

    return paramsHtml + actionsHtml;
  }

  renderActions(slot, slotIndex) {
    const def = this.effectDefs[slot.type];
    if (!def || !def.actions) return '';

    // Get current toggle states from slot
    const toggleStates = slot.actionStates || {};

    return `
      <div class="slot-actions">
        ${def.actions.map(action => {
          const isToggle = !!action.toggle;
          const isActive = toggleStates[action.id] || false;
          const activeClass = isActive ? 'active' : '';
          const toggleClass = isToggle ? 'toggle-action' : '';
          return `
            <button class="action-btn ${action.className || ''} ${toggleClass} ${activeClass}"
                    data-slot="${slotIndex}"
                    data-action="${action.id}"
                    data-method="${action.method}"
                    data-toggle="${action.toggle || ''}"
                    data-arg="${action.methodArg || ''}"
                    data-toggle-param="${action.toggleParam || ''}"
                    title="${action.label}">
              ${action.label}
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  renderCategories() {
    return Object.entries(this.categories).map(([cat, effects]) => `
      <div class="picker-category">
        <div class="category-name">${cat}</div>
        <div class="category-effects">
          ${effects.map(e => `
            <button class="effect-btn" data-effect="${e}">${this.effectDefs[e]?.name || e}</button>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  bindEvents() {
    // Add effect button
    this.container.querySelector('.pedalboard-add-btn')?.addEventListener('click', () => {
      this.showPicker = true;
      this.render();
      this.bindEvents();
    });

    // Close picker
    this.container.querySelector('.picker-close')?.addEventListener('click', () => {
      this.showPicker = false;
      this.render();
      this.bindEvents();
    });

    // Effect buttons in picker
    this.container.querySelectorAll('.effect-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const effectType = e.target.dataset.effect;
        await this.addEffect(effectType);
        this.showPicker = false;
        this.render();
        this.bindEvents();
      });
    });

    // Bypass buttons
    this.container.querySelectorAll('.slot-bypass').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const slotEl = e.target.closest('.pedalboard-slot');
        const slotIndex = parseInt(slotEl.dataset.slot);
        this.toggleBypass(slotIndex);
        this.render();
        this.bindEvents();
      });
    });

    // Remove buttons
    this.container.querySelectorAll('.slot-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const slotEl = e.target.closest('.pedalboard-slot');
        const slotIndex = parseInt(slotEl.dataset.slot);
        this.removeEffect(slotIndex);
        this.render();
        this.bindEvents();
      });
    });

    // Parameter sliders
    this.container.querySelectorAll('.param-slider').forEach(slider => {
      const slotIndex = parseInt(slider.dataset.slot);
      const param = slider.dataset.param;
      const slot = this.slots[slotIndex];
      const effectDef = this.effectDefs[slot?.type];
      const paramDef = effectDef?.params?.[param];

      slider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);

        this.setParam(slotIndex, param, value);

        const valueSpan = e.target.nextElementSibling;
        if (valueSpan) valueSpan.textContent = value.toFixed(2);

        // Update mod matrix base value so modulation works from new position
        if (this.modMatrix && paramDef) {
          const paramId = `fx_${slotIndex}_${param}`;
          this.modMatrix.setParamBase(paramId, value);
        }
      });

      // Register for MIDI Learn (right-click to assign)
      if (this.midiLearn && paramDef) {
        const paramId = `fx_${slotIndex}_${param}`;
        this.midiLearn.registerElement(
          slider,
          paramId,
          paramDef.min,
          paramDef.max,
          (value) => {
            this.setParam(slotIndex, param, value);
            slider.value = value;
            const valueSpan = slider.nextElementSibling;
            if (valueSpan) valueSpan.textContent = value.toFixed(2);
            // Update mod matrix base value
            if (this.modMatrix) {
              this.modMatrix.setParamBase(paramId, value);
            }
          }
        );
      }

      // Register as modulation destination
      if (this.modMatrix && paramDef) {
        const paramId = `fx_${slotIndex}_${param}`;
        const label = `${effectDef.name} ${paramDef.label}`;
        this.modMatrix.registerParam(paramId, {
          label: label,
          min: paramDef.min,
          max: paramDef.max,
          default: slot.params[param],
          onChange: (value) => {
            this.setParam(slotIndex, param, value);
            slider.value = value;
            const valueSpan = slider.nextElementSibling;
            if (valueSpan) valueSpan.textContent = value.toFixed(2);
          }
        });
      }
    });

    // Parameter selects
    this.container.querySelectorAll('.param-select').forEach(select => {
      const slotIndex = parseInt(select.dataset.slot);
      const param = select.dataset.param;
      const slot = this.slots[slotIndex];
      const effectDef = this.effectDefs[slot?.type];
      const paramDef = effectDef?.params?.[param];

      select.addEventListener('change', (e) => {
        const value = parseInt(e.target.value);
        this.setParam(slotIndex, param, value);
      });

      // Register for MIDI Learn (selects map CC to option index)
      if (this.midiLearn && paramDef) {
        const paramId = `fx_${slotIndex}_${param}`;
        this.midiLearn.registerElement(
          select,
          paramId,
          paramDef.min,
          paramDef.max,
          (value) => {
            const intValue = Math.round(value);
            this.setParam(slotIndex, param, intValue);
            select.value = intValue;
          }
        );
      }
    });

    // Action buttons (for recording, triggering, etc.)
    this.container.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const slotIndex = parseInt(e.target.dataset.slot);
        const actionId = e.target.dataset.action;
        const method = e.target.dataset.method;
        const toggle = e.target.dataset.toggle;
        const arg = e.target.dataset.arg || undefined;
        const toggleParam = e.target.dataset.toggleParam === 'true';

        this.handleAction(slotIndex, actionId, method, toggle, arg, toggleParam);
      });
    });
  }

  handleAction(slotIndex, actionId, method, toggle, arg, toggleParam) {
    const slot = this.slots[slotIndex];
    if (!slot || !slot.external) return;

    const adapter = this.externalEffects.get(slotIndex);
    if (!adapter) return;

    // Initialize action states if not present
    if (!slot.actionStates) {
      slot.actionStates = {};
    }

    const isActive = slot.actionStates[actionId] || false;

    // Handle toggle actions (like record start/stop)
    if (toggle) {
      if (isActive) {
        // Call the toggle method (e.g., stopRecording)
        if (typeof adapter[toggle] === 'function') {
          adapter[toggle](arg);
        }
        slot.actionStates[actionId] = false;
      } else {
        // Call the primary method (e.g., startRecording)
        if (typeof adapter[method] === 'function') {
          adapter[method](arg);
        }
        slot.actionStates[actionId] = true;
      }
    } else if (toggleParam) {
      // For methods that take a boolean (like setPlay)
      const newState = !isActive;
      if (typeof adapter[method] === 'function') {
        adapter[method](newState);
      }
      slot.actionStates[actionId] = newState;
    } else {
      // One-shot action (like strike, splice, etc.)
      if (typeof adapter[method] === 'function') {
        adapter[method](arg);
      }
    }

    // Re-render to update button states
    this.render();
    this.bindEvents();
  }

  async addEffect(effectType) {
    const slotIndex = this.slots.length;
    if (slotIndex >= this.maxSlots) return;

    const def = this.effectDefs[effectType];
    const params = {};
    if (def) {
      Object.entries(def.params).forEach(([param, config]) => {
        params[param] = config.default;
      });
    }

    this.slots.push({
      type: effectType,
      bypassed: false,
      params: params,
      external: def?.external || false
    });

    // Check if this is an external effect
    if (def?.external) {
      await this._addExternalEffect(slotIndex, effectType, params);
    } else if (this.workletNode) {
      this.workletNode.port.postMessage({
        action: 'addEffect',
        slot: slotIndex,
        effectType: effectType
      });

      // Send default params
      Object.entries(params).forEach(([param, value]) => {
        this.workletNode.port.postMessage({
          action: 'setParam',
          slot: slotIndex,
          param: param,
          value: value
        });
      });
    }
  }

  async _addExternalEffect(slotIndex, effectType, params) {
    try {
      // Dynamically import the adapter
      let adapter;

      if (effectType === 'mimeophon') {
        const { MimeophonAdapter } = await import('./effects/mimeophon-adapter.js');
        adapter = new MimeophonAdapter(this.audioContext, slotIndex);
      } else if (effectType === 'nautilus') {
        const { NautilusAdapter } = await import('./effects/nautilus-adapter.js');
        adapter = new NautilusAdapter(this.audioContext, slotIndex);
      } else if (effectType === 'arbhar') {
        const { ArbharAdapter } = await import('./effects/arbhar-adapter.js');
        adapter = new ArbharAdapter(this.audioContext, slotIndex);
      } else if (effectType === 'morphagene') {
        const { MorphageneAdapter } = await import('./effects/morphagene-adapter.js');
        adapter = new MorphageneAdapter(this.audioContext, slotIndex);
      } else if (effectType === 'lubadh') {
        const { LubadhAdapter } = await import('./effects/lubadh-adapter.js');
        adapter = new LubadhAdapter(this.audioContext, slotIndex);
      } else if (effectType === 'databender') {
        const { DataBenderAdapter } = await import('./effects/databender-adapter.js');
        adapter = new DataBenderAdapter(this.audioContext, slotIndex);
      } else if (effectType === 'basil') {
        const { BasilAdapter } = await import('./effects/basil-adapter.js');
        adapter = new BasilAdapter(this.audioContext, slotIndex);
      } else if (effectType === 'fdnr') {
        const { FDNRAdapter } = await import('./effects/fdnr-adapter.js');
        adapter = new FDNRAdapter(this.audioContext, slotIndex);
      }

      if (adapter) {
        await adapter.initialize();

        // Set initial params
        Object.entries(params).forEach(([param, value]) => {
          adapter.setParam(param, value);
        });

        // Store the adapter
        this.externalEffects.set(slotIndex, adapter);

        // Rebuild audio routing
        this._rebuildAudioRouting();
      }
    } catch (error) {
      console.error(`Failed to add external effect ${effectType}:`, error);
      // Remove the slot if we failed
      this.slots.pop();
    }
  }

  _rebuildAudioRouting() {
    // Rebuild the audio routing to accommodate external effects
    this.connectExternalEffects();
  }

  removeEffect(slotIndex) {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return;

    // Check if this is an external effect
    const slot = this.slots[slotIndex];
    const wasExternal = slot.external;
    const effectDef = this.effectDefs[slot.type];

    // Unregister modulation params for this slot
    if (this.modMatrix && effectDef) {
      Object.keys(effectDef.params).forEach(param => {
        const paramId = `fx_${slotIndex}_${param}`;
        this.modMatrix.unregisterParam(paramId);
      });
    }

    // Clear MIDI mappings for this slot's params
    if (this.midiLearn && effectDef) {
      Object.keys(effectDef.params).forEach(param => {
        const paramId = `fx_${slotIndex}_${param}`;
        this.midiLearn.clearMapping(paramId);
      });
    }

    if (wasExternal && this.externalEffects.has(slotIndex)) {
      const adapter = this.externalEffects.get(slotIndex);
      adapter.dispose();
      this.externalEffects.delete(slotIndex);
    }

    this.slots.splice(slotIndex, 1);

    // Rebuild the external effects map with updated indices
    const newExternalEffects = new Map();
    this.externalEffects.forEach((adapter, oldIndex) => {
      if (oldIndex > slotIndex) {
        adapter.slot = oldIndex - 1;
        newExternalEffects.set(oldIndex - 1, adapter);
      } else {
        newExternalEffects.set(oldIndex, adapter);
      }
    });
    this.externalEffects = newExternalEffects;

    // Rebuild the chain in the processor (for internal effects)
    if (this.workletNode) {
      this.workletNode.port.postMessage({ action: 'clearChain' });

      this.slots.forEach((slot, i) => {
        if (!slot.external) {
          this.workletNode.port.postMessage({
            action: 'addEffect',
            slot: i,
            effectType: slot.type
          });

          Object.entries(slot.params).forEach(([param, value]) => {
            this.workletNode.port.postMessage({
              action: 'setParam',
              slot: i,
              param: param,
              value: value
            });
          });

          if (slot.bypassed) {
            this.workletNode.port.postMessage({
              action: 'setBypass',
              slot: i,
              bypassed: true
            });
          }
        }
      });
    }

    // Only rebuild audio routing if we removed an external effect
    // or if there are still external effects in the chain
    if (wasExternal || this.externalEffects.size > 0) {
      this._rebuildAudioRouting();
    }
  }

  toggleBypass(slotIndex) {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return;

    this.slots[slotIndex].bypassed = !this.slots[slotIndex].bypassed;
    const bypassed = this.slots[slotIndex].bypassed;

    // Check if this is an external effect
    if (this.slots[slotIndex].external && this.externalEffects.has(slotIndex)) {
      const adapter = this.externalEffects.get(slotIndex);
      adapter.bypass(bypassed);
    } else if (this.workletNode) {
      this.workletNode.port.postMessage({
        action: 'setBypass',
        slot: slotIndex,
        bypassed: bypassed
      });
    }
  }

  setParam(slotIndex, param, value) {
    if (slotIndex < 0 || slotIndex >= this.slots.length) return;

    this.slots[slotIndex].params[param] = value;

    // Check if this is an external effect
    if (this.slots[slotIndex].external && this.externalEffects.has(slotIndex)) {
      const adapter = this.externalEffects.get(slotIndex);
      adapter.setParam(param, value);
    } else if (this.workletNode) {
      this.workletNode.port.postMessage({
        action: 'setParam',
        slot: slotIndex,
        param: param,
        value: value
      });
    }
  }

  // Preset management
  getPreset() {
    return {
      slots: this.slots.map(s => ({
        type: s.type,
        bypassed: s.bypassed,
        params: { ...s.params }
      }))
    };
  }

  loadPreset(preset) {
    // Clear current chain
    this.slots = [];
    if (this.workletNode) {
      this.workletNode.port.postMessage({ action: 'clearChain' });
    }

    // Load new effects
    preset.slots.forEach((slot, i) => {
      this.slots.push({
        type: slot.type,
        bypassed: slot.bypassed || false,
        params: { ...slot.params }
      });

      if (this.workletNode) {
        this.workletNode.port.postMessage({
          action: 'addEffect',
          slot: i,
          effectType: slot.type
        });

        Object.entries(slot.params).forEach(([param, value]) => {
          this.workletNode.port.postMessage({
            action: 'setParam',
            slot: i,
            param: param,
            value: value
          });
        });

        if (slot.bypassed) {
          this.workletNode.port.postMessage({
            action: 'setBypass',
            slot: i,
            bypassed: true
          });
        }
      }
    });

    this.render();
    this.bindEvents();
  }

  saveToLocalStorage(key = 'pedalboard-preset') {
    localStorage.setItem(key, JSON.stringify(this.getPreset()));
  }

  loadFromLocalStorage(key = 'pedalboard-preset') {
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        this.loadPreset(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load preset:', e);
      }
    }
  }
}

// Export for both regular script and ES module usage
if (typeof window !== 'undefined') {
  window.PedalboardUI = PedalboardUI;
}

// ES module export (only works when loaded as module)
try {
  if (typeof module !== 'undefined') {
    module.exports = { PedalboardUI };
  }
} catch (e) {
  // Not in CommonJS environment, ignore
}
