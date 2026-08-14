import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // ── TRANSCRIBE (multipart audio) ──────────────────────────────────────
    if (action === "transcribe") {
      const formData = await req.formData();
      const upstream = new FormData();
      upstream.append("file", formData.get("file") as File);
      upstream.append("model", "whisper-1");
      upstream.append("language", "en");
      const prompt = formData.get("prompt");
      if (prompt) upstream.append("prompt", prompt as string);

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_KEY}` },
        body: upstream,
      });
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── PARSE INTENT (GPT-4o chat) ────────────────────────────────────────
    if (action === "parse_intent") {
      const body = await req.json();
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify(body), // pass through the whole payload
      });
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

// ── SMART ALERTS (OpenAI gpt-5.6-luna) ────────────────────────────────
    if (action === "smart_alerts") {
      const { snapshot, system } = await req.json();
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          max_completion_tokens: 2000,
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(snapshot) },
          ],
        }),
      });
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});