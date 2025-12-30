// ============================================================================
// WAV ENCODER
// Encode PCM audio data to WAV format
// ============================================================================

class WavEncoder {
  /**
   * Encode Float32 samples to WAV blob
   * @param {Float32Array[]} channels - Array of channel data [left, right] or [mono]
   * @param {number} sampleRate - Sample rate (e.g., 48000)
   * @param {number} bitDepth - Bit depth (16 or 32)
   * @returns {Blob} WAV file blob
   */
  static encode(channels, sampleRate, bitDepth = 16) {
    const numChannels = channels.length;
    const numSamples = channels[0].length;

    // Interleave channels
    let interleaved;
    if (numChannels === 1) {
      interleaved = channels[0];
    } else {
      interleaved = new Float32Array(numSamples * numChannels);
      for (let i = 0; i < numSamples; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
          interleaved[i * numChannels + ch] = channels[ch][i];
        }
      }
    }

    // Convert to target bit depth
    let dataView;
    let bytesPerSample;

    if (bitDepth === 16) {
      bytesPerSample = 2;
      const buffer = new ArrayBuffer(interleaved.length * bytesPerSample);
      dataView = new DataView(buffer);

      for (let i = 0; i < interleaved.length; i++) {
        // Clamp to [-1, 1] and convert to 16-bit
        const sample = Math.max(-1, Math.min(1, interleaved[i]));
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        dataView.setInt16(i * 2, int16, true);
      }
    } else {
      // 32-bit float
      bytesPerSample = 4;
      const buffer = new ArrayBuffer(interleaved.length * bytesPerSample);
      dataView = new DataView(buffer);

      for (let i = 0; i < interleaved.length; i++) {
        dataView.setFloat32(i * 4, interleaved[i], true);
      }
    }

    // Build WAV header
    const dataSize = interleaved.length * bytesPerSample;
    const headerSize = 44;
    const wavBuffer = new ArrayBuffer(headerSize + dataSize);
    const wavView = new DataView(wavBuffer);

    const audioFormat = bitDepth === 32 ? 3 : 1; // 3 = IEEE float, 1 = PCM
    const byteRate = sampleRate * numChannels * bytesPerSample;
    const blockAlign = numChannels * bytesPerSample;

    // RIFF chunk descriptor
    this._writeString(wavView, 0, 'RIFF');
    wavView.setUint32(4, 36 + dataSize, true); // File size - 8
    this._writeString(wavView, 8, 'WAVE');

    // fmt sub-chunk
    this._writeString(wavView, 12, 'fmt ');
    wavView.setUint32(16, 16, true);           // Subchunk1Size (16 for PCM)
    wavView.setUint16(20, audioFormat, true);  // AudioFormat
    wavView.setUint16(22, numChannels, true);  // NumChannels
    wavView.setUint32(24, sampleRate, true);   // SampleRate
    wavView.setUint32(28, byteRate, true);     // ByteRate
    wavView.setUint16(32, blockAlign, true);   // BlockAlign
    wavView.setUint16(34, bitDepth, true);     // BitsPerSample

    // data sub-chunk
    this._writeString(wavView, 36, 'data');
    wavView.setUint32(40, dataSize, true);     // Subchunk2Size

    // Copy audio data
    const wavBytes = new Uint8Array(wavBuffer);
    const dataBytes = new Uint8Array(dataView.buffer);
    wavBytes.set(dataBytes, 44);

    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  static _writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}

// Export
if (typeof window !== 'undefined') {
  window.WavEncoder = WavEncoder;
}

export { WavEncoder };
