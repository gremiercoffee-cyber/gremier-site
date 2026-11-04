import { useEffect, useState } from "react";
import { api, type GroupRow } from "../api";
import { Button, Empty } from "../components/ui";

const field = "w-full rounded-xl border border-line bg-bg px-3 py-2 text-[15px]";
/** Contact groups: who is in them, so you can search email and WhatsApp from a whole group. */
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
        Groups of people, e.g. "the rabbis" or "wholesale customers". Ask me things like "any emails from the rabbis this week?"
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
  const [add, setAdd] = useState({ name: "", email: "", phone: "" });
  const [showMembers, setShowMembers] = useState(g.members.length < 8);

  return (
    <div className="rounded-2xl bg-surface border border-accent/30 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 font-display text-[22px]">👥 {g.name}</p>
        <button className="text-sm text-muted" onClick={onClose}>Close</button>
      </div>


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
