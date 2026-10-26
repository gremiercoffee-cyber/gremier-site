import { useEffect, useState } from "react";
import { api, type WaDraft } from "../api";
import { Button } from "./ui";

/**
 * "Send a WhatsApp to X, Y and Z": one row per person with a button that opens WhatsApp on that chat with the
 * message filled in. The user presses Send in WhatsApp; the row is ticked once opened.
 */
export default function WhatsAppsToSend({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<WaDraft[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const load = () => api.whatsapps().then(setRows).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, [refreshKey]);
  if (!rows.length) return error ? <p role="alert" className="text-sm text-danger mb-3">{error}</p> : null;

  const batches = [...new Set(rows.map((r) => r.batch_id))].map((id) => rows.filter((r) => r.batch_id === id));
  const link = (r: WaDraft) => `https://wa.me/${r.phone}?text=${encodeURIComponent(r.text)}`;
  const opened = (r: WaDraft) => {
    setRows((all) => all.map((x) => (x.id === r.id ? { ...x, opened_at: x.opened_at ?? new Date().toISOString() } : x)));
    void api.whatsappOpened(r.id).catch(() => {});
  };
  const clear = async (batch: string) => { setRows((all) => all.filter((x) => x.batch_id !== batch)); await api.whatsappBatchDone(batch).catch((e) => setError(e.message)); };
  const remove = async (r: WaDraft) => { setRows((all) => all.filter((x) => x.id !== r.id)); await api.whatsappDone(r.id).catch((e) => setError(e.message)); };
  const save = async (r: WaDraft) => {
    if (!text.trim()) return;
    await api.whatsappEdit(r.id, text).catch((e) => setError(e.message));
    setRows((all) => all.map((x) => (x.id === r.id ? { ...x, text } : x))); setEditing(null);
  };

  return (
    <section aria-label="WhatsApps to send" className="mb-5 space-y-3">
      <h2 className="text-[11px] font-medium text-muted uppercase tracking-[0.14em] px-1">📲 WhatsApps to send</h2>
      {batches.map((list) => {
        const done = list.filter((r) => r.opened_at).length;
        return (
          <div key={list[0].batch_id} className="rounded-[20px] bg-surface border border-line overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 pt-3">
              <p className="text-[15px] font-medium truncate">{list[0].batch_title || "WhatsApp messages"}</p>
              <span className="text-xs text-muted shrink-0">{done} of {list.length} opened</span>
            </div>
            <ul className="divide-y divide-line/70">
              {list.map((r) => (
                <li key={r.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-medium truncate">{r.opened_at ? "✓ " : ""}{r.name}</span>
                      <span className="block text-xs text-muted" dir="ltr">+{r.phone}</span>
                    </span>
                    <a href={link(r)} target="_blank" rel="noreferrer" onClick={() => opened(r)}
                      className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${r.opened_at ? "bg-sunken text-muted" : "bg-[#25D366] text-white"}`}>
                      {r.opened_at ? "Open again" : "WhatsApp"}
                    </a>
                  </div>
                  {editing === r.id ? (
                    <div className="space-y-2">
                      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} dir="auto" className="w-full rounded-xl bg-sunken p-3 text-sm" />
                      <div className="flex gap-2"><Button onClick={() => void save(r)} disabled={!text.trim()}>Save</Button><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
                    </div>
                  ) : (
                    <p className="text-sm text-ink/80 whitespace-pre-wrap line-clamp-3" dir="auto">{r.text}</p>
                  )}
                  {editing !== r.id && (
                    <div className="flex gap-3 text-xs">
                      <button className="text-accent" onClick={() => { setEditing(r.id); setText(r.text); }}>Edit message</button>
                      <button className="text-muted" onClick={() => void remove(r)}>Remove</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="px-4 pb-3">
              <Button variant={done === list.length ? "primary" : "ghost"} onClick={() => void clear(list[0].batch_id)}>
                {done === list.length ? "All sent — clear" : "Clear this list"}
              </Button>
            </div>
          </div>
        );
      })}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  );
}
