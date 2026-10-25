import { useEffect, useRef, useState } from "react";
import { ZOOM_STEPS, getZoom, setZoom } from "../zoom";

/** A magnifier button in the header: opens − / + to zoom the whole app out (see more) or in (bigger). */
export default function ZoomControl() {
  const [open, setOpen] = useState(false);
  const [z, setZ] = useState(getZoom);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const idx = Math.max(0, ZOOM_STEPS.findIndex((s) => s >= z - 0.001));
  const go = (i: number) => { const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i))]; setZ(next); setZoom(next); };
  const btn = "h-11 w-11 rounded-full bg-sunken text-[22px] font-medium leading-none disabled:opacity-30 active:bg-line";

  return (
    <div ref={box} className="relative w-11 shrink-0">
      <button onClick={() => setOpen((v) => !v)} aria-label="Zoom" aria-expanded={open}
        className={`p-2.5 rounded-xl hover:bg-sunken ${z !== 1 ? "text-accent" : "text-ink"}`}>
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5M8.5 11h5M11 8.5v5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-56 rounded-2xl bg-surface border border-line shadow-card p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted mb-2">Zoom</p>
          <div className="flex items-center justify-between gap-2">
            <button className={btn} onClick={() => go(idx - 1)} disabled={idx <= 0} aria-label="Zoom out">−</button>
            <span className="text-[17px] font-semibold tabular-nums">{Math.round(z * 100)}%</span>
            <button className={btn} onClick={() => go(idx + 1)} disabled={idx >= ZOOM_STEPS.length - 1} aria-label="Zoom in">+</button>
          </div>
          <button onClick={() => go(ZOOM_STEPS.indexOf(1))} disabled={z === 1} className="mt-2 w-full rounded-full py-2 text-sm text-muted disabled:opacity-40">Reset to 100%</button>
        </div>
      )}
    </div>
  );
}
