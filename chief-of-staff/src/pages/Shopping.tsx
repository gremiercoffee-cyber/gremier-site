import {useImmediateShopping} from '../useImmediateShopping';
import { useEffect, useState } from 'react';
import type { ShoppingConfig, ShoppingItem, ShoppingState } from '../../shared/shopping';
import { api } from '../api';
import { Button, Card } from '../components/ui';
import ShoppingChecklist from '../components/ShoppingChecklist';

export default function Shopping({ refreshKey }: { refreshKey: number }) {
  const [state, setState] = useState<ShoppingState | null>(null);
  const [selected, setSelected] = useState('store');
  const checks=useImmediateShopping(state?.lists.flatMap(l=>l.items)??[]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [newList, setNewList] = useState('');
  const [edit, setEdit] = useState<ShoppingItem | null>(null);
  const [config, setConfig] = useState<ShoppingConfig>({ enabled: false, chat: '', chat_id: '' });
  const [configDirty, setConfigDirty] = useState(false);
  const [chats, setChats] = useState<string[]>([]);
  const [configOpen, setConfigOpen] = useState(false);
  const load = async () => { const data = await api.shopping(); setState(data); };
  useEffect(() => {
    let active = true;
    const refresh = () => { setClock(Date.now()); return api.shopping().then(data => { if (active) { setState(data); if (!configDirty) setConfig(data.config); } }).catch(e => { if (active) setError(String(e.message)); }); };
    refresh();
    api.whatsappChats().then(setChats).catch(() => {});
    const timer = setInterval(refresh, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [refreshKey, configDirty]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const sourceList = state?.lists.find(l => l.id === selected) ?? state?.lists[0];
  const list = sourceList?{...sourceList,items:sourceList.items.map(i=>({...i,...checks.checks.get(i.id)}))}:undefined;
  const left = list?.items.filter(i => !i.checked).length ?? 0;
  const inputClass = 'w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink';
  return <div className="space-y-5 pt-3">
    <div className="flex items-start justify-between gap-3"><div><h1 className="text-2xl font-medium">Shopping lists</h1><p className="text-sm text-muted mt-1">What you need, whenever you’re ready.</p></div><Button variant="soft" onClick={() => setConfigOpen(!configOpen)}>WhatsApp setup</Button></div>
    {(error||checks.error) && <p role="alert" className="rounded-xl bg-sunken p-3 text-danger">{error||checks.error}</p>}
    {!state && !error && <p className="text-muted">Loading your lists…</p>}
    {configOpen && <Card title="Your wife’s WhatsApp chat">
      <p className="text-sm text-muted mb-4">Plain food lists and requests from either of you go straight to the main Store list. Only your personal one-to-one chat is watched. Keep WhatsApp Web open with the updated Chief of Staff add-on.</p>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); void act(async () => { setConfig(await api.saveShoppingConfig(config)); setConfigDirty(false); }); }}>
        <label className="block text-sm">Exact WhatsApp chat name<input list="shopping-wife-chats" value={config.chat} onChange={e => { setConfigDirty(true); setConfig({ ...config, chat: e.target.value, chat_id: '' }); }} className={`${inputClass} mt-1`} placeholder="Your wife’s name as shown in WhatsApp" /></label>
        <datalist id="shopping-wife-chats">{chats.map(c => <option key={c} value={c} />)}</datalist>
        <details><summary className="text-sm text-muted cursor-pointer">Use an exact WhatsApp chat ID</summary><label className="block text-sm mt-2">Chat ID<input value={config.chat_id} onChange={e => { setConfigDirty(true); setConfig({ ...config, chat_id: e.target.value }); }} className={`${inputClass} mt-1`} placeholder="972…@c.us" /></label></details>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.enabled} onChange={e => { setConfigDirty(true); setConfig({ ...config, enabled: e.target.checked }); }} />Automatically add shopping items from this chat</label><Button type="submit" disabled={busy}>Save WhatsApp setup</Button>
      </form>
    </Card>}
    {state && <>
      <div className="flex gap-2 flex-wrap" aria-label="Shopping lists">{state.lists.map(l => <button key={l.id} onClick={() => { setSelected(l.id); setEdit(null); }} aria-pressed={l.id === list?.id} className={`rounded-full px-4 py-2 text-sm ${l.id === list?.id ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted'}`}>{l.name}{l.id === 'store' && ' · main'}</button>)}</div>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void act(async () => { await api.saveShoppingList(newList); setNewList(''); }); }}><input aria-label="New list name" value={newList} onChange={e => setNewList(e.target.value)} className={inputClass} placeholder="Another shopping list…" maxLength={80} /><Button variant="soft" type="submit" disabled={busy || !newList.trim()}>Create list</Button></form>
      {list && <Card title={<span>{list.name} <span className="normal-case tracking-normal">· {left} left</span></span>} action={<div className="flex gap-1"><Button variant="ghost" disabled={busy} onClick={() => { const n = window.prompt('List name', list.name); if (n?.trim()) void act(() => api.saveShoppingList(n, list.id)); }}>Rename</Button>{list.id !== 'store' && <Button variant="danger" disabled={busy} onClick={() => { if (window.confirm(`Delete “${list.name}” and its items?`)) void act(async () => { await api.deleteShoppingList(list.id); setSelected('store'); }); }}>Delete</Button>}</div>}>
        <form className="flex gap-2 mb-5 flex-wrap" onSubmit={e => { e.preventDefault(); void act(async () => { await api.addShoppingItems(list.id, [{ name, quantity }]); setName(''); setQuantity(''); }); }}><input aria-label="Item name" value={name} onChange={e => setName(e.target.value)} placeholder="Add an item…" maxLength={160} className={`${inputClass} flex-1 min-w-40`} /><input aria-label="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="Quantity" maxLength={80} className="w-28 rounded-xl border border-line bg-surface px-3 py-2" /><Button type="submit" disabled={busy || !name.trim()}>Add</Button></form>
        {!list.items.length && <p className="text-muted py-6 text-center">Nothing on this list yet. Add an item here, or ask your Chief of Staff.</p>}
        <ShoppingChecklist key={list.id} items={list.items} at={clock} busy={busy} onEdit={setEdit} isPending={id=>!!checks.checks.get(id)?.pending} onToggle={(i,checked)=>void checks.toggle(i,checked,()=>api.updateShoppingItem(i.id,{checked}),()=>{void load().catch(e=>setError((e as Error).message));})}/>
      </Card>}
      <p className="text-xs text-muted">{state.config.enabled ? `WhatsApp watch is on for ${state.config.chat || state.config.chat_id}.` : 'WhatsApp watch is off. Choose your wife’s chat in WhatsApp setup.'}{state.pending > 0 && ` ${state.pending} message${state.pending === 1 ? '' : 's'} waiting to be checked.`}</p>
    </>}
    {edit && <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"><form role="dialog" aria-modal="true" aria-label="Edit shopping item" className="w-full max-w-md bg-surface rounded-2xl p-5 space-y-3" onSubmit={e => { e.preventDefault(); void act(async () => { await api.updateShoppingItem(edit.id, { name: edit.name, quantity: edit.quantity, notes: edit.notes }); setEdit(null); }); }}>
      <h2 className="text-lg font-medium">Edit item</h2><label className="block text-sm">Item<input autoFocus value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} className={`${inputClass} mt-1`} maxLength={160} /></label><label className="block text-sm">Quantity<input value={edit.quantity} onChange={e => setEdit({ ...edit, quantity: e.target.value })} className={`${inputClass} mt-1`} maxLength={80} /></label><label className="block text-sm">Notes<textarea value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} className={`${inputClass} mt-1`} maxLength={500} /></label>
      <div className="flex gap-2"><Button type="submit" disabled={busy || !edit.name.trim()}>Save</Button><Button variant="ghost" onClick={() => setEdit(null)} disabled={busy}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => { if (window.confirm(`Remove “${edit.name}”?`)) void act(async () => { await api.deleteShoppingItem(edit.id); setEdit(null); }); }}>Remove</Button></div>
    </form></div>}
  </div>;
}
