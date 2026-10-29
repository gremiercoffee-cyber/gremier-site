// Reads the text of a FinBot PDF (each font's ToUnicode map), to find the document number:
// FinBot's API returns only a link, and a store's קבלה must name its invoice's number.
async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}
const latin1 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return s; };

export async function pdfLines(buf: Uint8Array): Promise<string[]> {
  const s = latin1(buf), objs = new Map<string, { dict: string; stream: Uint8Array | null }>();
  const re = /(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const body = m[2], at = body.search(/stream\r?\n/);
    let stream: Uint8Array | null = null;
    if (at >= 0) {
      const start = m.index + m[0].indexOf(body) + at + body.slice(at).match(/stream\r?\n/)![0].length, end = s.indexOf('endstream', start);
      let e = end; while (e > start && (buf[e - 1] === 10 || buf[e - 1] === 13)) e--;   // the line break before endstream isn't data
      const raw = buf.subarray(start, e);
      stream = /FlateDecode/.test(body.slice(0, at)) ? await inflate(raw) : raw;
    }
    objs.set(m[1], { dict: at >= 0 ? body.slice(0, at) : body, stream });
  }
  const deref = (t: string) => { const r = String(t || '').match(/^\s*(\d+)\s+0\s+R/); return r ? objs.get(r[1])?.dict || '' : t; };
  const cmap = (id: string) => {
    const st = objs.get(id)?.stream, map = new Map<number, string>();
    if (!st) return { map, width: 1 };
    const t = latin1(st);
    for (const b of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
      for (const p of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g))
        map.set(parseInt(p[1], 16), String.fromCodePoint(...(p[2].match(/.{4}/g) || []).map((h) => parseInt(h, 16))));
    for (const b of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
      for (const p of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16), u = parseInt(p[3], 16);
        for (let c = lo; c <= hi && c - lo < 5000; c++) map.set(c, String.fromCodePoint(u + c - lo));
      }
    return { map, width: ((t.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/) || [, '00'])[1] as string).length / 2 };
  };
  const lines: string[] = [];
  for (const [, o] of objs) {
    if (!/\/Type\s*\/Page\b/.test(o.dict)) continue;
    const resM = o.dict.match(/\/Resources\s*(\d+\s+0\s+R|<<[\s\S]*?>>\s*>>)/), res = resM ? deref(resM[1]) : '';
    const fontM = res.match(/\/Font\s*(\d+\s+0\s+R|<<[\s\S]*?>>)/), fontDict = fontM ? deref(fontM[1]) : '';
    const fonts: Record<string, { map: Map<number, string>; width: number } | null> = {};
    for (const f of fontDict.matchAll(/\/([\w.+-]+)\s+(\d+)\s+0\s+R/g)) {
      const tu = (objs.get(f[2])?.dict || '').match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
      fonts[f[1]] = tu ? cmap(tu[1]) : null;
    }
    const contents = [...String(o.dict.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+0\s+R)/)?.[1] || '').matchAll(/(\d+)\s+0\s+R/g)]
      .map((r) => objs.get(r[1])?.stream).filter(Boolean) as Uint8Array[];
    for (const c of contents) {
      const t = latin1(c);
      let font: { map: Map<number, string>; width: number } | null = null, line = '';
      const dec = (hex: string) => { if (!font) return ''; let out = ''; const w = font.width * 2; for (let i = 0; i < hex.length; i += w) out += font.map.get(parseInt(hex.slice(i, i + w), 16)) ?? ''; return out; };
      const tok = /\/([\w.+-]+)\s+[\d.]+\s+Tf|<([0-9a-fA-F]*)>\s*Tj|\[([^\]]*)\]\s*TJ|([-\d.]+)\s+([-\d.]+)\s+Td|(?:[-\d.]+\s+){5}([-\d.]+)\s+Tm|\bET\b/g;
      let k: RegExpExecArray | null;
      while ((k = tok.exec(t))) {
        if (k[1]) font = fonts[k[1]] ?? null;
        else if (k[2] !== undefined) line += dec(k[2]);
        else if (k[3] !== undefined) for (const h of k[3].matchAll(/<([0-9a-fA-F]*)>/g)) line += dec(h[1]);
        else if (k[5] !== undefined) { if (Math.abs(Number(k[5])) > 0.5) { lines.push(line); line = ''; } }
        else { if (line) lines.push(line); line = ''; }
      }
      if (line) lines.push(line);
    }
  }
  return lines.map((l) => l.trim()).filter(Boolean);
}

// The number printed next to the document's title ("חשבונית מס / 20301"). Hebrew may come out
// in visual (reversed) order, so both directions are checked. Null when it can't be found for sure.
export function documentNumber(lines: string[], title: string): string | null {
  const rev = [...title].reverse().join('');
  const found = new Set<string>();
  lines.forEach((l, i) => {
    if (!l.includes(title) && !l.includes(rev)) return;
    // On the title line itself, else just before it (FinBot's layout), else just after.
    const inline = l.match(/\b(\d{3,9})\b/)?.[1];
    const near = [lines[i - 1], lines[i + 1]].find((x) => /^\d{3,9}$/.test(x || ''));
    if (inline || near) found.add((inline || near)!);
  });
  return found.size === 1 ? [...found][0] : null;
}
// Whether the PDF shows this amount (e.g. "10,173.37" or "10173.37").
export function showsAmount(lines: string[], minor: number): boolean {
  const plain = (minor / 100).toFixed(2), grouped = Number(plain).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return lines.some((l) => l.includes(plain) || l.includes(grouped));
}
