import { useEffect, useState } from "react";
import type { BrainDump as Dump } from "../../shared/types";
import { api } from "../api";
import { Button, Card, DictateButton, timeAgo } from "../components/ui";

const DRAFT_KEY = "cos.dumpDraft";

export default function BrainDump({ serverTranscription, onDataChanged }: { serverTranscription: boolean; onDataChanged: () => void }) {
  const [text, setText] = useState(() => { try { return localStorage.getItem(DRAFT_KEY) ?? ""; } catch { return ""; } });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ summary: string; actions: { summary: string }[] } | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Dump[]>([]);

  useEffect(() => { api.brainDumps().then(setHistory).catch(() => {}); }, [result]);
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, text); } catch { /* ignore */ } }, [text]);

  const submit = async () => {
    setBusy(true); setError(""); setResult(null);
    try {
      const r = await api.brainDump(text);
      setResult(r);
      setText("");
      onDataChanged();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[32px] leading-tight">Brain dump</h1>
        <p className="text-muted text-sm">Get it all out of your head. I'll sort it into tasks, reminders, commitments, waiting-fors and ideas.</p>
      </header>
      <div className="rounded-2xl bg-surface border border-line p-3">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9}
          placeholder={"Call the accountant about Q3… need to order more beans by Friday… Sam owes me the logo files… idea: subscription boxes…"}
          className="w-full resize-y bg-transparent outline-none text-[15px] leading-relaxed p-1" />
        <div className="flex items-center justify-between gap-2 pt-2">
          <DictateButton serverTranscription={serverTranscription} onText={(t) => setText((v) => (v ? v + "\n" : "") + t)} />
          <Button onClick={submit} disabled={!text.trim() || busy}>{busy ? "Sorting…" : "Sort it out"}</Button>
        </div>
      </div>
      {error && <p className="text-danger text-sm">{error}</p>}
      {result && (
        <Card title="Filed">
          <p className="text-[15px] mb-3">{result.summary}</p>
          <ul className="space-y-1.5">
            {result.actions.map((a, i) => <li key={i} className="text-sm flex gap-2"><span className="text-ok">✓</span>{a.summary}</li>)}
          </ul>
        </Card>
      )}
      {history.length > 0 && (
        <Card title="Recent dumps">
          <ul className="divide-y divide-line">
            {history.map((d) => (
              <li key={d.id} className="py-2.5">
                <p className="text-sm line-clamp-2">{d.raw}</p>
                <p className="text-xs text-muted mt-0.5">{timeAgo(d.created_at)} · {d.status === "processed" ? d.summary : d.status}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
