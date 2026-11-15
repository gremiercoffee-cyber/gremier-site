import { useEffect, useState } from 'react';
import type { InboxDecision, InboxReview as Review } from '../../shared/inbox-review';
import { api } from '../api';
import { Button } from '../components/ui';

export default function InboxReview({onChanged}: {onChanged: () => void}) {
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    api.inboxReview().then(setReview).catch(error => setError(error.message));
  }, []);
  async function decide(id: string, decision: InboxDecision) {
    if (busy) return;
    setBusy(id);
    setError('');
    setNotice('');
    try {
      await api.decideInboxEntry(id, decision);
      setReview(current => current && {...current, entries: current.entries.filter(entry => entry.id !== id)});
      setNotice(decision === 'today' ? 'Added to today.' : decision === 'later' ? 'Set aside for today.' : 'Removed from review.');
      if (decision === 'today') onChanged();
    } catch (error) {
      setError((error as Error).message);
      if ((error as {status?: number}).status === 409) await api.inboxReview().then(setReview).catch(() => {});
    } finally {
      setBusy(null);
    }
  }
  return <section className="mx-auto max-w-2xl space-y-3 py-4">
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
    {!review && !error && <p role="status">Loading review…</p>}
    {review && !review.day && <p className="text-muted">Your first review will be ready after the 6 a.m. check.</p>}
    {review?.day && <p className="text-sm text-muted">{new Date(review.day + 'T12:00:00Z').toLocaleDateString(undefined, {dateStyle:'medium'})}</p>}
    {review?.coverage.map(line => <p key={line} className="text-sm text-muted">{line}</p>)}
    {review?.day && !review.entries.length && <p className="text-muted">Nothing left to review.</p>}
    {review?.entries.map(entry => <article key={entry.id} className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs text-muted" dir="auto">{entry.source === 'gmail' ? 'Email' : 'WhatsApp'} · {entry.sender} · {entry.account}</p>
      <h2 className="font-semibold" dir="auto">{entry.title}</h2>
      <p className="line-clamp-4 whitespace-pre-line text-sm text-muted" dir="auto">{entry.excerpt}</p>
      {entry.link && <a className="inline-block text-sm underline" href={entry.link} target="_blank" rel="noreferrer">Open in Gmail</a>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!!busy} onClick={() => void decide(entry.id, 'today')}>Add to today</Button>
        <Button variant="soft" disabled={!!busy} onClick={() => void decide(entry.id, 'later')}>Not today</Button>
        <Button variant="ghost" disabled={!!busy} onClick={() => void decide(entry.id, 'dismiss')}>No action</Button>
      </div>
    </article>)}
  </section>;
}
