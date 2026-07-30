import { describe, it, expect } from 'vitest';
import { downsampleTo16k, concatFloat32, encodeWav, TARGET_SAMPLE_RATE } from './followAudioCapture';

describe('downsampleTo16k', () => {
  it('passes through when already at target rate', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(downsampleTo16k(input, TARGET_SAMPLE_RATE)).toBe(input);
  });

  it('halves the sample count from 32k to 16k', () => {
    const input = new Float32Array(1000).map((_, i) => Math.sin(i));
    const out = downsampleTo16k(input, 32000);
    expect(out.length).toBe(500);
  });

  it('produces ~1/3 length from 48k to 16k', () => {
    const input = new Float32Array(3000).fill(0.5);
    const out = downsampleTo16k(input, 48000);
    expect(out.length).toBe(1000);
    // A constant signal stays constant after linear interpolation.
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[500]).toBeCloseTo(0.5, 5);
  });

  it('never upsamples (safety floor)', () => {
    const input = new Float32Array([1, 2, 3]);
    expect(downsampleTo16k(input, 8000)).toBe(input);
  });
});

describe('concatFloat32', () => {
  it('joins chunks in order', () => {
    const out = concatFloat32([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5])]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns an empty buffer for no chunks', () => {
    expect(concatFloat32([]).length).toBe(0);
  });
});

describe('encodeWav', () => {
  it('writes a valid 16-bit mono WAV header', async () => {
    const pcm = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeWav(pcm, 16000);
    expect(blob.type).toBe('audio/wav');
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits
    expect(tag(36)).toBe('data');
    // 5 samples * 2 bytes = 10 bytes of data.
    expect(view.getUint32(40, true)).toBe(10);
    expect(buf.byteLength).toBe(44 + 10);
    // Full-scale samples clamp to the 16-bit extremes.
    expect(view.getInt16(44 + 3 * 2, true)).toBe(0x7fff);
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-0x8000);
  });
});
