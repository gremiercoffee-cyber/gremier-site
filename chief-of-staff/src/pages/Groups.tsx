import {GroupMessage} from '../components/GroupMessage';
import { useEffect, useState } from "react";
import { api, type BroadcastRow, type GroupRow } from "../api";
import { Button, Empty } from "../components/ui";

const field = "w-full rounded-xl border border-line bg-bg px-3 py-2 text-[15px]";
/** Contact groups you can message all at once: email goes out from your Gmail, WhatsApp is preloaded. */
export default function Groups({ onAsk, refreshKey }: { onAsk: (t: string) => void; refreshKey: number }) {
  const [list, setList] = useState<GroupRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const load = () => api.groups().then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [refreshKey]);
  if (!list) return <p className="text-sm text-muted mt-4">Loading…</p>;

  return (
    <div className="space-y-3 mt-4">
      <p className="text-sm text-muted px-1">
        Groups you message all at once, e.g. "the rabbis" or "wholesale customers". Write the message here or just ask me
        ("tell the rabbis the meeting moved to Thursday"). Email goes to everyone from your Gmail; WhatsApp opens with the same text ready to send.
      </p>
      <div className="flex gap-2">
        <input className={field} placeholder="New group name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button disabled={!name.trim()} onClick={async () => { const g = await api.saveGroup({ name: name.trim() }); setName(""); setOpen(g.id); load(); }}>Create</Button>
      </div>
      {list.length === 0 && <Empty>No groups yet.</Empty>}
      {list.map((g) => open === g.id
        ? <GroupDetail key={g.id} g={g} onClose={() => setOpen(null)} onChanged={load} onAsk={onAsk} />
        : (
          <button key={g.id} onClick={() => setOpen(g.id)} className="w-full text-left rounded-2xl bg-surface border border-line px-4 py-3">
            <p className="text-[16px] font-medium">👥 {g.name}</p>
            <p className="text-xs text-muted mt-0.5">
              {g.members.length} people · {g.members.filter((m) => m.email).length} with email · {g.members.filter((m) => m.phone).length} with WhatsApp
              {g.description ? ` · ${g.description}` : ""}
            </p>
          </button>
        ))}
    </div>
  );
}

function GroupDetail({ g, onClose, onChanged, onAsk }: { g: GroupRow; onClose: () => void; onChanged: () => void; onAsk: (t: string) => void }) {
  const [msgs, setMsgs] = useState<BroadcastRow[]>([]);
  const [add, setAdd] = useState({ name: "", email: "", phone: "" });
  const [draft, setDraft] = useState({ subject: "", body: "" });
  const [showMembers, setShowMembers] = useState(g.members.length < 8);
  const loadMsgs = () => api.groupMessages(g.id).then(setMsgs).catch(() => {});
  useEffect(() => { loadMsgs(); }, [g.id]);

  return (
    <div className="rounded-2xl bg-surface border border-accent/30 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 font-display text-[22px]">👥 {g.name}</p>
        <button className="text-sm text-muted" onClick={onClose}>Close</button>
      </div>

      {/* New message */}
      <section className="space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">New message</p>
        <input className={field} placeholder="Subject (for email)" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} dir="auto" />
        <textarea className={field} rows={5} placeholder={"Hi {first_name},\n\n…"} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} dir="auto" />
        <p className="text-xs text-muted">{"{first_name}"} becomes each person's first name.</p>
        <div className="flex gap-2">
          <Button disabled={!draft.body.trim()} onClick={async () => { await api.draftGroupMessage({ group: g.id, ...draft }); setDraft({ subject: "", body: "" }); loadMsgs(); }}>Save draft</Button>
          <Button variant="soft" onClick={() => onAsk(`Write a message to the "${g.name}" group: `)}>Have me write it</Button>
        </div>
      </section>

      {msgs.filter(b=>!b.archived_at&&b.status!=='sent').map(b=><GroupMessage key={b.id} b={b} g={g} onChanged={loadMsgs}/>)}
      <details className="rounded-xl border border-line p-3"><summary className="cursor-pointer text-sm">Archive ({msgs.filter(b=>b.archived_at||b.status==='sent').length})</summary><div className="space-y-3 mt-3">{msgs.filter(b=>b.archived_at||b.status==='sent').sort((a,b)=>(b.archived_at??b.sent_at??b.created_at).localeCompare(a.archived_at??a.sent_at??a.created_at)).map(b=><GroupMessage key={b.id} b={b} g={g} onChanged={loadMsgs}/>)}</div></details>

      {/* Members */}
      <section>
        <button className="text-[12px] font-semibold uppercase tracking-wider text-muted" onClick={() => setShowMembers((v) => !v)}>
          {showMembers ? "▾" : "▸"} People ({g.members.length})
        </button>
        {showMembers && (
          <div className="mt-2 space-y-2">
            <ul className="divide-y divide-line">
              {g.members.map((m) => (
                <li key={m.id} className="py-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px]">{m.name}</p>
                    <p className="text-xs text-muted truncate">{[m.email, m.phone].filter(Boolean).join(" · ") || "No email or phone yet"}</p>
                  </div>
                  <button className="text-muted px-1" aria-label="Remove" onClick={async () => { await api.saveGroup({ id: g.id, remove: [m.id] }); onChanged(); }}>✕</button>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-1 gap-2">
              <input className={field} placeholder="Name" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
              <div className="flex gap-2">
                <input className={field} placeholder="Email" type="email" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} />
                <input className={field} placeholder="Phone" type="tel" value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} />
              </div>
              <Button variant="soft" disabled={!add.name.trim() && !add.email.trim()} onClick={async () => {
                await api.saveGroup({ id: g.id, add: [add] }); setAdd({ name: "", email: "", phone: "" }); onChanged();
              }}>+ Add person</Button>
            </div>
          </div>
        )}
      </section>

      <div className="flex gap-2 pt-1">
        <Button variant="ghost" onClick={() => onAsk(`Add to my "${g.name}" group: `)}>Add people by talking</Button>
        <Button variant="ghost" onClick={async () => { if (window.confirm(`Delete the group "${g.name}"? (The people stay in your contacts.)`)) { await api.deleteGroup(g.id); onChanged(); onClose(); } }}>Delete group</Button>
      </div>
    </div>
  );
}
