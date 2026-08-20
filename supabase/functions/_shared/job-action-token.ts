/**
 * Short-lived signed tokens that let a notification action button complete a job
 * without a user session. The service worker has no Supabase auth, so the token
 * itself is the authorization — scoped to one job + action and time-limited.
 */
function secret(): string {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    || Deno.env.get("PUSH_VAPID_PRIVATE_KEY")
    || "";
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Token valid for `hours` (default 48 — covers overnight/overdue reminders). */
export async function signJobAction(jobId: string, action: string, hours = 48): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  const payload = `${jobId}.${action}.${exp}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function verifyJobAction(
  token: string,
): Promise<{ ok: boolean; jobId?: string; action?: string; reason?: string }> {
  const parts = String(token || "").split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed token" };
  const [jobId, action, exp, sig] = parts;
  if (!secret()) return { ok: false, reason: "server not configured" };
  if (Number(exp) * 1000 < Date.now()) return { ok: false, reason: "token expired" };
  const expected = await hmac(`${jobId}.${action}.${exp}`);
  // Constant-time-ish compare
  if (sig.length !== expected.length) return { ok: false, reason: "bad signature" };
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: "bad signature" };
  return { ok: true, jobId, action };
}
