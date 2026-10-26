/**
 * Browser-side helpers for My details and files: crop a signature photo, preview PDFs, download files.
 * Everything here runs on the device (no AI, no cost).
 */
import { getToken } from "./api";

/**
 * A photo or screenshot of a signature → a tight, transparent PNG: finds the ink, crops to it with a little
 * margin, and turns the paper/background see-through so it sits cleanly on any document.
 */
export async function cropSignature(file: Blob): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h);
  const lum = (i: number) => 0.299 * px.data[i] + 0.587 * px.data[i + 1] + 0.114 * px.data[i + 2];
  // The background is the typical brightness; ink is clearly darker than it.
  let sum = 0; for (let i = 0; i < px.data.length; i += 16) sum += lum(i);
  const bg = sum / (px.data.length / 16), cut = Math.min(bg - 45, 170);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (lum(i) < cut) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new Error("I couldn't find a signature in that picture. Try a photo of the signature on white paper.");
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04) + 4;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const outScale = Math.min(1, 700 / cw);
  const o = document.createElement("canvas"); o.width = Math.round(cw * outScale); o.height = Math.round(ch * outScale);
  const og = o.getContext("2d", { willReadFrequently: true })!;
  og.drawImage(c, x0, y0, cw, ch, 0, 0, o.width, o.height);
  const d = og.getImageData(0, 0, o.width, o.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const l = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
    // Paper → transparent; ink keeps its colour, darkened slightly so it prints clearly.
    const a = Math.max(0, Math.min(255, ((cut + 25 - l) / (cut + 25)) * 255 * 1.6));
    d.data[i + 3] = a; d.data[i] *= 0.6; d.data[i + 1] *= 0.6; d.data[i + 2] *= 0.6;
  }
  og.putImageData(d, 0, 0);
  return o.toDataURL("image/png");
}

/** Fetch an authenticated file from the app's server. */
export async function fetchFile(path: string): Promise<Blob> {
  const r = await fetch(path, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Couldn't open the file (${r.status}).`);
  return r.blob();
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A picture of one page of a PDF (first by default), plus the page count. */
export async function pdfPreview(blob: Blob, pageNo = 1, width = 360): Promise<{ image: string; pages: number }> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const c = document.createElement("canvas"); c.width = viewport.width; c.height = viewport.height;
  await page.render({ canvasContext: c.getContext("2d")!, viewport }).promise;
  return { image: c.toDataURL("image/jpeg", 0.85), pages: doc.numPages };
}
