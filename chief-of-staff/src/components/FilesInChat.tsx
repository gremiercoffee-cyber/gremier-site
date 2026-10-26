import { useEffect, useState } from "react";
import { api, type FoundFile, type SignedFile, type VaultItem } from "../api";
import { download, fetchFile, pdfPreview } from "../files";
import { Button } from "./ui";

const isPdf = (f: { filename: string; mime?: string | null }) => /pdf/i.test(f.mime ?? "") || /\.pdf$/i.test(f.filename);

/** A picture of the file's first page (PDFs) or the image itself, made on this device. */
function Preview({ path, pdf, label }: { path: string; pdf: boolean; label: string }) {
  const [img, setImg] = useState(""), [pages, setPages] = useState(0), [error, setError] = useState(""), [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let live = true;
    fetchFile(path).then(async (b) => {
      if (!live) return; setBlob(b);
      if (pdf) { const p = await pdfPreview(b); if (live) { setImg(p.image); setPages(p.pages); } }
      else if (/^image\//.test(b.type)) setImg(URL.createObjectURL(b));
    }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [path, pdf]);
  return (
    <div className="space-y-2">
      {error ? <p className="text-xs text-danger">{error}</p> : img ? <img src={img} alt={`Preview of ${label}`} className="w-full max-w-[360px] rounded-lg border border-line bg-white" />
        : <div className="h-40 max-w-[360px] rounded-lg bg-sunken grid place-items-center text-xs text-muted">Loading preview…</div>}
      {pages > 0 && <p className="text-xs text-muted">{pages} page{pages > 1 ? "s" : ""}</p>}
      {blob && <Button variant="soft" onClick={() => download(blob, label)}>Download</Button>}
    </div>
  );
}

function FileCard({ f, sigs, onSigned }: { f: FoundFile; sigs: VaultItem[]; onSigned: () => void }) {
  const [signing, setSigning] = useState(false), [chosen, setChosen] = useState<string[]>([]), [position, setPosition] = useState("bottom-right"), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  useEffect(() => { if (sigs.length === 1) setChosen([sigs[0].id]); }, [sigs]);
  const sign = async () => {
    setBusy(true); setMsg("");
    try { const r = await api.signFile({ file_id: f.id, signatures: chosen, position }); if (r.clarification) setMsg(r.clarification); else { setSigning(false); onSigned(); } }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-2xl bg-sunken p-4 space-y-3">
      <div>
        <p className="text-[15px] font-medium break-all">📎 {f.filename}</p>
        <p className="text-xs text-muted">{[f.sender, f.sent_at && new Date(f.sent_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }), f.size && `${Math.round(f.size / 1024)} KB`].filter(Boolean).join(" · ")}</p>
        {f.subject && <p className="text-xs text-muted truncate">“{f.subject}”</p>}
      </div>
      <Preview path={`/api/files/${f.id}`} pdf={isPdf(f)} label={f.filename} />
      {isPdf(f) && (!signing ? <Button onClick={() => setSigning(true)}>✍️ Sign every page…</Button> : (
        <div className="rounded-xl bg-surface p-3 space-y-2 text-sm">
          {!sigs.length ? <p>No signatures saved yet. Add them under <a href="/?tab=details" className="text-accent">My details</a>.</p> : <>
            <p className="font-medium">Which signatures?</p>
            {sigs.map((s) => (
              <label key={s.id} className="flex items-center gap-2">
                <input type="checkbox" checked={chosen.includes(s.id)} onChange={(e) => setChosen((c) => e.target.checked ? [...c, s.id] : c.filter((x) => x !== s.id))} />
                {s.image && <img src={s.image} alt="" className="h-6 bg-white rounded" />}{s.label}
              </label>
            ))}
            <p className="font-medium pt-1">Where on each page?</p>
            <div className="flex flex-wrap gap-1.5">{[["bottom-left", "Bottom left"], ["bottom-center", "Bottom middle"], ["bottom-right", "Bottom right"]].map(([k, l]) => (
              <button key={k} onClick={() => setPosition(k)} className={`rounded-full px-3 py-1 text-xs ${position === k ? "bg-ink text-bg" : "bg-sunken"}`}>{l}</button>))}</div>
            <div className="flex gap-2 pt-1"><Button onClick={() => void sign()} disabled={busy || !chosen.length}>{busy ? "Signing…" : "Make the signed copy"}</Button><Button variant="ghost" onClick={() => setSigning(false)}>Cancel</Button></div>
          </>}
          {msg && <p className="text-sm text-danger">{msg}</p>}
        </div>
      ))}
    </div>
  );
}

/**
 * Files the assistant found in this chat, and the signed copies made from them: preview, download, sign.
 * Nothing is sent anywhere; the signed copy is a new file for you to download and check.
 */
export default function FilesInChat({ since, refreshKey }: { since: string; refreshKey: number }) {
  const [data, setData] = useState<{ files: FoundFile[]; signed: SignedFile[] } | null>(null);
  const [sigs, setSigs] = useState<VaultItem[]>([]);
  const load = () => api.files(since).then(setData).catch(() => {});
  useEffect(() => { void load(); api.vault().then((v) => setSigs(v.filter((x) => x.kind === "signature"))).catch(() => {}); }, [since, refreshKey]);
  if (!data || (!data.files.length && !data.signed.length)) return null;
  return (
    <div className="space-y-3 mt-4">
      {data.signed.map((s) => (
        <div key={s.id} className="rounded-2xl bg-ok/10 border border-ok/30 p-4 space-y-2">
          <p className="text-[15px] font-medium">✍️ Signed copy: {s.filename}</p>
          <p className="text-xs text-muted">Check it, then download. The original in your email is unchanged.</p>
          <Preview path={`/api/signed/${s.id}`} pdf label={s.filename.replace(/\.pdf$/i, "") + " (signed).pdf"} />
        </div>
      ))}
      {data.files.map((f) => <FileCard key={f.id} f={f} sigs={sigs} onSigned={load} />)}
    </div>
  );
}
