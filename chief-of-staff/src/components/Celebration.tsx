import { useEffect, useRef } from "react";

const COLORS = ["#3b45a8", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#a855f7", "#f472b6", "#facc15"];

interface Piece { x: number; y: number; vx: number; vy: number; r: number; vr: number; s: number; c: string; round: boolean; life: number }

/** A little party for a finished project: confetti bursts and a "Good job" card. Tap anywhere to close. */
export default function Celebration({ name, done, onClose }: { name: string; done: number; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const close = setTimeout(onClose, 7000);
    return () => clearTimeout(close);
  }, [onClose]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // the card still shows
    const dpr = window.devicePixelRatio || 1;
    const w = (canvas.width = Math.round(window.innerWidth * dpr));
    const h = (canvas.height = Math.round(window.innerHeight * dpr));
    const pieces: Piece[] = [];
    const burst = (cx: number, cy: number, n: number, spread: number) => {
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * spread;
        const v = (9 + Math.random() * 17) * dpr;
        pieces.push({
          x: cx * w, y: cy * h, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.35,
          s: (6 + Math.random() * 7) * dpr, c: COLORS[Math.floor(Math.random() * COLORS.length)], round: Math.random() < 0.3, life: 0,
        });
      }
    };
    burst(0.5, 0.62, 110, 2.4);
    const t1 = setTimeout(() => burst(0.12, 0.8, 70, 1.3), 260);
    const t2 = setTimeout(() => burst(0.88, 0.8, 70, 1.3), 460);
    const t3 = setTimeout(() => burst(0.5, 0.55, 80, 2.8), 900);

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of pieces) {
        p.vy += 0.5 * dpr; p.vx *= 0.988; p.vy *= 0.988;
        p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
        const fade = p.life > 150 ? Math.max(0, 1 - (p.life - 150) / 50) : 1;
        if (fade <= 0 || p.y > h + 40) continue;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, 6.28); ctx.fill(); } else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-6 bg-black/25" onClick={onClose} role="dialog" aria-label="Project finished">
      <canvas ref={ref} className="absolute inset-0 h-full w-full pointer-events-none" />
      <div className="relative max-w-xs rounded-3xl bg-surface border border-line shadow-card px-7 py-6 text-center" style={{ animation: "pop-in .5s ease-out" }}>
        <div className="text-5xl">🎉</div>
        <p className="font-display text-[28px] leading-tight mt-2">Project done!</p>
        <p className="text-[17px] font-medium mt-1">Good job, you did it.</p>
        <p className="text-sm text-muted mt-2">{name} · all {done} finished</p>
        <button onClick={onClose} className="mt-4 rounded-full bg-accent text-accent-ink px-6 py-2 text-sm font-medium">Thanks!</button>
      </div>
    </div>
  );
}
