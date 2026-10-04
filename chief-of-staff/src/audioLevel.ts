/** Live loudness (0..1) of a media stream, for the pulsing orb. Runs on the device; costs nothing. */
let ctx: AudioContext | null = null;

export interface Meter { level: () => number; close: () => void }

export function meter(stream: MediaStream): Meter {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0.6;
    src.connect(an); // analyser only: nothing is played back through it
    const buf = new Uint8Array(an.fftSize);
    let smooth = 0;
    return {
      level: () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
        const rms = Math.sqrt(sum / buf.length);
        // Speech sits around 0.02–0.2 RMS: stretch it to 0..1, then ease so it doesn't jitter.
        const target = Math.min(1, rms * 6);
        smooth += (target - smooth) * (target > smooth ? 0.5 : 0.15);
        return smooth;
      },
      close: () => { try { src.disconnect(); } catch { /* already gone */ } },
    };
  } catch {
    return { level: () => 0, close: () => {} };
  }
}
