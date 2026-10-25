/**
 * Page zoom for the whole app ("see more on one page"). Uses CSS zoom on the app root, so everything
 * (text, buttons, spacing) shrinks or grows together while the layout still fills the screen.
 * The choice is remembered on this device.
 */
const KEY = "cos.zoom";
/** The steps the − and + buttons walk through. */
export const ZOOM_STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

export function getZoom(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v >= 0.5 && v <= 2 ? v : 1;
  } catch { return 1; }
}

export function applyZoom(z: number) {
  const root = document.getElementById("root");
  if (root) (root.style as CSSStyleDeclaration & { zoom: string }).zoom = z === 1 ? "" : String(z);
}

export function setZoom(z: number) {
  try { localStorage.setItem(KEY, String(z)); } catch { /* not remembered, still applied */ }
  applyZoom(z);
}
