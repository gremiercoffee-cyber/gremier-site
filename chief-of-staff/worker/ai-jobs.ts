import type { Env } from './env';
import { first, now, run, uid } from './db';

/** Only a human Approve tap executes these jobs. Models cannot supply an approval flag. */
export async function requestAiJob(env: Env, action: string, payload: Record<string, unknown>, description: string) {
  const encoded = JSON.stringify(payload);
  const existing = await first<{ id: string }>(env, "SELECT id FROM pending_actions WHERE action=? AND payload=? AND status='pending'", action, encoded);
  const id = existing?.id ?? uid();
  if (!existing) await run(env, 'INSERT INTO pending_actions (id,action,payload,description,created_at) VALUES (?,?,?,?,?)', id,action,encoded,description,now());
  return { id, status: 'pending_approval' as const, note: 'Not started. Review the AI job and approve it in Tasks & trackers or Today.' };
}
