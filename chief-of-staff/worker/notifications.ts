import {attentionState,actionableItem,actionableNotice,actionableNoticeItem} from './attention';
import type { Env } from "./env";
import type { Item } from "../shared/types";
import { all, first, now, run, uid } from "./db";

export interface NotificationOptions { topic?: string; itemIds?: string[] }
// An individual alert or an existing catch-up already holds this task for the user.
export const NOT_ALREADY_ALERTED = `NOT EXISTS (
  SELECT 1 FROM nudges n WHERE n.dismissed=0 AND n.pushed_at IS NOT NULL
    AND (n.item_id=i.id OR EXISTS (SELECT 1 FROM json_each(COALESCE(n.item_ids,'[]')) j WHERE j.value=i.id))
)`;
export function notificationTopic(type: string, title: string, itemId: string | null, topic?: string) {
  if (topic) return topic;
  if (itemId && type !== "briefing") return `item:${itemId}`;
  if (["briefing","digest","sweep","review","learn","customers"].includes(type)) return `summary:${type === "sweep" ? "digest" : type}`;
  // Unrelated events/questions of the same type must not overwrite one another.
  return `notice:${type}:${title.trim()}`;
}

/** Atomic upsert: concurrent cron passes keep the same ID and the same notification buttons. */
export async function recordNotification(env: Env, type: string, title: string, body: string, itemId: string | null, url: string, options: NotificationOptions = {}) {
  const stamp = now(), topic = notificationTopic(type,title,itemId,options.topic);
  const row = await first<{id:string; revision:number; pushed_at:string|null}>(env,
    `INSERT INTO nudges (id,type,title,body,item_id,created_at,updated_at,topic_key,target_url,item_ids)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(topic_key) WHERE dismissed = 0 AND topic_key IS NOT NULL DO UPDATE SET
        revision = nudges.revision + 1, type = excluded.type, title = excluded.title, body = excluded.body,
        item_id = excluded.item_id, updated_at = excluded.updated_at, target_url = excluded.target_url,
        item_ids = excluded.item_ids
      RETURNING id, revision, pushed_at`,
    uid(),type,title,body,itemId,stamp,stamp,topic,url,options.itemIds ? JSON.stringify([...new Set(options.itemIds)]) : null);
  if (!row) throw new Error("Could not record notification");
  return {...row, topic};
}

/** Status only; used by the signed-in app to clear stale phone notifications without removing tasks. */
export async function activeNotificationIds(env: Env, ids: string[]) {
  if (!ids.length) return [];
  await reconcileNotificationGroups(env);
  const attention=await attentionState(env);
  return (await all<any>(env,
    `SELECT n.* FROM nudges n LEFT JOIN items i ON i.id=n.item_id
      WHERE n.id IN (${ids.map(()=>"?").join(",")}) AND n.dismissed=0
        AND (i.id IS NULL OR (i.status='open' AND i.muted=0 AND (i.nudge_after IS NULL OR i.nudge_after <= ?)))
        AND (n.item_ids IS NULL OR json_array_length(n.item_ids)=0 OR EXISTS (
          SELECT 1 FROM json_each(n.item_ids) j JOIN items child ON child.id=j.value
            WHERE child.status='open' AND child.muted=0 AND (child.nudge_after IS NULL OR child.nudge_after <= ?)
        ))`, ...ids,now(),now())).filter(n=>actionableNotice(n,attention)).map(n=>n.id);
}

/** Each task belongs to one action card: a sent individual alert, otherwise the newest group. */
export async function reconcileNotificationGroups(env: Env) {
  const closed: string[] = [], updates: {id:string; title:string; body:string; revision:number}[] = [];
  const groups=await all<{id:string; type:string; title:string; body:string; item_ids:string; revision:number;topic_key:string|null}>(env,
    "SELECT id,type,title,body,item_ids,revision,topic_key FROM nudges WHERE dismissed=0 AND item_ids IS NOT NULL ORDER BY COALESCE(updated_at,created_at) DESC,created_at DESC,rowid DESC");
  if (!groups.length) return {closed,updates};
  const open=await all<{id:string; title:string; person:string|null; due_at:string|null}>(env,
    "SELECT id,title,person,due_at FROM items WHERE status='open' AND muted=0 AND (nudge_after IS NULL OR nudge_after<=?)",now());
  const attention=await attentionState(env);
  const items=new Map(open.map(i=>[i.id,i]));
  const direct=await all<{item_id:string}>(env,
    "SELECT n.item_id FROM nudges n JOIN items i ON i.id=n.item_id WHERE n.dismissed=0 AND n.pushed_at IS NOT NULL AND i.status='open'");
  const covered=new Set(direct.map(n=>n.item_id));
  for (const group of groups) {
    let ids:string[];
    try { const parsed:unknown=JSON.parse(group.item_ids); if(!Array.isArray(parsed))continue; ids=parsed.filter((v):v is string=>typeof v==='string'); } catch {continue;}
    const remaining=[...new Set(ids)].filter(id=>items.has(id) && actionableNoticeItem(attention.items.get(id)!,group as any,attention) && !covered.has(id)
      && !(group.type==='wrapup' && items.get(id)!.due_at && items.get(id)!.due_at!>now()));
    remaining.forEach(id=>covered.add(id));
    const block=group.type==='situation' && group.topic_key?.startsWith('block:') ? attention.blocks.get(group.topic_key.slice(6)) : undefined;
    const notes=group.body.split("\n").filter(line=>line.startsWith("📝") && (!group.topic_key?.startsWith('block:') || !!block?.note && line===`📝 ${block.note}`));
    if (JSON.stringify(remaining)===JSON.stringify(ids) && notes.length===group.body.split('\n').filter(line=>line.startsWith('📝')).length) continue;
    if (!remaining.length && !notes.length) {
      await run(env,"UPDATE nudges SET dismissed=1 WHERE id=?",group.id);closed.push(group.id);continue;
    }
    const body=[...notes,...remaining.map(id=>`• ${items.get(id)!.title}`)].join("\n");
    const title=group.title.replace(/\d+ things?( for now)?/,`${remaining.length} thing${remaining.length===1?'':'s'}$1`);
    await run(env,"UPDATE nudges SET item_ids=?,title=?,body=?,revision=revision+1 WHERE id=?",
      remaining.length ? JSON.stringify(remaining) : null,title,body,group.id);
    updates.push({id:group.id,title,body,revision:group.revision+1});
  }
  return {closed,updates};
}

/** A refreshed catch-up retains unresolved earlier entries; it must never replace them with just the new ones. */
export async function mergeCatchupItems(env: Env, fresh: Item[]) {
  const previous = await first<{item_ids:string|null}>(env,
    "SELECT item_ids FROM nudges WHERE topic_key='summary:digest' AND dismissed=0");
  let carried: string[] = [];
  try { const parsed: unknown=JSON.parse(previous?.item_ids || "[]"); if(Array.isArray(parsed)) carried=parsed.filter((v):v is string=>typeof v==="string"); } catch { /* legacy record */ }
  const ids=[...new Set([...carried,...fresh.map(i=>i.id)])];
  if (!ids.length) return [];
  const attention=await attentionState(env);
  return (await all<Item>(env,`SELECT i.* FROM items i WHERE i.id IN (${ids.map(()=>"?").join(",")})
    AND i.status='open' AND i.muted=0 AND (i.nudge_after IS NULL OR i.nudge_after <= ?)
    AND NOT EXISTS (SELECT 1 FROM nudges direct WHERE direct.item_id=i.id AND direct.dismissed=0 AND direct.pushed_at IS NOT NULL)
    ORDER BY i.created_at`, ...ids,now())).filter(i=>actionableItem(i,attention.blocks,attention.tz,attention.at));
}
