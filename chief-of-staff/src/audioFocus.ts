/**
 * Pause the user's music while they talk to the app. Phones only hand "audio focus" to a page that is
 * actually playing something long, so we loop a few seconds of silence: the music app pauses (and,
 * because this is a long, non-transient hold, it doesn't jump back on by itself afterwards).
 */
let el: HTMLAudioElement | null = null;
let holders = 0;

function silentWav(seconds = 10, rate = 8000): string {
  const n = seconds * rate, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, "data"); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128); // 8-bit silence
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/** Take audio focus; call the returned function to let go. Safe to nest. */
export function holdAudioFocus(): () => void {
  try {
    el ??= Object.assign(new Audio(silentWav()), { loop: true });
    holders++;
    if (el.paused) void el.play().catch(() => {});
  } catch { return () => {}; }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (!holders && el) { el.pause(); el.currentTime = 0; }
  };
}
