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
};

type ChatMessage = { role: string; content: string };

function buildCatalogPrompt(products: ChatProduct[], lang: string) {
  if (!products.length) {
    return "No product catalog was provided. Ask the customer to browse the shop.";
  }

  const lines = products.map((p) => {
    const name = lang === "he" && p.name_he ? p.name_he : p.name_en;
    const desc = lang === "he" && p.description_he ? p.description_he : (p.description_en || "");
    let line = `- id: "${p.id}" | ${name} | ₪${p.price}`;
    if (p.category) line += ` | category: ${p.category}`;
    if (p.badge_text) line += ` | badge: ${p.badge_text}`;
    if (desc) line += ` | ${desc}`;
    if (p.guest_pricing?.length) {
      line += ` | guest pricing: ${p.guest_pricing.map((g) => `${g.label} ₪${g.price}`).join(", ")}`;
    }
    return line;
  });

  return lines.join("\n");
}

function parseAssistantResponse(raw: string) {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed.reply === "string") {
      return {
        reply: parsed.reply,
        cart_items: Array.isArray(parsed.cart_items) ? parsed.cart_items : [],
      };
    }
  } catch (_) {
    // fall through — treat as plain text
  }
  return { reply: trimmed, cart_items: [] as unknown[] };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { messages = [], products = [], lang = "en" } = await req.json() as {
      messages: ChatMessage[];
      products: ChatProduct[];
      lang?: string;
    };

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const catalog = buildCatalogPrompt(products, lang);
    const language = lang === "he" ? "Hebrew" : "English";

    const systemPrompt = `You are the Gremier Coffee order assistant — friendly, concise, and sales-focused.
You help customers choose and order cold brew products and coffee bar packages for events.

IMPORTANT RULES:
- Only recommend products from the catalog below. Never invent products, prices, or features.
- If the catalog changed since the last message, trust this catalog as the single source of truth.
- When the customer wants to add something to cart, include cart_items using the exact product "id" from the catalog.
- For coffee bar packages with guest pricing tiers, mention the tiers and use the base id; the site handles tier selection at checkout.
- Keep replies short (2-4 sentences). Be warm but direct.
- Respond in ${language}.

CURRENT LIVE PRODUCT CATALOG:
${catalog}

When you want to add items to cart, respond with JSON ONLY in this shape:
{"reply":"your message to the customer","cart_items":[{"id":"exact-id-from-catalog","qty":1}]}

When NOT adding to cart, respond with JSON ONLY:
{"reply":"your message","cart_items":[]}`;

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
        temperature: 0.4,
        max_tokens: 500,
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

    return new Response(JSON.stringify({ reply, cart_items }), {
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
