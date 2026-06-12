import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getServiceRoleKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (!raw) return "";
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default || keys.service_role || Object.values(keys)[0] || "";
  } catch {
    return "";
  }
}

async function getUserId(req: Request, supabaseUrl: string): Promise<string | null> {
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!anonKey || !jwt || jwt === anonKey) return null;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  return user?.id || null;
}

function normalizeCityName(value: unknown): string {
  return String(value || "").toLowerCase().trim().replace(/['"`]/g, "").replace(/\s+/g, " ");
}

function normalizeVariationOption(option: unknown): { label: string; price: number | null; guests: number | null } {
  if (typeof option === "string") return { label: option, price: null, guests: null };
  const row = option && typeof option === "object" ? option as Record<string, unknown> : {};
  const price = row.price != null && row.price !== "" ? Number(row.price) : null;
  const guests = row.guests != null && row.guests !== "" ? Number(row.guests) : null;
  return {
    label: String(row.label || option || "").trim(),
    price: price != null && !Number.isNaN(price) ? price : null,
    guests: guests != null && !Number.isNaN(guests) ? guests : null,
  };
}

function isChoiceVariation(variation: unknown): boolean {
  const row = variation && typeof variation === "object" ? variation as Record<string, unknown> : {};
  return row.type !== "guest_count" && row.type !== "delivery_price" && row.type !== "addons"
    && !!row.name && Array.isArray(row.options);
}

function getProductDeliveryPrice(product: Record<string, unknown>): number | null {
  const direct = product.delivery_price != null && product.delivery_price !== "" ? Number(product.delivery_price) : null;
  if (direct != null && !Number.isNaN(direct)) return direct;
  const variations = Array.isArray(product.variations) ? product.variations as Record<string, unknown>[] : [];
  const delivery = variations.find((v) => v.type === "delivery_price");
  const fromVariation = delivery?.price != null && delivery.price !== "" ? Number(delivery.price) : null;
  return fromVariation != null && !Number.isNaN(fromVariation) ? fromVariation : null;
}

function selectedValues(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>)
    .filter((v) => v && typeof v === "object") as Record<string, unknown>[];
}

function computeUnitPrice(product: Record<string, unknown>, item: Record<string, unknown>): number {
  const variations = Array.isArray(product.variations) ? product.variations as Record<string, unknown>[] : [];
  let unitPrice = Number(product.price) || 0;

  const selectedGuestPrice = item.selected_guest_price != null && item.selected_guest_price !== ""
    ? Number(item.selected_guest_price)
    : null;
  if (selectedGuestPrice != null && !Number.isNaN(selectedGuestPrice)) {
    const guestVariation = variations.find((v) => v.type === "guest_count");
    const guestOptions = Array.isArray(guestVariation?.options) ? guestVariation.options : [];
    const validGuest = guestOptions
      .map(normalizeVariationOption)
      .some((option) => option.price === selectedGuestPrice);
    if (validGuest) unitPrice = selectedGuestPrice;
  } else {
    const selected = selectedValues(item.selected_variations);
    for (const group of variations.filter(isChoiceVariation)) {
      const options = Array.isArray(group.options) ? group.options.map(normalizeVariationOption) : [];
      const picked = selected.find((s) => String(s.label || "").trim()
        && options.some((o) => o.label === String(s.label || "").trim() && o.price != null));
      if (picked) {
        const option = options.find((o) => o.label === String(picked.label || "").trim());
        if (option?.price != null) {
          unitPrice = option.price;
          break;
        }
      }
    }
  }

  const addonBlock = variations.find((v) => v.type === "addons");
  const allowedAddons = Array.isArray(addonBlock?.items) ? addonBlock.items as Record<string, unknown>[] : [];
  const selectedAddons = Array.isArray(item.selected_addons) ? item.selected_addons as Record<string, unknown>[] : [];
  const addonTotal = selectedAddons.reduce((sum, selected) => {
    const name = String(selected?.name || "").trim();
    const match = allowedAddons.find((addon) => String(addon.name || "").trim() === name);
    return sum + (match ? Number(match.price) || 0 : 0);
  }, 0);

  return unitPrice + addonTotal;
}

function computeDeliveryFee(
  products: Record<string, unknown>[],
  subtotal: number,
  deliveryInfo: Record<string, unknown>,
  deliveryZones: Record<string, unknown>[],
  settings: Record<string, unknown> | null,
): { fee: number; source: string; zone: Record<string, unknown> | null } {
  const shipType = String(deliveryInfo.delivery_type || "regular") === "expedited" ? "expedited" : "regular";
  const cityCode = String(deliveryInfo.city_code || "").trim();
  const cityEn = normalizeCityName(deliveryInfo.city_en);
  const cityHe = String(deliveryInfo.city_he || "").trim();
  const zone = deliveryZones.find((z) => {
    if (cityCode && z.city_code && String(z.city_code) === cityCode) return true;
    const zoneEn = normalizeCityName(z.name_en);
    return (zoneEn && cityEn && (zoneEn === cityEn || zoneEn.includes(cityEn) || cityEn.includes(zoneEn)))
      || (!!cityHe && String(z.name_he || "").trim() === cityHe);
  }) || null;

  const regularDefault = Number(settings?.default_regular_price) || 30;
  const expeditedDefault = Number(settings?.default_expedited_price) || 50;
  const regular = zone ? Number(zone.regular_price) || 0 : regularDefault;
  const expedited = zone ? Number(zone.expedited_price) || 0 : expeditedDefault;
  const freeAbove = zone?.free_above ? Number(zone.free_above) : null;

  const customFees = products.map(getProductDeliveryPrice).filter((v): v is number => v != null && !Number.isNaN(v));
  const productFee = customFees.length ? Math.max(...customFees) : null;
  const isFree = productFee == null && freeAbove != null && subtotal >= freeAbove;
  const regularFee = productFee != null ? productFee : (isFree ? 0 : regular);
  const expeditedSurcharge = Math.max(0, expedited - regular);
  const expeditedFee = productFee != null ? productFee + expeditedSurcharge : expedited;

  return {
    fee: shipType === "expedited" ? expeditedFee : regularFee,
    source: zone ? "zone" : "default",
    zone,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = getServiceRoleKey();
    if (!supabaseUrl || !serviceKey) return json({ error: "misconfigured" }, 500);

    const body = await req.json();
    const items = Array.isArray(body.items) ? body.items : [];
    const customerName = String(body.customer_name || "").trim();
    const customerEmail = String(body.customer_email || "").trim();
    const customerPhone = String(body.customer_phone || "").trim();
    const deliveryAddress = String(body.delivery_address || "").trim();
    const deliveryInfo = body.delivery_info && typeof body.delivery_info === "object"
      ? body.delivery_info as Record<string, unknown>
      : {};

    if (!customerName || !customerEmail || !customerPhone || !deliveryAddress) {
      return json({ error: "Missing customer details" }, 400);
    }
    if (!items.length) return json({ error: "Invalid order" }, 400);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const userId = await getUserId(req, supabaseUrl);
    const productIds = [...new Set(items.map((item: Record<string, unknown>) => String(item.product_id || "").trim()).filter(Boolean))];
    if (!productIds.length || items.some((item: Record<string, unknown>) => !String(item.product_id || "").trim())) {
      return json({ error: "Invalid order items" }, 400);
    }

    const { data: productRows, error: productErr } = await admin
      .from("products")
      .select("id,name_en,name_he,price,is_active,variations,delivery_price")
      .in("id", productIds);
    if (productErr) throw productErr;

    const productsById = new Map((productRows || []).map((product: Record<string, unknown>) => [String(product.id), product]));
    const allowedItems = items.map((item: Record<string, unknown>) => {
      const productId = String(item.product_id || "").trim();
      const product = productsById.get(productId);
      if (!product || product.is_active === false) throw new Error("Invalid order item");
      const qty = Math.max(1, Math.min(99, Math.floor(Number(item.qty) || 1)));
      const unitPrice = computeUnitPrice(product, item);
      if (!(unitPrice > 0)) throw new Error("Invalid item price");
      return {
        product_id: productId,
        name_en: product.name_en || null,
        name_he: product.name_he || null,
        price: unitPrice,
        qty,
        selected_variations: item.selected_variations || null,
        selected_addons: item.selected_addons || null,
        selected_guest_price: item.selected_guest_price || null,
      };
    });

    const subtotal = allowedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    const [zonesResult, settingsResult] = await Promise.all([
      admin.from("delivery_zones").select("*").eq("is_active", true),
      admin.from("delivery_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    if (zonesResult.error) throw zonesResult.error;
    if (settingsResult.error) throw settingsResult.error;

    const delivery = computeDeliveryFee(
      productRows || [],
      subtotal,
      deliveryInfo,
      zonesResult.data || [],
      settingsResult.data || null,
    );
    let couponAllowed = false;
    if (userId) {
      const { data: profile, error: profileErr } = await admin
        .from("profiles")
        .select("coupon_available")
        .eq("id", userId)
        .maybeSingle();
      if (profileErr) throw profileErr;
      couponAllowed = !!profile?.coupon_available;
    }
    const discount = couponAllowed ? Math.round(subtotal * 0.10) : 0;
    const total = Math.max(0, subtotal + delivery.fee - discount);
    if (!(total > 0)) return json({ error: "Invalid order total" }, 400);

    const { data: inserted, error } = await admin
      .from("orders")
      .insert({
        user_id: userId,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        delivery_address: deliveryAddress,
        notes: String(body.notes || "").trim() || null,
        items: allowedItems,
        subtotal,
        discount,
        total,
        delivery_info: {
          ...deliveryInfo,
          delivery_fee: delivery.fee,
          zone_id: delivery.zone?.id || null,
          zone_name: delivery.zone?.name_en || "",
          pricing_source: delivery.source,
          server_priced: true,
        },
        status: "awaiting_payment",
        payment_status: "unpaid",
        payment_method: "payme",
        source: "website",
      })
      .select("id")
      .single();

    if (error || !inserted?.id) throw error || new Error("Could not create order");
    return json({ id: inserted.id });
  } catch (err) {
    console.error("create-website-order error:", err);
    return json({ error: err instanceof Error ? err.message : "Could not create order" }, 400);
  }
});
