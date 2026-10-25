import { buildCoffeeBarConfiguration, resolveCoffeeBarGuests } from "../_shared/coffee-bar-order.ts";
import { subscriptionDeliveryRule } from "../_shared/subscription-delivery.ts";
import "../_shared/subscription-model.js";
const subscriptionModel = (globalThis as any).GremierSubscriptionModel;
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fulfillPaidOrder } from "../_shared/fulfill-paid-order.ts";
import { logReferralEvent, notifyOwner, referralByCode, referralProblem } from "../_shared/engage.ts";
import { shabbatPromoActive } from "../_shared/weekly-promo.ts";
import { cleanText, pickDeliveryChoice } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gremier-user-id",
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

function isSubscriptionProductRow(product: Record<string, unknown>): boolean {
  return product.is_subscription === true || product.category === "subscriptions";
}
function priceSubscription(product: Record<string, unknown>, item: Record<string, unknown>, productsById: Map<string, Record<string, unknown>>): {unitPrice:number;contents:Array<Record<string,unknown>>} {
  const config=(Array.isArray(product.variations)?product.variations:[]).find((v:any)=>v.type==="subscription_bundle");
  const ids=(config?.items||config?.product_ids||[]).map((c:any)=>String(c.product_id||c.id||c));
  const chosen=Array.isArray(item.subscription_items)?item.subscription_items as any[]:[];
  if(ids.length&&chosen.some(c=>!ids.includes(String(c.product_id))))throw new Error("Invalid subscription item");
  const q=subscriptionModel.quote(chosen,[...productsById.values()]);
  return {unitPrice:q.total,contents:q.contents};
}

/** Resolve the chosen guest-count tier (label + guests) from the validated guest price. */
function resolveGuestSelection(
  product: Record<string, unknown>,
  item: Record<string, unknown>,
): { label: string; guests: number | null } | null {
  const coffeeGuests = resolveCoffeeBarGuests(product, item);
  if (coffeeGuests) return { label: `${coffeeGuests} guests`, guests: coffeeGuests };
  if (item.selected_guest_price == null || item.selected_guest_price === "") return null;
  const price = Number(item.selected_guest_price);
  if (Number.isNaN(price)) return null;
  const variations = Array.isArray(product.variations) ? product.variations as Record<string, unknown>[] : [];
  const guestVariation = variations.find((v) => v.type === "guest_count");
  const options = Array.isArray(guestVariation?.options) ? guestVariation.options : [];
  const match = options.map(normalizeVariationOption).find((o) => o.price === price);
  if (!match) return null;
  return { label: match.label || "", guests: match.guests };
}

function computeUnitPrice(product: Record<string, unknown>, item: Record<string, unknown>): number {
  const variations = Array.isArray(product.variations) ? product.variations as Record<string, unknown>[] : [];
  let unitPrice = Number(product.price) || 0;
  let guests = 0;   // from the chosen guest option ("50" → 50), for per-liter add-ons

  const selectedGuestPrice = item.selected_guest_price != null && item.selected_guest_price !== ""
    ? Number(item.selected_guest_price)
    : null;
  if (selectedGuestPrice != null && !Number.isNaN(selectedGuestPrice)) {
    const guestVariation = variations.find((v) => v.type === "guest_count");
    const guestOptions = Array.isArray(guestVariation?.options) ? guestVariation.options : [];
    const guestOption = guestOptions
      .map(normalizeVariationOption)
      .find((option) => option.price === selectedGuestPrice);
    if (guestOption) { unitPrice = selectedGuestPrice; guests = guestOption.guests || parseInt(String(guestOption.label || ""), 10) || 0; }
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
          guests = guests || parseInt(String(option.label || ""), 10) || 0;
          break;
        }
      }
    }
  }

  const addonBlock = variations.find((v) => v.type === "addons");
  const allowedAddons = Array.isArray(addonBlock?.items) ? addonBlock.items as Record<string, unknown>[] : [];
  const selectedAddons = Array.isArray(item.selected_addons) ? item.selected_addons as Record<string, unknown>[] : [];
  const groupsUsed = new Set<string>();   // pick-one add-ons (e.g. the coffee for the bar): one per group
  // Coffee upgrades per 5-liter jug: the bar has one jug per 25 guests, and all the upgraded
  // jugs together can't be more than that (the rest is the included Classic).
  let jugsLeft = Math.max(1, Math.ceil(guests / 25));
  const addonTotal = selectedAddons.reduce((sum, selected) => {
    const name = String(selected?.name || "").trim();
    const match = allowedAddons.find((addon) => String(addon.name || "").trim() === name);
    if (!match) return sum;
    if (match.group) {
      const group = String(match.group);
      if (groupsUsed.has(group)) return sum;
      groupsUsed.add(group);
    }
    // Parve milk etc.: priced per liter, at most 1 liter per 10 guests.
    if (match.per_liter) {
      const liters = Math.max(0, Math.min(Math.floor(guests / 10), Math.round(Number(selected?.liters) || 0)));
      return sum + (Number(match.price) || 0) * liters;
    }
    if (match.per_jug) {
      // A cart saved before jugs existed (no qty) was one flat upgrade: count it as one jug.
      const asked = selected?.qty == null ? 1 : Math.round(Number(selected.qty) || 0);
      const jugs = Math.max(0, Math.min(jugsLeft, asked));
      jugsLeft -= jugs;
      return sum + (Number(match.price) || 0) * jugs;
    }
    // Quantity add-ons (extra dispensers, syrups): price × how many, up to the item's max.
    const max = Number(match.max) || 0;
    if (max > 1) {
      const qty = Math.max(0, Math.min(max, Math.round(Number(selected?.qty) || 0)));
      return sum + (Number(match.price) || 0) * qty;
    }
    return sum + (Number(match.price) || 0);
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
  const rawShipType = String(deliveryInfo.delivery_type || "regular");
  if (rawShipType === "pickup") return { fee: 0, source: "pickup", zone: null };
  const shipType = rawShipType === "expedited" ? "expedited" : rawShipType === "event" ? "event" : "regular";
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
  const eventDefault = Number(settings?.default_event_price) || 80;
  const regular = zone ? Number(zone.regular_price) || 0 : regularDefault;
  const expedited = zone ? Number(zone.expedited_price) || 0 : expeditedDefault;
  const eventZone = zone ? (zone.event_price != null ? Number(zone.event_price) : expedited) : eventDefault;
  const freeAbove = zone?.free_above ? Number(zone.free_above) : null;

  const customFees = products.map(getProductDeliveryPrice).filter((v): v is number => v != null && !Number.isNaN(v));
  const productFee = customFees.length ? Math.max(...customFees) : null;
  const isFree = productFee == null && freeAbove != null && subtotal >= freeAbove;
  const regularFee = productFee != null ? productFee : (isFree ? 0 : regular);
  const expeditedSurcharge = Math.max(0, expedited - regular);
  const expeditedFee = productFee != null ? productFee + expeditedSurcharge : expedited;
  const eventFee = productFee != null ? productFee + expeditedSurcharge : eventZone;

  return {
    fee: shipType === "expedited" ? expeditedFee : shipType === "event" ? eventFee : regularFee,
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
    const customerName = cleanText(body.customer_name, 120);
    const customerEmail = cleanText(body.customer_email, 200);
    const customerPhone = cleanText(body.customer_phone, 40);
    const deliveryAddress = cleanText(body.delivery_address, 300);
    // Only the customer's delivery choices — every other delivery_info field is server-set.
    const deliveryInfo = pickDeliveryChoice(body.delivery_info);

    if (!customerName || !customerEmail || !customerPhone || (deliveryInfo.delivery_type !== "pickup" && !deliveryAddress)) {
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

    // Also load the products chosen inside any subscription box, for their real prices.
    const boxIds = items.flatMap((item: Record<string, unknown>) =>
      Array.isArray(item.subscription_items)
        ? (item.subscription_items as Record<string, unknown>[]).map((c) => String(c?.product_id || "").trim())
        : []
    ).filter(Boolean);
    const { data: fetchedRows, error: productErr } = await admin
      .from("products")
      .select("id,name_en,name_he,price,is_active,variations,delivery_price,is_subscription,is_coffee_bar,category")
      .in("id", [...new Set([...productIds, ...boxIds])]);
    if (productErr) throw productErr;

    const productsById = new Map((fetchedRows || []).map((product: Record<string, unknown>) => [String(product.id), product]));
    // Only the products actually in the cart drive delivery pricing.
    const productRows = productIds.map((id) => productsById.get(id)).filter(Boolean) as Record<string, unknown>[];

    // A subscription's order total becomes the monthly PayMe charge, so it must be
    // ordered on its own — anything else in the cart would be billed every month.
    const subscriptionLines = items.filter((item: Record<string, unknown>) => {
      const p = productsById.get(String(item.product_id || "").trim());
      return p && (isSubscriptionProductRow(p) || item.is_subscription === true);
    });
    const isSubscriptionOrder = subscriptionLines.length > 0;
    if (isSubscriptionOrder && items.length > 1) {
      return json({ error: "A subscription has to be ordered on its own — please check out other items separately." }, 400);
    }

    const allowedItems = items.map((item: Record<string, unknown>) => {
      const productId = String(item.product_id || "").trim();
      const product = productsById.get(productId);
      if (!product || product.is_active === false) throw new Error("Invalid order item");
      const isSub = isSubscriptionProductRow(product) || item.is_subscription === true;
      const modern = isSub && !isSubscriptionProductRow(product);
      const subscriptionQuote = modern ? subscriptionModel.quote(item.subscription_items, [...productsById.values()]) : null;
      if (modern && !subscriptionModel.eligible(product)) throw new Error("Invalid subscription product");
      const sub = subscriptionQuote ? {unitPrice:subscriptionQuote.total,contents:subscriptionQuote.contents} : isSub ? priceSubscription(product, item, productsById) : null;
      if(isSub && sub?.contents){const q=subscriptionModel.quote(sub.contents,[...productsById.values()]);if(!q.deliveryEligible && deliveryInfo.delivery_type!=="pickup")throw new Error("Subscription delivery requires two coffee items or one 5L container; otherwise choose pickup");}
      const qty = isSub ? 1 : Math.max(1, Math.min(99, Math.floor(Number(item.qty) || 1)));
      const unitPrice = sub ? sub.unitPrice : computeUnitPrice(product, item);
      if (!(unitPrice > 0)) throw new Error("Invalid item price");
      const guest = resolveGuestSelection(product, item);
      const coffeeBarConfiguration = isSub ? null : buildCoffeeBarConfiguration(product, item);
      if (["9361ff6e-4227-44cc-a23a-428a002f1f4c", "c211cedd-ef93-4dba-9a6e-b2edb1add6e0"].includes(productId) && !coffeeBarConfiguration) throw new Error("Choose the number of guests for your coffee bar");
      const interval = String(item.subscription_interval || "monthly").toLowerCase() === "weekly" ? "weekly" : "monthly";
      return {
        product_id: productId,
        name_en: isSub ? "Coffee subscription" : product.name_en || null,
        name_he: isSub ? "מנוי קפה" : product.name_he || null,
        price: unitPrice,
        qty,
        coffee_bar_configuration: coffeeBarConfiguration,
        selected_variations: isSub ? null : item.selected_variations || null,
        selected_addons: isSub ? null : item.selected_addons || null,
        selected_guest_price: isSub ? null : item.selected_guest_price || null,
        // Guest tier for display ("for N people") — validated against the catalog.
        selected_guests: guest?.guests ?? null,
        guest_label: guest?.label || null,
        // Subscription details, decided server-side from the catalog: the flag lets the
        // admin recognise the order; the box contents say what to deliver every cycle.
        is_subscription: isSub,
        subscription_interval: isSub ? interval : null,
        subscription_items: sub?.contents ?? null,
        category: product.category || null,
      };
    });
    const subscriptionInterval = isSubscriptionOrder ? allowedItems[0].subscription_interval : null;
    const subscriptionSchedule = isSubscriptionOrder ? subscriptionDeliveryRule(subscriptionInterval, deliveryInfo.delivery_type === "pickup" ? null : deliveryInfo.delivery_date, new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jerusalem"}).format(new Date())) : null;

    const subtotal = allowedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    const [zonesResult, settingsResult] = await Promise.all([
      admin.from("delivery_zones").select("*").eq("is_active", true),
      admin.from("delivery_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    if (zonesResult.error) throw zonesResult.error;
    if (settingsResult.error) throw settingsResult.error;

    const modernSubscription = isSubscriptionOrder && !!allowedItems[0].subscription_items?.length;
    const deliveryProducts = modernSubscription ? (allowedItems[0].subscription_items || []).map((c:any)=>productsById.get(String(c.product_id))) : productRows;
    const deliverySubtotal = modernSubscription ? subscriptionModel.quote(items[0].subscription_items,[...productsById.values()]).regular : subtotal;
    const delivery = computeDeliveryFee(
      deliveryProducts || [],
      deliverySubtotal,
      deliveryInfo,
      zonesResult.data || [],
      settingsResult.data || null,
    );
    // Tuesday/Wednesday: free regular delivery, before Shabbat (not for subscriptions, which recur).
    const shabbatPromo = !isSubscriptionOrder && shabbatPromoActive() && String(deliveryInfo.delivery_type || "regular") === "regular";
    if (shabbatPromo) { delivery.fee = 0; delivery.source = "shabbat_promo"; }

    let discount = 0;

    // Subscriptions already carry the subscription discount, and the order total becomes
    // the recurring PayMe price — a one-off coupon / gift card would recur forever (and a
    // fully covered order would never create the subscription at all). So none apply.
    if (isSubscriptionOrder && (String(body.coupon_code || "").trim() || String(body.gift_card_code || "").trim())) {
      return json({ error: "Coupons and gift cards can't be used on a subscription." }, 400);
    }

    // Check loyalty coupon (profile-based) — kept for their next regular order
    if (userId && !isSubscriptionOrder) {
      const { data: profile } = await admin
        .from("profiles")
        .select("coupon_available")
        .eq("id", userId)
        .maybeSingle();
      if (profile?.coupon_available) {
        discount = Math.round(subtotal * 0.10);
      }
    }

    // Kept apart from codes and gift cards: only this uses up the member's loyalty coupon.
    const loyaltyDiscount = discount;

    // Check coupon code sent from client
    let appliedCouponCode: string | null = null;
    const couponCode = String(body.coupon_code || "").trim().toUpperCase();
    // Referral (friend) codes: first paid order only, and not the person who shared it.
    const refProblem = couponCode ? await referralProblem(admin, couponCode, customerEmail) : null;
    if (couponCode && refProblem) return json({ error: refProblem }, 400);
    if (couponCode && discount === 0) {
      const { data: coupon } = await admin
        .from("coupons")
        .select("*")
        .eq("code", couponCode)
        .eq("is_active", true)
        .maybeSingle();
      if (coupon) {
        const maxUses = coupon.max_uses != null ? Number(coupon.max_uses) : null;
        const usesCount = Number(coupon.uses_count) || 0;
        const notExhausted = maxUses === null || usesCount < maxUses;
        const notExpired = !coupon.expires_at || new Date(coupon.expires_at) > new Date();
        if (notExhausted && notExpired) {
          const couponDiscount = coupon.discount_type === "percent"
            ? Math.round(subtotal * (Number(coupon.discount_value) / 100))
            : Number(coupon.discount_value) || 0;
          discount = Math.min(couponDiscount, subtotal);
          if (discount > 0) appliedCouponCode = couponCode;
        }
      }
    }

    // Check gift card code sent from client.
    let giftCardId: string | null = null;
    let giftCardBalance = 0;
    let gcDiscount = 0;
    const giftCardCode = String(body.gift_card_code || "").trim().toUpperCase();
    if (giftCardCode) {
      const { data: giftCard } = await admin
        .from("gift_cards")
        .select("id,balance,is_active")
        .eq("code", giftCardCode)
        .eq("is_active", true)
        .maybeSingle();
      if (giftCard && Number(giftCard.balance) > 0) {
        const remainingPayable = subtotal + delivery.fee - discount;
        gcDiscount = Math.min(Number(giftCard.balance), Math.max(0, remainingPayable));
        if (gcDiscount > 0) {
          discount += gcDiscount;
          giftCardId = String(giftCard.id);
          giftCardBalance = Number(giftCard.balance);
        }
      }
    }

    const total = Math.max(0, subtotal + delivery.fee - discount);

    const fullyCovered = total === 0 && discount > 0;
    if (total < 0 || (total === 0 && !fullyCovered)) {
      return json({ error: "Invalid order total" }, 400);
    }

    const couponDiscountValue = appliedCouponCode ? Math.max(0, discount - gcDiscount) : 0;

    const insertPayload: Record<string, unknown> = {
      user_id: userId,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      delivery_address: deliveryAddress,
      notes: [shabbatPromo ? "🕯️ Tue/Wed promo: deliver before Shabbat" : "", cleanText(body.notes, 1000) || ""].filter(Boolean).join(" · ") || null,
      items: allowedItems,
      subtotal,
      discount,
      total,
      coupon_code: appliedCouponCode,
      coupon_discount: couponDiscountValue,
      gift_card_code: gcDiscount > 0 ? giftCardCode : null,
      gift_card_discount: gcDiscount || 0,
      delivery_info: {
        ...deliveryInfo,
        // Decided server-side, never trusted from the client.
        subscription: isSubscriptionOrder ? { interval: subscriptionInterval, delivery_schedule: subscriptionSchedule } : null,
        delivery_fee: delivery.fee,
        zone_id: delivery.zone?.id || null,
        zone_name: delivery.zone?.name_en || "",
        pricing_source: delivery.source,
        site_lang: body.site_lang === "he" ? "he" : body.site_lang === "en" ? "en" : null,
        ...(shabbatPromo ? { shabbat_promo: true } : {}),
        server_priced: true,
        gift_card_id: giftCardId,
        loyalty_discount: loyaltyDiscount || 0,
        // "Save my card": only for a verified signed-in customer, never on subscriptions.
        ...(body.save_card === true && userId && !isSubscriptionOrder ? { save_card_requested: true } : {}),
        gift_card_amount: gcDiscount || 0,
      },
      status: fullyCovered ? "confirmed" : "awaiting_payment",
      payment_status: fullyCovered ? "paid" : "unpaid",
      payment_method: fullyCovered ? "gift_card" : "payme",
      source: "website",
    };

    const { data: inserted, error } = await admin
      .from("orders")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error || !inserted?.id) {
      throw error || new Error("Could not create order");
    }

    // A friend's referral code was used: log it and tell the owner (the reward follows on payment).
    if (appliedCouponCode) {
      const ref = await referralByCode(admin, appliedCouponCode);
      if (ref) {
        await logReferralEvent(admin, ref.code, "order", inserted.id);
        await notifyOwner(`🛒 Referral used by ${customerName || customerEmail}`,
          `${customerName || "Someone"} (${customerEmail}) started an order with ${ref.email}'s referral code ${ref.code} (−₪${couponDiscountValue}).
If they pay, ${ref.email} gets a ₪20 gift card automatically.`);
      }
    }

    // Notifications turned on in the shop app on this device: they're now this customer's.
    const pushEndpoint = String(body.push_endpoint || "").trim();
    if (/^https:\/\//.test(pushEndpoint) && customerEmail) {
      await admin.from("customer_push_subscriptions")
        .update({ email: String(customerEmail).toLowerCase(), ...(userId ? { user_id: userId } : {}) })
        .eq("endpoint", pushEndpoint);
    }

    // Coupon / gift card are consumed inside fulfillPaidOrder (redeemOrderCodes) for every
    // paid order — full coverage included — so there is no separate redeem call here.

    // Fully-covered gift card order: no PayMe webhook will ever fire, so call
    // fulfillPaidOrder directly — the same function confirm-payment-return calls
    // after PayMe settles. This sends admin Pushover + Google Sheet sync +
    // customer confirmation email in one shot using the service role client.
    if (fullyCovered) {
      try {
        await fulfillPaidOrder(admin, inserted.id, { force: false });
      } catch (e) {
        console.error("fulfillPaidOrder (gift card) failed:", e);
      }
    }

    return json({
      id: inserted.id,
      paid: fullyCovered,
      total,
    });
  } catch (err) {
    console.error("create-website-order error:", err);
    return json({ error: err instanceof Error ? err.message : "Could not create order" }, 400);
  }
});
