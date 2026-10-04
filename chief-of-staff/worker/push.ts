/**
 * Web Push sender (RFC 8291 aes128gcm payload encryption + RFC 8292 VAPID), WebCrypto only.
 * VAPID_PUBLIC_KEY is the raw P-256 public key (base64url); VAPID_PRIVATE_JWK is the private key as a JWK.
 */
import type { Env } from "./env";
import { all, first, now, run, uid } from "./db";
import { actionsFor, signNudge } from "./actions";
import { isShabbat } from "./shabbat";
import { urgencyFor } from "./policy";
import { getSettings } from "./db";

export interface PushMessage {
  title: string; body?: string; url?: string; tag?: string;
  nudge_id?: string; sig?: string; actions?: { action: string; title: string; opens?: boolean }[];
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
  const payload = enc.encode(JSON.stringify({ ...msg, body: (msg.body ?? "").slice(0, 300) }));
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
export async function notify(env: Env, type: string, title: string, body = "", itemId: string | null = null, url = "/") {
  const id = uid();
  await run(env, "INSERT INTO nudges (id, type, title, body, item_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id, type, title, body, itemId, now());
  // Shabbat: keep it on the Today screen, but don't buzz. A summary goes out after Shabbat.
  if (isShabbat((await getSettings(env)).timezone)) return;
  const prio = itemId ? (await first<{ priority: number }>(env, "SELECT priority FROM items WHERE id = ?", itemId))?.priority : undefined;
  if (urgencyFor(type, prio) === "later") return; // waits quietly for the next briefing / check-in
  // The tag collapses repeats for the same item; buttons act without opening the app.
  await sendPush(env, {
    title, body, url, tag: itemId ?? type, nudge_id: id, sig: await signNudge(env, id),
    actions: actionsFor({ type, item_id: itemId }).map((a) => ({ action: a.id, title: a.title, opens: a.opens })),
  });
}
