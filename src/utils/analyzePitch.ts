import { Frequency } from 'tone';

type ProgressCallback = (progress: number) => void;

export async function analyzePitch(
  blob: Blob,
  progressCallback?: ProgressCallback
): Promise<string[]> {
  const audioContext = new AudioContext();
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const notes: string[] = [];
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const windowSize = 4096;
  const stepSize = 1024;
  const totalWindows = Math.floor((channelData.length - windowSize) / stepSize);
  let processedWindows = 0;

  // Apply window function to reduce spectral leakage
  const applyWindowFunction = (buffer: Float32Array) => {
    const windowed = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const multiplier = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (buffer.length - 1)));
      windowed[i] = buffer[i] * multiplier;
    }
    return windowed;
  };

  for (let i = 0; i < channelData.length - windowSize; i += stepSize) {
    let segment = channelData.slice(i, i + windowSize);
    
    // Skip silent segments
    const rms = Math.sqrt(segment.reduce((sum, x) => sum + x * x, 0) / segment.length);
    if (rms < 0.01) {
      processedWindows++;
      if (progressCallback) progressCallback(processedWindows / totalWindows);
      continue;
    }

    segment = applyWindowFunction(segment);
    const pitch = autocorrelationPitchDetection(segment, sampleRate);

    if (pitch && pitch > 60 && pitch < 1000) {
      try {
        const midi = Frequency(pitch).toMidi();
        if (midi >= 48 && midi <= 84) {
          const note = Frequency(midi, 'midi').toNote();
          notes.push(note);
        }
      } catch (e) {
        console.warn('Failed to convert frequency to note:', e);
      }
    }

    processedWindows++;
    if (progressCallback) progressCallback(processedWindows / totalWindows);
  }

  return notes;
}

function autocorrelationPitchDetection(buf: Float32Array, sampleRate: number): number | null {
  // Normalize
  const normalized = new Float32Array(buf.length);
  let max = 0;
  for (let i = 0; i < buf.length; i++) {
    max = Math.max(max, Math.abs(buf[i]));
  }
  if (max === 0) return null;
  for (let i = 0; i < buf.length; i++) {
    normalized[i] = buf[i] / max;
  }

  // Autocorrelation
  const correlation = new Float32Array(buf.length / 2);
  for (let lag = 0; lag < correlation.length; lag++) {
    let sum = 0;
    for (let i = 0; i < buf.length - lag; i++) {
      sum += normalized[i] * normalized[i + lag];
    }
    correlation[lag] = sum;
  }

  // Find the first major peak after the zero-lag peak
  let peakIndex = 0;
  let maxCorrelation = -Infinity;
  const minLag = Math.floor(sampleRate / 1000);

  for (let i = minLag; i < correlation.length; i++) {
    if (correlation[i] > maxCorrelation) {
      maxCorrelation = correlation[i];
      peakIndex = i;
    }
  }

  // Parabolic interpolation for better peak estimation
  if (peakIndex > 0 && peakIndex < correlation.length - 1) {
    const alpha = correlation[peakIndex - 1];
    const beta = correlation[peakIndex];
    const gamma = correlation[peakIndex + 1];
    const offset = (alpha - gamma) / (2 * (alpha - 2 * beta + gamma));
    peakIndex += offset;
  }

  return peakIndex > 0 ? sampleRate / peakIndex : null;
}