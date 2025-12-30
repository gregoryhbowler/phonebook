/**
 * ER-301 Sample Manager
 * Handles loading, decoding, and managing audio samples for ER-301 web patches
 */

class ER301SampleManager {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.samples = new Map(); // name -> AudioBuffer
        this.samplePaths = [];    // Ordered list of sample paths
        this.loading = false;
        this.onProgress = null;
        this.onLoaded = null;
    }

    /**
     * Load samples from a folder path
     * @param {string} basePath - Base path to samples folder
     * @param {string[]} sampleNames - Array of sample filenames
     */
    async loadSamples(basePath, sampleNames) {
        this.loading = true;
        this.samplePaths = sampleNames;
        let loaded = 0;
        const total = sampleNames.length;

        for (const name of sampleNames) {
            try {
                const url = `${basePath}/${name}`;
                const response = await fetch(url);
                if (!response.ok) {
                    console.warn(`Failed to load sample: ${name}`);
                    continue;
                }
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                this.samples.set(name, audioBuffer);
                loaded++;

                if (this.onProgress) {
                    this.onProgress(loaded, total, name);
                }
            } catch (err) {
                console.warn(`Error loading sample ${name}:`, err);
            }
        }

        this.loading = false;
        if (this.onLoaded) {
            this.onLoaded(loaded, total);
        }
        return loaded;
    }

    /**
     * Load samples from file input
     * @param {FileList} files - Files from input element
     */
    async loadFromFiles(files) {
        this.loading = true;
        let loaded = 0;
        const total = files.length;

        for (const file of files) {
            if (!file.type.startsWith('audio/')) continue;

            try {
                const arrayBuffer = await file.arrayBuffer();
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                this.samples.set(file.name, audioBuffer);
                this.samplePaths.push(file.name);
                loaded++;

                if (this.onProgress) {
                    this.onProgress(loaded, total, file.name);
                }
            } catch (err) {
                console.warn(`Error loading file ${file.name}:`, err);
            }
        }

        this.loading = false;
        if (this.onLoaded) {
            this.onLoaded(loaded, total);
        }
        return loaded;
    }

    /**
     * Get sample by name
     * @param {string} name - Sample name
     * @returns {AudioBuffer|null}
     */
    getSample(name) {
        return this.samples.get(name) || null;
    }

    /**
     * Get sample by index
     * @param {number} index - Sample index
     * @returns {AudioBuffer|null}
     */
    getSampleByIndex(index) {
        const name = this.samplePaths[index];
        return name ? this.samples.get(name) : null;
    }

    /**
     * Get random sample
     * @returns {AudioBuffer|null}
     */
    getRandomSample() {
        if (this.samplePaths.length === 0) return null;
        const index = Math.floor(Math.random() * this.samplePaths.length);
        return this.getSampleByIndex(index);
    }

    /**
     * Get sample count
     * @returns {number}
     */
    get count() {
        return this.samples.size;
    }

    /**
     * Get all sample names
     * @returns {string[]}
     */
    get names() {
        return Array.from(this.samples.keys());
    }

    /**
     * Clear all samples
     */
    clear() {
        this.samples.clear();
        this.samplePaths = [];
    }

    /**
     * Get samples by category (based on filename patterns)
     * @param {string} category - Category name (kick, snare, hat, etc.)
     * @returns {AudioBuffer[]}
     */
    getSamplesByCategory(category) {
        const pattern = new RegExp(category, 'i');
        return this.samplePaths
            .filter(name => pattern.test(name))
            .map(name => this.samples.get(name))
            .filter(Boolean);
    }

    /**
     * Create sample picker UI
     * @param {HTMLElement} container - Container element
     * @param {Function} onSelect - Callback when sample selected
     */
    createPicker(container, onSelect) {
        const picker = document.createElement('div');
        picker.className = 'sample-picker';
        picker.innerHTML = `
            <div class="sample-picker-header">
                <span class="sample-count">${this.count} samples</span>
                <input type="file" id="sample-import" multiple accept="audio/*" style="display:none">
                <button class="import-btn" onclick="document.getElementById('sample-import').click()">Import</button>
            </div>
            <div class="sample-list"></div>
        `;

        const list = picker.querySelector('.sample-list');
        this.samplePaths.forEach((name, index) => {
            const item = document.createElement('div');
            item.className = 'sample-item';
            item.textContent = name;
            item.dataset.index = index;
            item.onclick = () => {
                if (onSelect) onSelect(index, name, this.getSampleByIndex(index));
                picker.querySelectorAll('.sample-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            };
            list.appendChild(item);
        });

        const importInput = picker.querySelector('#sample-import');
        importInput.onchange = async (e) => {
            await this.loadFromFiles(e.target.files);
            this.createPicker(container, onSelect); // Rebuild picker
        };

        container.innerHTML = '';
        container.appendChild(picker);
        return picker;
    }
}

/**
 * Sample Player Voice
 * Handles playback of a single sample with pitch and speed control
 */
class SampleVoice {
    constructor(audioContext, buffer) {
        this.audioContext = audioContext;
        this.buffer = buffer;
        this.source = null;
        this.gainNode = audioContext.createGain();
        this.playing = false;
    }

    /**
     * Play the sample
     * @param {number} speed - Playback speed (1.0 = normal)
     * @param {number} startOffset - Start position (0-1)
     * @param {boolean} loop - Whether to loop
     */
    play(speed = 1.0, startOffset = 0, loop = false) {
        if (this.source) {
            this.source.stop();
        }

        this.source = this.audioContext.createBufferSource();
        this.source.buffer = this.buffer;
        this.source.playbackRate.value = speed;
        this.source.loop = loop;
        this.source.connect(this.gainNode);

        const startTime = startOffset * this.buffer.duration;
        this.source.start(0, startTime);
        this.playing = true;

        this.source.onended = () => {
            this.playing = false;
        };
    }

    /**
     * Stop playback
     */
    stop() {
        if (this.source) {
            this.source.stop();
            this.playing = false;
        }
    }

    /**
     * Set gain
     * @param {number} value - Gain value (0-1)
     */
    setGain(value) {
        this.gainNode.gain.value = value;
    }

    /**
     * Connect output
     * @param {AudioNode} destination
     */
    connect(destination) {
        this.gainNode.connect(destination);
    }

    /**
     * Disconnect output
     */
    disconnect() {
        this.gainNode.disconnect();
    }
}

// Export for use in patches
if (typeof window !== 'undefined') {
    window.ER301SampleManager = ER301SampleManager;
    window.SampleVoice = SampleVoice;
}
