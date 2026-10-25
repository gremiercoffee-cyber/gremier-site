/**
 * Web Push sender (RFC 8291 aes128gcm payload encryption + RFC 8292 VAPID), WebCrypto only.
 * VAPID_PUBLIC_KEY is the raw P-256 public key (base64url); VAPID_PRIVATE_JWK is the private key as a JWK.
 */
import type { Env } from "./env";
import type {Nudge} from '../shared/types';
import {attentionState,actionableNotice} from './attention';
import { all, first, now, run } from "./db";
import { reconcileNotificationGroups, recordNotification, type NotificationOptions } from "./notifications";
import { actionsForNudge, signNudge } from "./actions";
import { isShabbat } from "./shabbat";
import { urgencyFor } from "./policy";
import { getSettings } from "./db";

export interface PushMessage {
  title: string; body?: string; url?: string; tag?: string;
  nudge_id?: string; sig?: string; actions?: { action: string; title: string; opens?: boolean }[];
  topic_key?: string; legacy_tags?: string[]; revision?: number;
  close_notifications?: string[];
  notification_updates?: {id:string; title:string; body:string; revision:number}[];
}

const enc = new TextEncoder();

function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

export const pushConfigured = (env: Env) => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_JWK);

async function vapidHeader(env: Env, endpoint: string): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK!), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || "https://example.com",
  })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

async function encrypt(payload: Uint8Array, p256dh: string, auth: string): Promise<Uint8Array> {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, local.privateKey, 256);

  const hkdf = async (ikm: ArrayBuffer | Uint8Array, salt: Uint8Array, info: Uint8Array, bits: number) => {
    const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bits));
  };
  const ikm = await hkdf(ecdh, authSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, enc.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(ikm, salt, enc.encode("Content-Encoding: nonce\0"), 96);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** Sends to every registered device; drops subscriptions the push service says are gone. */
export async function sendPush(env: Env, msg: PushMessage): Promise<{ sent: number; failed: number }> {
  if (!pushConfigured(env)) return { sent: 0, failed: 0 };
  const subs = await all<{ endpoint: string; subscription: string }>(env, "SELECT endpoint, subscription FROM push_subscriptions");
  const packed = { ...msg, body: (msg.body ?? "").slice(0, 300),
    notification_updates:msg.notification_updates?.slice(0,6).map(n=>({...n,title:n.title.slice(0,90),body:n.body.slice(0,180)})),
    close_notifications:msg.close_notifications?.slice(0,50) };
  // Keep within the single encrypted Web Push record, including Hebrew/emoji byte sizes.
  while (enc.encode(JSON.stringify(packed)).length>3800 && packed.notification_updates?.length) packed.notification_updates.pop();
  while (enc.encode(JSON.stringify(packed)).length>3800 && packed.close_notifications?.length) packed.close_notifications.pop();
  const payload = enc.encode(JSON.stringify(packed));
  let sent = 0, failed = 0;
  await Promise.all(subs.map(async ({ endpoint, subscription }) => {
    try {
      const { keys } = JSON.parse(subscription) as { keys: { p256dh: string; auth: string } };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: await vapidHeader(env, endpoint),
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: "86400",
          urgency: "high",
        },
        body: await encrypt(payload, keys.p256dh, keys.auth),
      });
      if (res.status === 404 || res.status === 410) await run(env, "DELETE FROM push_subscriptions WHERE endpoint = ?", endpoint);
      if (res.ok) sent++;
      else (failed++, console.error("push failed", res.status, await res.text()));
    } catch (e) {
      failed++;
      console.error("push error", e);
    }
  }));
  return { sent, failed };
}

/**
 * Records a nudge (home screen, widget, next briefing) and buzzes the phone only when the
 * interruption rule says it can't wait (policy.ts). Never buzzes on Shabbat.
 */
export async function notify(env: Env, type: string, title: string, body = "", itemId: string | null = null, url = "/", options: NotificationOptions = {}) {
  const { id, topic } = await recordNotification(env,type,title,body,itemId,url,options);
  const reconciled = await reconcileNotificationGroups(env);
  const current=await first<Nudge&{dismissed:number;revision:number}>(env,"SELECT * FROM nudges WHERE id=?",id);
  if (!current || current.dismissed) return id;
  if (!actionableNotice(current,await attentionState(env))) return id;
  title=current.title;body=current.body;
  // Shabbat: keep it on the Today screen, but don't buzz. A summary goes out after Shabbat.
  if (isShabbat((await getSettings(env)).timezone)) return id;
  const prio = itemId ? (await first<{ priority: number }>(env, "SELECT priority FROM items WHERE id = ?", itemId))?.priority : undefined;
  if (urgencyFor(type, prio) === "later") return id; // waits quietly for the next briefing / check-in
  // The tag collapses repeats for the same item; buttons act without opening the app.
  // The briefing is written with headings and bold for the app; the phone notification gets it as plain lines.
  const pushBody = type === "briefing" ? body.replace(/^#{1,4}\s+(.*)$/gm, "$1:").replace(/\*\*/g, "").replace(/^\s*[-*]\s+/gm, "• ") : body;
  const delivered = await sendPush(env, {
    title, body: pushBody, url, tag: `cos:${topic}`, topic_key: topic, revision:current.revision,
    close_notifications:reconciled.closed, notification_updates:reconciled.updates.filter(n=>n.id!==id),
    legacy_tags: itemId ? [itemId] : type === "digest" || type === "sweep" ? ["digest","sweep"] : [type],
    nudge_id: id, sig: await signNudge(env, id),
    actions: (await actionsForNudge(env, { type, item_id: itemId, topic_key:topic, body })).map((a) => ({ action: a.id, title: a.title, opens: a.opens })),
  });
  if (delivered.sent) await run(env, "UPDATE nudges SET pushed_at = ? WHERE id = ?", now(),id);
  return id;
}
