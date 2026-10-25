import { useEffect, useState } from 'react';
import type { RecurringReminder } from '../../shared/reminders';
import { api } from '../api';
import { Button, Card } from './ui';

export default function RecurringReminders({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [rules,setRules] = useState<RecurringReminder[]>([]);
  const [editing,setEditing] = useState<RecurringReminder | null>(null);
  const [days,setDays] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const load = () => api.recurringReminders().then(setRules).catch(e => setError(e.message));
  useEffect(() => { void load(); },[refreshKey]);
  const save = async (input: Partial<RecurringReminder>) => {
    setBusy(true);setError('');
    try { await api.saveRecurringReminder(input);setEditing(null);await load();onChanged(); }
    catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <Card title="Repeating reminders">
    <p className="text-sm text-muted mb-3">Fixed reminders and links. No AI job or per-run AI charge. Done stops the remaining reminders for that month.</p>
    {error && <p className="text-danger text-sm" role="alert">{error}</p>}
    {rules.map(r => <div key={r.id} className="py-3 border-t border-line">
      <div className="font-medium">{r.title}</div><p className="text-sm text-muted">{r.active ? `Each month: ${r.days.join(', ')} at ${r.time} · ${r.timezone}` : 'Paused'}</p>
      {r.link && <a href={r.link} target="_blank" rel="noreferrer" className="text-accent underline text-sm inline-block py-2">Open form ↗</a>}
      <div className="flex gap-2"><Button variant="ghost" onClick={() => {setEditing({...r});setDays(r.days.join(', '));}}>Edit schedule</Button><Button disabled={busy} variant="soft" onClick={() => void save({id:r.id,active:r.active ? 0 : 1})}>{r.active ? 'Pause' : 'Resume'}</Button></div>
    </div>)}
    {!rules.length && <p className="text-muted text-sm">Ask for a monthly reminder and the dates you need.</p>}
    {editing && <form className="mt-3 space-y-2" onSubmit={e => {e.preventDefault();void save({...editing,days:days.split(',').map(d=>Number(d.trim()))});}}>
      <label className="block text-sm">Reminder<input className="w-full border border-line rounded-xl p-2 bg-bg" value={editing.title} onChange={e=>setEditing({...editing,title:e.target.value})} /></label>
      <label className="block text-sm">Days of each month<input className="w-full border border-line rounded-xl p-2 bg-bg" value={days} onChange={e=>setDays(e.target.value)} placeholder="16, 17, 18" /></label>
      <label className="block text-sm">Time<input type="time" className="w-full border border-line rounded-xl p-2 bg-bg" value={editing.time} onChange={e=>setEditing({...editing,time:e.target.value})} /></label>
      <label className="block text-sm">Link<input type="url" className="w-full border border-line rounded-xl p-2 bg-bg" value={editing.link} onChange={e=>setEditing({...editing,link:e.target.value})} /></label>
      <div className="flex gap-2"><Button type="submit" disabled={busy}>Save reminder</Button><Button variant="ghost" onClick={()=>setEditing(null)}>Cancel</Button></div>
    </form>}
  </Card>;
}
