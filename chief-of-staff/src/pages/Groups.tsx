import { useEffect, useState } from "react";
import { api, type BroadcastRow, type GroupMember, type GroupRow } from "../api";
import { Button, Empty, timeAgo } from "../components/ui";

const field = "w-full rounded-xl border border-line bg-bg px-3 py-2 text-[15px]";
/** "Avi Levi" → "Avi"; titled names ("Rabbi Weiss", "Dr. Cohen") stay whole. */
const firstName = (name: string) => (/^(rabbi|rav|harav|reb|mr|mrs|ms|dr|prof)\.?\s/i.test(name) ? name : name.split(/\s+/)[0] ?? name);
const personalize = (t: string, name: string) => t.replace(/\{first_name\}/gi, firstName(name)).replace(/\{name\}/gi, name);
/** Israeli 05x… → 9725x…; strips everything but digits. */
const waNumber = (phone: string) => { const d = phone.replace(/\D/g, ""); return d.startsWith("0") ? `972${d.slice(1)}` : d; };
const waLink = (text: string, phone?: string | null) => `https://wa.me/${phone ? waNumber(phone) : ""}?text=${encodeURIComponent(text)}`;
const plain = (b: BroadcastRow) => b.body.replace(/\s*\{(first_name|name)\}/gi, "");

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
          <Button disabled={!draft.body.trim()} onClick={async () => { await api.draftGroupMessage({ group: g.id, ...draft }); setDraft({ subject: "", body: "" }); loadMsgs(); }}>Save message</Button>
          <Button variant="soft" onClick={() => onAsk(`Write a message to the "${g.name}" group: `)}>Have me write it</Button>
        </div>
      </section>

      {msgs.map((b) => <Message key={b.id} b={b} g={g} onChanged={loadMsgs} />)}

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

function Message({ b, g, onChanged }: { b: BroadcastRow; g: GroupRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [wa, setWa] = useState(false);
  const emails = g.members.filter((m) => m.email);
  const phones = g.members.filter((m) => m.phone);
  const results = (() => { try { return JSON.parse(b.results) as { name: string; ok: boolean; error?: string }[]; } catch { return []; } })();
  const waText = (m?: GroupMember) => `${b.subject ? `*${b.subject}*\n\n` : ""}${m ? personalize(b.body, m.name) : plain(b)}`;

  return (
    <section className="rounded-xl bg-sunken p-3 space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-muted">
        {b.status === "sent" ? `Sent ${timeAgo(b.sent_at!)} · ${results.filter((r) => r.ok).length}/${results.length} emails` : b.status === "sending" ? "Sending…" : "Ready to send"}
      </p>
      {b.subject && <p className="font-medium" dir="auto">{b.subject}</p>}
      <p className="text-[14px] whitespace-pre-wrap" dir="auto">{b.body}</p>

      <div className="flex flex-wrap gap-2 pt-1">
        {b.status === "draft" && (
          <Button disabled={busy || !emails.length} onClick={async () => {
            if (!window.confirm(`Send this email to ${emails.length} ${emails.length === 1 ? "person" : "people"} in "${g.name}" from your Gmail?`)) return;
            setBusy(true);
            try {
              const r = await api.sendGroupMessage(b.id);
              setResult(`Sent to ${r.sent} of ${r.total}.${r.skipped.length ? ` Not sent: ${r.skipped.map((s) => `${s.name} (${s.error})`).join(", ")}` : ""}`);
            } catch (e) { setResult((e as Error).message); }
            setBusy(false); onChanged();
          }}>{busy ? "Sending…" : `✉️ Send email to ${emails.length}`}</Button>
        )}
        <a href={waLink(waText())} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-full bg-[#25D366] text-white px-4 py-2 text-sm font-medium">
          WhatsApp — pick chat
        </a>
        {phones.length > 0 && <Button variant="soft" onClick={() => setWa((v) => !v)}>{wa ? "Hide" : `WhatsApp each (${phones.length})`}</Button>}
        {b.status === "draft" && <Button variant="ghost" onClick={async () => { await api.deleteGroupMessage(b.id); onChanged(); }}>Delete</Button>}
      </div>
      {!emails.length && b.status === "draft" && <p className="text-xs text-muted">No one in this group has an email yet. Add emails below, or use WhatsApp.</p>}
      {result && <p className="text-sm">{result}</p>}

      {wa && (
        <ul className="divide-y divide-line">
          {phones.map((m) => (
            <li key={m.id} className="py-1.5 flex items-center gap-2">
              <span className="flex-1 text-sm">{m.name}</span>
              <a href={waLink(waText(m), m.phone)} target="_blank" rel="noreferrer" className="text-sm font-medium text-[#128C7E]">Open WhatsApp →</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
