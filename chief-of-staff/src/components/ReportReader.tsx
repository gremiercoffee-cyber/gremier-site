import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Button, Markdown } from "./ui";

type Report = { id: string; name: string; started_at: string; summary: string | null; report: string | null; doc_link: string | null };

/** Plain sentences for reading aloud: no markdown symbols, no URLs, no source list. */
function speakable(md: string) {
  return md
    .split(/\n## Sources[\s\S]*$/i)[0]
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\[\d+\]/g, "")
    .replace(/[#*_`>|]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/** A report from a Task: read it, hear it read aloud (on the phone, free), or talk it through. */
export default function ReportReader({ id, autoBrief, onBrief, onClose }: {
  id: string; autoBrief?: boolean; onBrief: (r: Report) => void; onClose: () => void;
}) {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const stop = useRef(false);

  useEffect(() => {
    api.routineRun(id).then((x) => { setR(x); if (autoBrief) onBrief(x); }).catch((e) => setError(e.message));
    return () => { stop.current = true; speechSynthesis.cancel(); };
  }, [id]);

  const play = () => {
    if (!r?.report) return;
    stop.current = false;
    speechSynthesis.cancel();
    const parts = [r.name + ".", ...(r.summary ? [r.summary] : []), ...speakable(r.report)];
    const hebrew = /[֐-׿]/.test(r.report);
    const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith(hebrew ? "he" : "en"));
    let i = 0;
    const next = () => {
      if (stop.current || i >= parts.length) { setSpeaking(false); return; }
      const u = new SpeechSynthesisUtterance(parts[i++]);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? (hebrew ? "he-IL" : "en-US");
      u.rate = 1.03;
      u.onend = next;
      u.onerror = () => setSpeaking(false);
      speechSynthesis.speak(u);
    };
    setSpeaking(true);
    next();
  };
  const pause = () => { stop.current = true; speechSynthesis.cancel(); setSpeaking(false); };

  return (
    <div className="fixed inset-0 z-50 bg-bg flex flex-col">
      <header className="pt-safe px-2 flex items-center gap-1 h-14 shrink-0 border-b border-line/60">
        <button onClick={() => { pause(); onClose(); }} className="p-2.5 text-muted">✕</button>
        <p className="flex-1 truncate font-medium">{r?.name ?? "Report"}</p>
      </header>
      <main className="flex-1 overflow-y-auto px-5 py-4">
        {error && <p className="text-danger">{error}</p>}
        {!r && !error && <p className="text-muted">Loading…</p>}
        {r && (
          <>
            <p className="text-xs text-muted">{new Date(r.started_at).toLocaleString([], { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</p>
            {r.summary && <p className="mt-2 rounded-2xl bg-accent/10 px-4 py-3 text-[15px]">{r.summary}</p>}
            <div className="mt-4 text-[15px] leading-relaxed" dir="auto"><Markdown text={r.report ?? "(empty)"} /></div>
          </>
        )}
      </main>
      {r && (
        <footer className="pb-safe px-4 py-3 border-t border-line/60 flex flex-wrap gap-2 justify-center">
          {speaking ? <Button onClick={pause}>⏸ Stop reading</Button> : <Button onClick={play}>🔊 Read it to me</Button>}
          <Button variant="soft" onClick={() => { pause(); onBrief(r); }}>💬 Tell me about it</Button>
          {r.doc_link && <a href={r.doc_link} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-full bg-sunken px-4 py-2 text-sm font-medium">📄 Open Doc</a>}
        </footer>
      )}
    </div>
  );
}
