import { useEffect, useRef } from "react";

export type OrbState = "connecting" | "listening" | "thinking" | "speaking" | "recording";

/**
 * The Chief of Staff orb, driven by real sound: a small pulse with your voice while listening,
 * a big one with its voice while it talks, a slow breath while thinking. `soft` is the gentler
 * version used for dictation.
 */
export default function LiveOrb({ state, levels, size = 112, soft = false }: {
  state: OrbState; levels: () => { input: number; output: number }; size?: number; soft?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      const { input, output } = levels();
      let scale = 1, shine = 0.35;
      if (state === "speaking") { scale = 1 + output * (soft ? 0.12 : 0.32); shine = 0.45 + output * 0.55; }
      else if (state === "listening" || state === "recording") { scale = 1 + input * (soft ? 0.06 : 0.1); shine = 0.35 + input * 0.3; }
      else if (state === "thinking") { scale = 1 + Math.sin(t / 450) * 0.025; shine = 0.4 + Math.sin(t / 450) * 0.1; }
      else scale = 0.92 + Math.sin(t / 700) * 0.015; // connecting: small and quiet
      if (ref.current) ref.current.style.transform = `scale(${scale.toFixed(3)})`;
      if (glow.current) {
        glow.current.style.opacity = shine.toFixed(2);
        glow.current.style.transform = `scale(${(1 + (scale - 1) * 1.8).toFixed(3)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, levels, soft]);

  return (
    <div className="relative grid place-items-center" style={{ width: size * 1.5, height: size * 1.5 }}>
      <div ref={glow} className="absolute rounded-full bg-accent blur-2xl" style={{ width: size, height: size, opacity: 0.35 }} />
      <div ref={ref} className={`relative rounded-full orb ${state === "thinking" ? "orb-think" : ""}`}
        style={{ width: size, height: size, animation: "none", transition: "transform 60ms linear" }}>
        <div className="absolute left-[22%] top-[16%] h-[30%] w-[38%] rounded-full bg-white/35 blur-md" />
      </div>
    </div>
  );
}
