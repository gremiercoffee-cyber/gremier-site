// supabase/functions/validate-gift-card/index.ts
// Checks a gift card code and returns its available balance.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
/** Case-insensitive EXACT match: escape LIKE wildcards so "%" / "_" can't enumerate codes. */
function likeLiteral(v: string): string { return v.replace(/[\\%_]/g, (m) => "\\" + m); }


const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
function getServiceRoleKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (!raw) return "";
    const keys = JSON.parse(raw) as Record<string, unknown>;
    return String(keys.default || keys.service_role || Object.values(keys)[0] || "");
  } catch {
    return "";
  }
}
const SERVICE_KEY = getServiceRoleKey();

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const { code, cart_total } = await req.json();
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) return json({ valid: false, error: 'no_code' });
    // Codes are letters/digits/dashes only — anything else (e.g. "%" wildcards) can't match.
    if (!/^[A-Z0-9-]{3,40}$/.test(cleanCode)) return json({ valid: false, error: 'not_found', message: 'Gift card not found' });

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: gc } = await sb.from('gift_cards').select('*').ilike('code', likeLiteral(cleanCode)).maybeSingle();

    if (!gc) return json({ valid: false, error: 'not_found', message: 'Gift card not found' });
    if (!gc.is_active) return json({ valid: false, error: 'inactive', message: 'This gift card is inactive' });
    if (gc.expires_at && new Date(gc.expires_at) < new Date()) {
      return json({ valid: false, error: 'expired', message: 'This gift card has expired' });
    }
    if (Number(gc.balance) <= 0) {
      return json({ valid: false, error: 'empty', message: 'This gift card has no remaining balance' });
    }

    const cartTotal = Number(cart_total) || 0;
    // Gift card covers up to its balance, but never more than the cart total.
    const applied = Math.min(Number(gc.balance), cartTotal);

    return json({
      valid: true,
      gift_card_id: gc.id,
      code: gc.code,
      balance: Number(gc.balance),
      applied,
      message: `Gift card balance: ₪${Number(gc.balance).toFixed(0)} — ₪${applied.toFixed(0)} will be applied`,
    });
  } catch (err) {
    return json({ valid: false, error: 'server_error', message: String(err) }, 500);
  }
});