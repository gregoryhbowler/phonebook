/**
 * ER-301 Info Panel
 * Toggleable information panel for patch description, controls, and instructions
 */

class ER301InfoPanel {
    constructor(container, config) {
        this.container = container;
        this.config = config;
        this.visible = false;
        this.panel = null;
        this.toggle = null;
        this.init();
    }

    init() {
        // Create toggle button
        this.toggle = document.createElement('button');
        this.toggle.className = 'info-toggle';
        this.toggle.innerHTML = '?';
        this.toggle.title = 'Show patch info';
        this.toggle.onclick = () => this.toggleVisibility();

        // Create panel
        this.panel = document.createElement('div');
        this.panel.className = 'info-panel';
        this.panel.innerHTML = this.renderContent();

        // Add close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'info-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => this.hide();
        this.panel.insertBefore(closeBtn, this.panel.firstChild);

        // Initially hidden
        this.panel.style.display = 'none';

        this.container.appendChild(this.toggle);
        this.container.appendChild(this.panel);
    }

    renderContent() {
        const { title, author, description, controls, tips, origin } = this.config;

        let html = `<div class="info-content">`;

        // Header
        html += `<h2 class="info-title">${title || 'Untitled Patch'}</h2>`;
        if (author) {
            html += `<p class="info-author">by ${author}</p>`;
        }
        if (origin) {
            html += `<p class="info-origin"><small>Ported from: ${origin}</small></p>`;
        }

        // Description
        if (description) {
            html += `<div class="info-section">
                <h3>Description</h3>
                <p>${description}</p>
            </div>`;
        }

        // Controls
        if (controls && controls.length > 0) {
            html += `<div class="info-section">
                <h3>Controls</h3>
                <table class="info-controls-table">
                    <thead>
                        <tr>
                            <th>Control</th>
                            <th>Range</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>`;

            controls.forEach(ctrl => {
                html += `<tr>
                    <td><strong>${ctrl.name}</strong></td>
                    <td>${ctrl.range || '-'}</td>
                    <td>${ctrl.description || ''}</td>
                </tr>`;
            });

            html += `</tbody></table></div>`;
        }

        // Tips
        if (tips && tips.length > 0) {
            html += `<div class="info-section">
                <h3>Tips</h3>
                <ul class="info-tips">`;
            tips.forEach(tip => {
                html += `<li>${tip}</li>`;
            });
            html += `</ul></div>`;
        }

        html += `</div>`;
        return html;
    }

    show() {
        this.panel.style.display = 'block';
        this.visible = true;
        this.toggle.classList.add('active');
    }

    hide() {
        this.panel.style.display = 'none';
        this.visible = false;
        this.toggle.classList.remove('active');
    }

    toggleVisibility() {
        if (this.visible) {
            this.hide();
        } else {
            this.show();
        }
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.panel.innerHTML = this.renderContent();

        // Re-add close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'info-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => this.hide();
        this.panel.insertBefore(closeBtn, this.panel.firstChild);
    }
}

// CSS styles for info panel
const infoStyles = `
.info-toggle {
    position: fixed;
    top: 10px;
    right: 10px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--bg-card, #1a1a24);
    border: 1px solid var(--border, #2a2a3a);
    color: var(--text-secondary, #8888a0);
    font-size: 18px;
    font-weight: bold;
    cursor: pointer;
    z-index: 1000;
    transition: all 0.2s;
}

.info-toggle:hover,
.info-toggle.active {
    background: var(--accent, #6366f1);
    color: white;
    border-color: var(--accent, #6366f1);
}

.info-panel {
    position: fixed;
    top: 60px;
    right: 10px;
    width: 400px;
    max-width: calc(100vw - 20px);
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    background: var(--bg-card, #1a1a24);
    border: 1px solid var(--border, #2a2a3a);
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    z-index: 999;
    padding: 20px;
}

.info-close {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: transparent;
    border: 1px solid var(--border, #2a2a3a);
    color: var(--text-secondary, #8888a0);
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
}

.info-close:hover {
    background: #ff4444;
    color: white;
    border-color: #ff4444;
}

.info-content {
    color: var(--text-primary, #e8e8f0);
}

.info-title {
    margin: 0 0 5px 0;
    font-size: 1.4em;
    color: var(--accent, #6366f1);
}

.info-author {
    margin: 0 0 10px 0;
    color: var(--text-secondary, #8888a0);
    font-size: 0.9em;
}

.info-origin {
    margin: 0 0 15px 0;
    color: var(--text-secondary, #8888a0);
    opacity: 0.7;
}

.info-section {
    margin-bottom: 20px;
}

.info-section h3 {
    margin: 0 0 10px 0;
    font-size: 1em;
    color: var(--text-primary, #e8e8f0);
    text-transform: uppercase;
    letter-spacing: 1px;
    border-bottom: 1px solid var(--border, #2a2a3a);
    padding-bottom: 5px;
}

.info-section p {
    margin: 0;
    line-height: 1.5;
    color: var(--text-secondary, #8888a0);
}

.info-controls-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85em;
}

.info-controls-table th,
.info-controls-table td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border, #2a2a3a);
}

.info-controls-table th {
    color: var(--text-secondary, #8888a0);
    font-weight: normal;
    text-transform: uppercase;
    font-size: 0.8em;
    letter-spacing: 1px;
}

.info-controls-table td {
    color: var(--text-primary, #e8e8f0);
}

.info-controls-table td:first-child {
    color: var(--accent, #6366f1);
}

.info-tips {
    margin: 0;
    padding-left: 20px;
}

.info-tips li {
    margin-bottom: 8px;
    color: var(--text-secondary, #8888a0);
    line-height: 1.4;
}

/* Mobile adjustments */
@media (max-width: 500px) {
    .info-panel {
        width: calc(100vw - 20px);
        right: 10px;
        left: 10px;
    }
}
`;

// Inject styles
function injectInfoPanelStyles() {
    if (document.getElementById('er301-info-styles')) return;
    const style = document.createElement('style');
    style.id = 'er301-info-styles';
    style.textContent = infoStyles;
    document.head.appendChild(style);
}

// Auto-inject styles when script loads
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectInfoPanelStyles);
    } else {
        injectInfoPanelStyles();
    }
}

// Static create method for simpler API
ER301InfoPanel.create = function(config) {
    const container = document.body;

    // Convert sections format to the class format
    const mappedConfig = {
        title: config.title || '',
        author: config.author || '',
        description: '',
        controls: [],
        tips: [],
        origin: config.origin || ''
    };

    // Build description from sections
    if (config.sections && config.sections.length > 0) {
        mappedConfig.description = config.sections.map(section => {
            return `<strong>${section.title}</strong><br>${section.content}`;
        }).join('<br><br>');
    }

    return new ER301InfoPanel(container, mappedConfig);
};

// Export for use in patches
if (typeof window !== 'undefined') {
    window.ER301InfoPanel = ER301InfoPanel;
}
