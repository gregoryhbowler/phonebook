// ============================================================================
// MODULATION MATRIX UI
// Collapsible panel with 6 mod sources
// ============================================================================

import { getModulationMatrix } from './mod-matrix.js';
import { SHAPE_CATEGORIES } from './mod-shapes.js';

class ModMatrixUI {
  constructor(container, options = {}) {
    this.container = container;
    this.modMatrix = options.modMatrix || getModulationMatrix();
    this.isExpanded = false;

    this.element = null;
    this._boundUpdate = this._updateDisplay.bind(this);
  }

  init() {
    this._createUI();
    this._bindEvents();

    // Set up update callback
    this.modMatrix.onUpdate = this._boundUpdate;

    return this;
  }

  _createUI() {
    this.element = document.createElement('div');
    this.element.className = 'mod-matrix';
    this.element.innerHTML = `
      <div class="mod-matrix-header">
        <button class="mod-matrix-toggle">
          <span class="toggle-icon">+</span>
          <span class="toggle-label">Modulation Matrix</span>
        </button>
        <div class="mod-matrix-indicators">
          ${[0,1,2,3,4,5].map(i => `
            <span class="mod-indicator" data-mod="${i}"></span>
          `).join('')}
        </div>
      </div>
      <div class="mod-matrix-content">
        ${this._renderSources()}
      </div>
    `;

    this.container.appendChild(this.element);
  }

  _renderSources() {
    return this.modMatrix.sources.map((source, i) => `
      <div class="mod-source" data-source="${i}">
        <div class="mod-source-header">
          <label class="mod-enable">
            <input type="checkbox" class="mod-enable-check" data-source="${i}" ${source.enabled ? 'checked' : ''}>
            <span>Mod ${i + 1}</span>
          </label>
          <span class="mod-value" data-source="${i}">0.00</span>
        </div>

        <div class="mod-source-controls">
          <div class="mod-row">
            <div class="mod-control">
              <label>Shape</label>
              <select class="mod-shape" data-source="${i}">
                ${this._renderShapeOptions(source.generator.shape)}
              </select>
            </div>

            <div class="mod-control">
              <label>Rate</label>
              <input type="range" class="mod-rate" data-source="${i}"
                min="-2" max="2" step="0.01" value="${Math.log10(source.generator.rate)}">
              <span class="mod-rate-display">${this._formatRate(source.generator.rate)}</span>
            </div>
          </div>

          <div class="mod-row">
            <div class="mod-control">
              <label>Phase</label>
              <input type="range" class="mod-phase" data-source="${i}"
                min="0" max="1" step="0.01" value="${source.generator.phaseOffset}">
            </div>

            <div class="mod-control">
              <label>Smooth</label>
              <input type="range" class="mod-smooth" data-source="${i}"
                min="0" max="1" step="0.01" value="${source.generator.smoothing}">
            </div>

            <div class="mod-control mod-polarity">
              <label>Polarity</label>
              <select class="mod-polarity-select" data-source="${i}">
                <option value="bipolar" ${source.generator.polarity === 'bipolar' ? 'selected' : ''}>Bipolar</option>
                <option value="unipolar" ${source.generator.polarity === 'unipolar' ? 'selected' : ''}>Unipolar</option>
              </select>
            </div>
          </div>

          <div class="mod-destinations">
            ${[0, 1].map(destIdx => `
              <div class="mod-dest" data-source="${i}" data-dest="${destIdx}">
                <label>Dest ${destIdx + 1}</label>
                <select class="mod-dest-target" data-source="${i}" data-dest="${destIdx}">
                  <option value="">-- None --</option>
                  ${this._renderDestOptions(source.destinations[destIdx].targetId)}
                </select>
                <input type="range" class="mod-dest-depth" data-source="${i}" data-dest="${destIdx}"
                  min="-1" max="1" step="0.01" value="${source.destinations[destIdx].depth}">
                <span class="mod-depth-display">${(source.destinations[destIdx].depth * 100).toFixed(0)}%</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `).join('');
  }

  _renderShapeOptions(selected) {
    let html = '';

    for (const [category, shapes] of Object.entries(SHAPE_CATEGORIES)) {
      html += `<optgroup label="${category}">`;
      shapes.forEach(shape => {
        const sel = shape === selected ? 'selected' : '';
        html += `<option value="${shape}" ${sel}>${this._formatShapeName(shape)}</option>`;
      });
      html += '</optgroup>';
    }

    return html;
  }

  _renderDestOptions(selectedId) {
    const options = this.modMatrix.getDestinationOptions();
    let html = '';

    // Group by category
    const groups = {};
    options.forEach(opt => {
      if (!groups[opt.group]) groups[opt.group] = [];
      groups[opt.group].push(opt);
    });

    for (const [group, opts] of Object.entries(groups)) {
      html += `<optgroup label="${group}">`;
      opts.forEach(opt => {
        const sel = opt.id === selectedId ? 'selected' : '';
        html += `<option value="${opt.id}" ${sel}>${opt.label}</option>`;
      });
      html += '</optgroup>';
    }

    return html;
  }

  _formatShapeName(shape) {
    // Convert camelCase to Title Case
    return shape
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase());
  }

  _formatRate(hz) {
    if (hz < 0.1) return `${(hz * 1000).toFixed(0)}mHz`;
    if (hz < 1) return `${(hz * 1000).toFixed(0)}mHz`;
    if (hz < 10) return `${hz.toFixed(2)}Hz`;
    return `${hz.toFixed(1)}Hz`;
  }

  _bindEvents() {
    // Toggle expand/collapse
    const toggle = this.element.querySelector('.mod-matrix-toggle');
    toggle.addEventListener('click', () => this._toggleExpanded());

    // Enable checkboxes
    this.element.querySelectorAll('.mod-enable-check').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const srcIdx = parseInt(e.target.dataset.source);
        this.modMatrix.sources[srcIdx].enabled = e.target.checked;
      });
    });

    // Shape selects
    this.element.querySelectorAll('.mod-shape').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const srcIdx = parseInt(e.target.dataset.source);
        this.modMatrix.sources[srcIdx].setShape(e.target.value);
      });
    });

    // Rate sliders (logarithmic)
    this.element.querySelectorAll('.mod-rate').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const srcIdx = parseInt(e.target.dataset.source);
        const logRate = parseFloat(e.target.value);
        const hz = Math.pow(10, logRate);
        this.modMatrix.sources[srcIdx].setRate(hz);

        const display = e.target.parentElement.querySelector('.mod-rate-display');
        display.textContent = this._formatRate(hz);
      });
    });

    // Phase sliders
    this.element.querySelectorAll('.mod-phase').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const srcIdx = parseInt(e.target.dataset.source);
        this.modMatrix.sources[srcIdx].setPhaseOffset(parseFloat(e.target.value));
      });
    });

    // Smoothing sliders
    this.element.querySelectorAll('.mod-smooth').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const srcIdx = parseInt(e.target.dataset.source);
        this.modMatrix.sources[srcIdx].setSmoothing(parseFloat(e.target.value));
      });
    });

    // Polarity selects
    this.element.querySelectorAll('.mod-polarity-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const srcIdx = parseInt(e.target.dataset.source);
        this.modMatrix.sources[srcIdx].setPolarity(e.target.value);
      });
    });

    // Destination target selects
    this.element.querySelectorAll('.mod-dest-target').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const srcIdx = parseInt(e.target.dataset.source);
        const destIdx = parseInt(e.target.dataset.dest);
        this.modMatrix.sources[srcIdx].setDestinationTarget(destIdx, e.target.value || null);
      });
    });

    // Destination depth sliders
    this.element.querySelectorAll('.mod-dest-depth').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const srcIdx = parseInt(e.target.dataset.source);
        const destIdx = parseInt(e.target.dataset.dest);
        const depth = parseFloat(e.target.value);
        this.modMatrix.sources[srcIdx].setDestinationDepth(destIdx, depth);

        const display = e.target.parentElement.querySelector('.mod-depth-display');
        display.textContent = `${(depth * 100).toFixed(0)}%`;
      });
    });
  }

  _toggleExpanded() {
    this.isExpanded = !this.isExpanded;
    this.element.classList.toggle('expanded', this.isExpanded);

    const icon = this.element.querySelector('.toggle-icon');
    icon.textContent = this.isExpanded ? '−' : '+';
  }

  _updateDisplay(values) {
    // Update mod value displays and indicators
    values.forEach((value, i) => {
      const display = this.element.querySelector(`.mod-value[data-source="${i}"]`);
      if (display) {
        display.textContent = value.toFixed(2);
      }

      const indicator = this.element.querySelector(`.mod-indicator[data-mod="${i}"]`);
      if (indicator) {
        const source = this.modMatrix.sources[i];
        indicator.classList.toggle('active', source.enabled);

        // Color intensity based on value
        const intensity = Math.abs(value);
        indicator.style.opacity = source.enabled ? (0.3 + intensity * 0.7) : 0.2;
      }
    });
  }

  /**
   * Refresh destination options (call after registering new params)
   */
  refreshDestinations() {
    this.element.querySelectorAll('.mod-dest-target').forEach(sel => {
      const srcIdx = parseInt(sel.dataset.source);
      const destIdx = parseInt(sel.dataset.dest);
      const currentTarget = this.modMatrix.sources[srcIdx].destinations[destIdx].targetId;

      sel.innerHTML = `
        <option value="">-- None --</option>
        ${this._renderDestOptions(currentTarget)}
      `;
    });
  }

  /**
   * Cleanup
   */
  dispose() {
    if (this.element) {
      this.element.remove();
    }
    this.modMatrix.onUpdate = null;
  }
}

// Export
if (typeof window !== 'undefined') {
  window.ModMatrixUI = ModMatrixUI;
}

export { ModMatrixUI };
