import { useEffect, useState } from "react";
import { api, type FoundFile, type VaultItem } from "../api";
import { download, fetchFile, pdfPreview } from "../files";
import { Button } from "./ui";

const isPdf = (f: { filename: string; mime?: string | null }) => /pdf/i.test(f.mime ?? "") || /\.pdf$/i.test(f.filename);
const isImage = (f: { mime?: string | null }) => /^image\//.test(f.mime ?? "");
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "");

/** A picture of the first page (PDF) or the image itself, drawn on this device; plus the file for Download/Share. */
function Preview({ id, f, small }: { id: string; f: FoundFile; small?: boolean }) {
  const [img, setImg] = useState(""), [pages, setPages] = useState(0), [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    fetchFile(`/api/files/${id}`).then(async (b) => {
      if (!live) return;
      if (isPdf(f)) { const p = await pdfPreview(b, 1, small ? 200 : 340); if (live) { setImg(p.image); setPages(p.pages); } }
      else if (isImage(f) || /^image\//.test(b.type)) setImg(URL.createObjectURL(b));
    }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [id]);
  if (error) return <p className="text-xs text-danger">{error}</p>;
  if (!img) return isPdf(f) || isImage(f) ? <div className={`${small ? "h-24 w-[200px]" : "h-40 max-w-[340px]"} rounded-lg bg-sunken grid place-items-center text-xs text-muted`}>Loading…</div> : null;
  return <div><img src={img} alt={`Preview of ${f.filename}`} className={`${small ? "max-w-[200px]" : "w-full max-w-[340px]"} rounded-lg border border-line bg-white`} />{pages > 1 && <p className="text-[11px] text-muted mt-0.5">{pages} pages</p>}</div>;
}

async function getBlob(f: FoundFile) { return fetchFile(`/api/files/${f.id}`); }
async function share(f: FoundFile) {
  const b = await getBlob(f);
  const file = new File([b], f.filename, { type: b.type || f.mime || "application/octet-stream" });
  if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: f.filename }).catch(() => {});
  else download(b, f.filename);
}

function SignPanel({ f, onDone }: { f: FoundFile; onDone: () => void }) {
  const [sigs, setSigs] = useState<VaultItem[]>([]), [chosen, setChosen] = useState<string[]>([]), [pos, setPos] = useState("bottom-right"), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  useEffect(() => { api.vault().then((v) => { const s = v.filter((x) => x.kind === "signature"); setSigs(s); if (s.length === 1) setChosen([s[0].id]); }).catch(() => {}); }, []);
  const go = async () => {
    setBusy(true); setMsg("");
    try { const r = await api.signFileNow(f.id, { signatures: chosen, position: pos }); if (r.file_id) onDone(); else setMsg(r.clarification ?? "Couldn't sign it."); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  if (!sigs.length) return <p className="text-sm">No signatures saved yet. Add them under <a href="/?tab=details" className="text-accent">My details</a>.</p>;
  return (
    <div className="rounded-xl bg-surface p-3 space-y-2 text-sm">
      {sigs.map((s) => (
        <label key={s.id} className="flex items-center gap-2">
          <input type="checkbox" checked={chosen.includes(s.id)} onChange={(e) => setChosen((c) => e.target.checked ? [...c, s.id] : c.filter((x) => x !== s.id))} />
          {s.image && <img src={s.image} alt="" className="h-6 bg-white rounded" />}{s.label}
        </label>
      ))}
      <div className="flex flex-wrap gap-1.5">{[["bottom-left", "Bottom left"], ["bottom-center", "Bottom middle"], ["bottom-right", "Bottom right"]].map(([k, l]) => (
        <button key={k} onClick={() => setPos(k)} className={`rounded-full px-3 py-1 text-xs ${pos === k ? "bg-ink text-bg" : "bg-sunken"}`}>{l}</button>))}</div>
      <Button onClick={() => void go()} disabled={busy || !chosen.length}>{busy ? "Signing…" : "Sign every page"}</Button>
      {msg && <p className="text-sm text-danger">{msg}</p>}
    </div>
  );
}

/** The file to work on: preview and the action you asked for (fill / sign), with the other one beside it. */
function WorkCard({ f, onChanged }: { f: FoundFile; onChanged: () => void }) {
  const [signing, setSigning] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const fill = async () => {
    setBusy(true); setMsg("");
    try { const r = await api.fillFile(f.id); if (r.file_id) onChanged(); else setMsg(r.clarification ?? "Couldn't fill it."); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const fillBtn = <Button key="fill" variant={f.purpose === "fill" ? "primary" : "soft"} onClick={() => void fill()} disabled={busy}>{busy ? "Filling…" : "📝 Fill out this form"}</Button>;
  const signBtn = <Button key="sign" variant={f.purpose === "sign" ? "primary" : "soft"} onClick={() => setSigning((v) => !v)}>✍️ Sign every page</Button>;
  return (
    <div className="rounded-2xl bg-sunken p-3 space-y-2">
      <div>
        <p className="text-[15px] font-medium break-all">📎 {f.filename}</p>
        <p className="text-xs text-muted">{f.source === "upload" ? "You added this" : [f.sender, when(f.sent_at)].filter(Boolean).join(" · ")}</p>
      </div>
      <Preview id={f.id} f={f} />
      {isPdf(f) && <div className="flex flex-wrap gap-2">{f.purpose === "sign" ? [signBtn, fillBtn] : [fillBtn, signBtn]}</div>}
      {signing && <SignPanel f={f} onDone={() => { setSigning(false); onChanged(); }} />}
      {msg && <p className="text-sm">{msg}</p>}
      <div className="flex gap-3 text-xs"><button className="text-accent" onClick={async () => download(await getBlob(f), f.filename)}>Download</button><button className="text-accent" onClick={() => void share(f)}>Share</button></div>
    </div>
  );
}

/** A copy made for you (filled or signed): check it, then download, share, or sign it too. */
function ResultCard({ f, onChanged }: { f: FoundFile; onChanged: () => void }) {
  const [signing, setSigning] = useState(false);
  const signed = /\(signed\)/i.test(f.filename);
  return (
    <div className="rounded-2xl bg-ok/10 border border-ok/30 p-3 space-y-2">
      <p className="text-[15px] font-medium">{signed ? "✍️ Signed copy" : "📝 Filled copy"} · <span className="break-all">{f.filename}</span></p>
      {f.note && <p className="text-xs text-muted">{f.note}</p>}
      <Preview id={f.id} f={f} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={async () => download(await getBlob(f), f.filename)}>Download</Button>
        <Button variant="soft" onClick={() => void share(f)}>Share…</Button>
        {!signed && <Button variant="soft" onClick={() => setSigning((v) => !v)}>✍️ Sign it too</Button>}
      </div>
      {signing && <SignPanel f={f} onDone={() => { setSigning(false); onChanged(); }} />}
      <p className="text-[11px] text-muted">Nothing has been sent. The original is unchanged.</p>
    </div>
  );
}

/** Several files matched: "Which one is it?" — a short list; tap one to use it. */
function WhichOne({ files, onChanged }: { files: FoundFile[]; onChanged: () => void }) {
  const [peek, setPeek] = useState<string | null>(null), [busy, setBusy] = useState("");
  const pick = async (id: string) => { setBusy(id); try { await api.chooseFile(id); onChanged(); } finally { setBusy(""); } };
  return (
    <div className="rounded-2xl bg-sunken p-3 space-y-2">
      <p className="text-sm font-medium">📎 Which one is it?</p>
      {files.map((f) => (
        <div key={f.id} className="rounded-xl bg-surface p-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex-1 min-w-0"><span className="block text-sm font-medium break-all">{f.filename}</span><span className="block text-[11px] text-muted">{[f.sender, when(f.sent_at)].filter(Boolean).join(" · ")}</span></span>
            <button className="text-xs text-muted shrink-0" onClick={() => setPeek(peek === f.id ? null : f.id)}>{peek === f.id ? "Hide" : "Peek"}</button>
            <Button onClick={() => void pick(f.id)} disabled={!!busy}>{busy === f.id ? "…" : "This one"}</Button>
          </div>
          {peek === f.id && <Preview id={f.id} f={f} small />}
        </div>
      ))}
    </div>
  );
}

/** The files that belong under one chat message. */
export default function ChatFiles({ files, onChanged }: { files: FoundFile[]; onChanged: () => void }) {
  if (!files.length) return null;
  const batches = new Map<string, FoundFile[]>();
  for (const f of files) if (f.source === "email" && f.batch) batches.set(f.batch, [...(batches.get(f.batch) ?? []), f]);
  const shown: React.ReactNode[] = [];
  const seenBatch = new Set<string>();
  for (const f of files) {
    if (f.source === "made") { shown.push(<ResultCard key={f.id} f={f} onChanged={onChanged} />); continue; }
    if (f.source === "upload") { shown.push(<WorkCard key={f.id} f={f} onChanged={onChanged} />); continue; }
    const b = f.batch ? batches.get(f.batch)! : [f];
    const key = f.batch ?? f.id;
    if (seenBatch.has(key)) continue;
    seenBatch.add(key);
    const picked = b.find((x) => x.chosen === 1);
    if (picked) shown.push(<WorkCard key={picked.id} f={picked} onChanged={onChanged} />);
    else shown.push(<WhichOne key={key} files={b.filter((x) => x.chosen !== -1)} onChanged={onChanged} />);
  }
  return <div className="space-y-2 mt-2">{shown}</div>;
}
