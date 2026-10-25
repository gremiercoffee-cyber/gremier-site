import {useState} from "react";
import type {Nudge} from "../../shared/types";

export default function NudgeActions({ n, onAct, onReply }: { n: Nudge; onAct: (n: Nudge, a: string) => Promise<void>; onReply?: () => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const actions=n.actions??[];
  const secondary=new Set(['ok','ignore','breakdown','delegate','reply_yes','reply_no','hold']);
  const primary=actions.filter(a=>!secondary.has(a.id)||actions.length===1);
  const more=actions.filter(a=>!primary.includes(a));
  const button=(a:typeof actions[number])=>(
    <button key={a.id} disabled={!!busy} onClick={async()=>{setBusy(a.id);setError('');try{await onAct(n,a.id);}catch(e){setError((e as Error).message);}finally{setBusy('');}}}
      className={`rounded-full border px-3 py-1.5 text-[13px] font-medium hover:border-accent disabled:opacity-50 transition ${a.id==='done'?'border-transparent bg-ok/15 text-ok':'border-line bg-bg'}`}>
      {busy===a.id?'…':a.title}
    </button>
  );
  return (
    <div className="flex flex-wrap gap-1.5 mt-2.5">
      {primary.map(button)}
      {more.length>0 && <details className="text-[13px]"><summary className="cursor-pointer px-3 py-1.5 text-muted">More…</summary>
        <div className="flex flex-wrap gap-1.5 mt-1">{more.map(button)}</div>
        {more.some(a=>a.id==='ok'||a.id==='ignore') && <p className="text-xs text-muted mt-2">Hide alert keeps work open.{more.some(a=>a.id==='ignore')?' Mute alerts keeps it on your list without reminders.':''}</p>}
      </details>}
      {n.item_id && actions.some(a=>a.id==='done') && <p className="basis-full text-xs text-muted">Done = finished · Later = choose a time · Not needed = remove from open tasks</p>}
      {actions.some(a=>a.id==='clear_note') && <p className="basis-full text-xs text-muted">This note repeats with the time block until you remove it.</p>}
      {error && <p role="alert" className="basis-full text-sm text-danger">{error}</p>}
      {onReply && !actions.some(a=>a.id==='reply') && (
        <button onClick={onReply} className="rounded-full px-3 py-1.5 text-[13px] text-muted hover:text-ink">Reply</button>
      )}
    </div>
  );
}

