// Microphone audio for Talk: the conversion from the browser's sample rate to what the live model expects. Kept apart from live-talk.ts so it has no browser or app imports and can be checked on its own.

/** The rate the live model expects: 16-bit little-endian PCM at 16 kHz. */
const OUT_RATE = 16000;
/** Samples per message to the API: 40 ms. The worklet hands over 128 samples at a time, which would be hundreds of tiny frames a second; the model and the socket both do better with steady 40 ms chunks, and 40 ms adds no delay anyone can hear. */
const CHUNK = 640;

/**
 * Turns the microphone's samples (usually 48 kHz, sometimes 44.1 kHz) into
 * 16 kHz PCM for the model.
 *
 * Two things a one-line resample gets wrong, and both cost transcription accuracy:
 *  - Aliasing. Picking every third sample folds the high frequencies of "s",
 *    "f" and "th" back into the speech band. Each output sample is instead the
 *    average of the input samples it covers, a box filter, which removes most
 *    of that before it can fold.
 *  - Drift. Resampling each 128-sample block on its own drops the fraction of
 *    a sample left at the end of every block (at 44.1 kHz, about one sample in
 *    a hundred), so speech plays slightly fast and pitched up. The position is
 *    carried from block to block here, so nothing is dropped.
 */
export function createResampler(inRate: number, onChunk: (pcm: ArrayBuffer) => void) {
  const ratio = inRate / OUT_RATE;
  let carry: Float32Array = new Float32Array(0);
  let pos = 0;
  let out = new Int16Array(CHUNK);
  let filled = 0;
  return (samples: Float32Array) => {
    const data = new Float32Array(carry.length + samples.length);
    data.set(carry);
    data.set(samples, carry.length);
    while (pos + ratio <= data.length) {
      const from = Math.floor(pos);
      const to = Math.max(from + 1, Math.floor(pos + ratio));
      let sum = 0;
      for (let j = from; j < to; j++) sum += data[j];
      const v = Math.max(-1, Math.min(1, sum / (to - from)));
      out[filled++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (filled === CHUNK) {
        onChunk(out.buffer);
        out = new Int16Array(CHUNK);
        filled = 0;
      }
      pos += ratio;
    }
    // Keep what the next output sample still needs, and move the position to match.
    const keep = Math.floor(pos);
    carry = data.slice(keep);
    pos -= keep;
  };
}
