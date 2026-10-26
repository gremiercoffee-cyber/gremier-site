import { useEffect, useRef, useState } from "react";
import { api, type VaultItem } from "../api";
import { Button, Card } from "../components/ui";
import { cropSignature } from "../files";

/**
 * My details: things saved once that the assistant uses when you ask ("put my signature on it", "fill in my
 * business address"). Signatures: take a photo or screenshot; it's cropped and made see-through automatically.
 */
export default function MyDetails() {
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [error, setError] = useState("");
  const load = () => api.vault().then(setItems).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const sigs = (items ?? []).filter((i) => i.kind === "signature"), texts = (items ?? []).filter((i) => i.kind === "text");
  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-[32px] leading-tight">My details</h1>
        <p className="text-sm text-muted mt-1">Saved once, used whenever you ask: “sign the mortgage papers”, “fill in my business details”. Only you and your assistant see these.</p>
      </header>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Card title="Signatures">
        <div className="space-y-3">
          {sigs.map((s) => <SignatureRow key={s.id} item={s} onChanged={load} />)}
          {!sigs.length && <p className="text-sm text-muted">None yet. Add yours (and your wife's) below.</p>}
          <AddSignature onSaved={load} suggest={sigs.length ? "Wife's signature" : "My signature"} />
        </div>
      </Card>
      <Card title="Details">
        <div className="space-y-3">
          {texts.map((t) => <TextRow key={t.id} item={t} onChanged={load} />)}
          {!texts.length && <p className="text-sm text-muted">Addresses, business number, ID numbers… You can also just tell the assistant “save my business address: …”.</p>}
          <TextRow onChanged={load} />
        </div>
      </Card>
    </div>
  );
}

function AddSignature({ onSaved, suggest }: { onSaved: () => void; suggest: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(""), [label, setLabel] = useState(suggest), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => setLabel(suggest), [suggest]);
  const pick = async (f?: File) => {
    if (!f) return; setError("");
    try { setPreview(await cropSignature(f)); } catch (e) { setError((e as Error).message); }
  };
  const save = async () => {
    setBusy(true); setError("");
    try { await api.saveVault({ kind: "signature", label, image: preview }); setPreview(""); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-2xl border border-dashed border-line p-3 space-y-2">
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {!preview ? (
        <Button variant="soft" onClick={() => input.current?.click()}>+ Add a signature (photo or screenshot)</Button>
      ) : (
        <>
          <p className="text-xs text-muted">Cropped and made see-through. This is how it will look on a page:</p>
          <div className="rounded-xl bg-white border border-line p-3 grid place-items-center"><img src={preview} alt="Signature preview" className="max-h-24" /></div>
          <input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Name for this signature" className="w-full rounded-xl bg-sunken px-3 py-2 text-sm" />
          <div className="flex gap-2"><Button onClick={() => void save()} disabled={busy || !label.trim()}>{busy ? "Saving…" : "Save"}</Button><Button variant="ghost" onClick={() => input.current?.click()}>Try another picture</Button><Button variant="ghost" onClick={() => setPreview("")}>Cancel</Button></div>
        </>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function SignatureRow({ item, onChanged }: { item: VaultItem; onChanged: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-14 w-36 shrink-0 rounded-lg bg-white border border-line grid place-items-center">{item.image && <img src={item.image} alt={item.label} className="max-h-12 max-w-32" />}</div>
      <span className="flex-1 min-w-0 text-[15px] font-medium truncate">{item.label}</span>
      <Button variant="ghost" onClick={async () => { if (confirm(`Delete “${item.label}”?`)) { await api.deleteVault(item.id); onChanged(); } }}>Delete</Button>
    </div>
  );
}

/** One detail (label + value), editable in place; without an item it's the "add" row. */
function TextRow({ item, onChanged }: { item?: VaultItem; onChanged: () => void }) {
  const [label, setLabel] = useState(item?.label ?? ""), [text, setText] = useState(item?.text ?? ""), [editing, setEditing] = useState(!item), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try { await api.saveVault({ id: item?.id, kind: "text", label, text }); if (!item) { setLabel(""); setText(""); } else setEditing(false); onChanged(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (!editing && item) return (
    <div className="flex items-start gap-3">
      <span className="flex-1 min-w-0"><span className="block text-xs text-muted">{item.label}</span><span className="block text-[15px] whitespace-pre-wrap" dir="auto">{item.text}</span></span>
      <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
      <Button variant="ghost" onClick={async () => { if (confirm(`Delete “${item.label}”?`)) { await api.deleteVault(item.id); onChanged(); } }}>Delete</Button>
    </div>
  );
  return (
    <div className="space-y-2 rounded-2xl bg-sunken/60 p-3">
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. Business address" className="w-full rounded-xl bg-surface px-3 py-2 text-sm" />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="The detail itself" rows={2} dir="auto" className="w-full rounded-xl bg-surface px-3 py-2 text-sm" />
      <div className="flex gap-2"><Button onClick={() => void save()} disabled={busy || !label.trim() || !text.trim()}>{item ? "Save" : "Add"}</Button>{item && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}</div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
