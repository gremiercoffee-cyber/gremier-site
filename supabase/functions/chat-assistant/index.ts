import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ChatProduct = {
  id: string;
  slug?: string;
  name_en: string;
  name_he?: string;
  description_en?: string;
  description_he?: string;
  price: number;
  original_price?: number | null;
  category?: string;
  badge_text?: string | null;
  is_subscription?: boolean;
  guest_pricing?: Array<{ label: string; guests: number; price: number }> | null;
  updated_at?: string | null;
};

type ChatMessage = { role: string; content: string };

function slugify(name: string) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function mapDbProduct(row: Record<string, unknown>): ChatProduct {
  const variations = (row.variations as Array<Record<string, unknown>>) || [];
  const guestVar = variations.find((v) => v.type === "guest_count");
  return {
    id: String(row.id),
    slug: slugify(String(row.name_en || "")),
    name_en: String(row.name_en || ""),
    name_he: String(row.name_he || ""),
    description_en: String(row.description_en || ""),
    description_he: String(row.description_he || ""),
    price: Number(row.price) || 0,
    original_price: row.original_price != null ? Number(row.original_price) : null,
    category: String(row.category || ""),
    badge_text: row.badge_text ? String(row.badge_text) : null,
    is_subscription: !!row.is_subscription,
    guest_pricing: (guestVar?.options as ChatProduct["guest_pricing"]) || null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

/** Always pull the latest active products from Supabase — never rely on a stale hardcoded list. */
async function fetchLiveProductsFromDb(): Promise<ChatProduct[]> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const apiKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !apiKey) {
    console.warn("Supabase env vars missing — falling back to client catalog only");
    return [];
  }

  const url =
    `${supabaseUrl}/rest/v1/products?is_active=eq.true&select=id,name_en,name_he,description_en,description_he,price,original_price,category,badge_text,is_subscription,variations,updated_at&order=sort_order.asc`;

  const res = await fetch(url, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    console.error("Failed to fetch products:", await res.text());
    return [];
  }

  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows.map(mapDbProduct);
}

function buildCatalogPrompt(products: ChatProduct[], lang: string, fetchedAt: string) {
  if (!products.length) {
    return "No active products found in the database right now.";
  }

  const lines = products.map((p) => {
    const name = lang === "he" && p.name_he ? p.name_he : p.name_en;
    const desc = lang === "he" && p.description_he ? p.description_he : (p.description_en || "");
    let line = `- id: "${p.id}" | ${name} | ₪${p.price}`;
    if (p.category) line += ` | category: ${p.category}`;
    if (p.badge_text) line += ` | badge: ${p.badge_text}`;
    if (p.is_subscription) line += ` | subscription`;
    if (desc) line += ` | ${desc}`;
    if (p.guest_pricing?.length) {
      line += ` | guest pricing: ${p.guest_pricing.map((g) => `${g.label} ₪${g.price}`).join(", ")}`;
    }
    if (p.updated_at) line += ` | updated: ${p.updated_at}`;
    return line;
  });

  return `Catalog fetched live at ${fetchedAt} (${products.length} active products):\n${lines.join("\n")}`;
}

function parseAssistantResponse(raw: string) {
  const trimmed = raw.trim();
  // Handle markdown code fences if model wraps JSON
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = jsonMatch ? jsonMatch[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed.reply === "string") {
      return {
        reply: parsed.reply,
        cart_items: Array.isArray(parsed.cart_items) ? parsed.cart_items : [],
      };
    }
  } catch (_) {
    // fall through
  }
  return { reply: trimmed, cart_items: [] as unknown[] };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as {
      messages?: ChatMessage[];
      products?: ChatProduct[];
      lang?: string;
      catalog_version?: number;
    };

    const messages = body.messages || [];
    const clientProducts = body.products || [];
    const lang = body.lang || "en";

    // ALWAYS re-fetch from database on every request
    const dbProducts = await fetchLiveProductsFromDb();
    const products = dbProducts.length ? dbProducts : clientProducts;
    const fetchedAt = new Date().toISOString();

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const catalog = buildCatalogPrompt(products, lang, fetchedAt);
    const language = lang === "he" ? "Hebrew" : "English";
    const productNames = products.map((p) => p.name_en).join(", ");

    const systemPrompt = `You are the Gremier Coffee order assistant — friendly, concise, and sales-focused.

CRITICAL — CATALOG IS LIVE AND CHANGES OFTEN:
- The product list below was just fetched from the database at ${fetchedAt}.
- IGNORE anything you previously knew about Gremier products that is NOT in this list.
- If a customer asks about a product, only mention items that appear below.
- New products may have been added; removed products must not be offered.
- Current active products: ${productNames || "none loaded"}

RULES:
- Only recommend products from the catalog below. Never invent products, prices, or features.
- When adding to cart, use the exact product "id" from the catalog in cart_items.
- For coffee bar packages with guest tiers, explain tiers and use the product id.
- Keep replies short (2-4 sentences). Be warm but direct.
- Respond in ${language}.

${catalog}

Respond with JSON ONLY:
{"reply":"message to customer","cart_items":[{"id":"exact-id-from-catalog","qty":1}]}
Use cart_items:[] when not adding anything to cart.`;

    const openaiMessages = [
      { role: "system", content: systemPrompt },
      ...messages.slice(-12).map((m) => ({ role: m.role, content: m.content })),
    ];

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: openaiMessages,
        temperature: 0.3,
        max_tokens: 500,
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("OpenAI error:", errText);
      throw new Error("OpenAI request failed");
    }

    const aiData = await aiRes.json();
    const raw = aiData.choices?.[0]?.message?.content || "";
    const { reply, cart_items } = parseAssistantResponse(raw);

    return new Response(JSON.stringify({
      reply,
      cart_items,
      catalog_count: products.length,
      catalog_fetched_at: fetchedAt,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
