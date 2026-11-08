// Daily (10:00 Israel). Birthday codes are made and emailed as soon as a birthday is saved (see
// _shared/birthday-code.ts), valid only in the birthday month and for one order. This job:
//  - on the birthday month, reminds people whose code was made earlier, and
//  - makes this year's code for anyone in their birthday month who doesn't have one yet (later years,
//    or a code whose email failed). Service only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceOrAdmin } from "../_shared/security.ts";
import { sendPendingLoyaltyCodes } from "../_shared/loyalty-codes.ts";
import { issueBirthdayCode, jerusalemToday, remindBirthdayCode } from "../_shared/birthday-code.ts";

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return k.default || k.service_role || ""; } catch { return ""; }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST required", { status: 405 });
  if (!await isServiceOrAdmin(req)) return new Response("Forbidden", { status: 403 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (!body.only_email) await sendPendingLoyaltyCodes(sb);
  const now = jerusalemToday();
  // A test run sends to one address only (an existing birthday row), and never marks it sent.
  const only = typeof body.only_email === "string" ? body.only_email.toLowerCase() : null;
  let q = sb.from("customer_birthdays").select("*").eq("month", now.month);
  if (only) q = q.eq("email", only);
  else q = q.or(`last_sent_year.is.null,last_sent_year.lt.${now.year},reminded_year.is.null,reminded_year.lt.${now.year}`);
  const { data: rows, error } = await q.limit(200);
  if (error) return Response.json({ error: "load_failed" }, { status: 500 });
  const counts: Record<string, number> = {};
  for (const r of rows || []) {
    const result = only
      ? await issueBirthdayCode(sb, { ...r, last_code: null, last_sent_year: null }, { markRow: false })
      : r.last_sent_year === now.year
        ? await remindBirthdayCode(sb, r, now.year)
        : await issueBirthdayCode(sb, r);
    counts[result.status] = (counts[result.status] || 0) + 1;
  }
  return Response.json({ month: now.month, candidates: (rows || []).length, ...counts });
});
