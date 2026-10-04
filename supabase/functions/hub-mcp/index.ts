// supabase/functions/hub-mcp/index.ts
// Gremier Hub as an MCP server (Streamable HTTP, stateless JSON responses) so a Claude-based
// assistant gets the Hub API actions as tools. Same keys, scopes and activity log as hub-api.
//
// Connect:  URL  https://<project>.supabase.co/functions/v1/hub-mcp
//           Auth Authorization: Bearer ghk_…   (or ?key=ghk_… for clients that can't send headers)
// Docs:     docs/HUB_API.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ACTIONS, authenticateKey, getServiceRoleKey, HubError, runAction } from "../_shared/hub-actions.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const SCHEMAS: Record<string, { properties: Record<string, unknown>; required?: string[] }> = {
  summary: { properties: {} },
  schedule: { properties: { from: str("YYYY-MM-DD, default today"), to: str("YYYY-MM-DD, default = from"), include_done: { type: "boolean" } } },
  orders: { properties: { status: { type: "string", enum: ["to_fulfil", "unpaid"], description: "Omit for the latest orders" }, limit: num("Max 100") } },
  stock: { properties: {} },
  stores: { properties: {} },
  activity: { properties: { since: str("ISO timestamp"), limit: num("Max 200") } },
  start_brew: { properties: { product: { type: "string", enum: ["classic", "houseBlend", "colombia", "decaf"] }, kg: { type: "number", enum: [1, 1.5, 2, 3] } }, required: ["product"] },
  complete_drain: { properties: { job_id: str("Drain job id (from schedule)"), product: str("Or: complete the earliest pending drain of this coffee") } },
  log_store_delivery: { properties: { store: str("Store name (fuzzy match)"), quantities: { type: "object", additionalProperties: { type: "integer" }, description: "product_key → bottles, e.g. {\"classic_liter\": 6, \"vanilla_mini\": 4}" }, date: str("YYYY-MM-DD, default today") }, required: ["store", "quantities"] },
  complete_delivery: { properties: { job_id: str("Delivery job id; default = next one due today/overdue"), quantities: { type: "object", additionalProperties: { type: "integer" }, description: "Actual amounts if different from planned" } } },
  adjust_stock: { properties: { kind: { type: "string", enum: ["inventory", "concentrate", "beans", "labeled"] }, product: str("Product key, or coffee type for concentrate/beans"), delta: num("+/- amount (bottles, liters or kg)") }, required: ["kind", "product", "delta"] },
  log_note: { properties: { text: str("What to record in the timeline") }, required: ["text"] },
};

function rpc(id: unknown, result: unknown) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id: unknown, code: number, message: string) { return { jsonrpc: "2.0", id, error: { code, message } }; }
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { ...cors, Allow: "POST" } });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, getServiceRoleKey());
  const key = ((req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "") || new URL(req.url).searchParams.get("key") || "").trim();
  const app = await authenticateKey(sb, key);
  if (!app) return respond(rpcError(null, -32001, "Invalid or missing Gremier Hub key"), 401);

  let msg: Record<string, unknown>;
  try { msg = await req.json(); } catch { return respond(rpcError(null, -32700, "Parse error"), 400); }
  const id = msg.id;
  const method = String(msg.method || "");
  // Notifications (no id) just get acknowledged.
  if (id === undefined || id === null) return new Response(null, { status: 202, headers: cors });

  switch (method) {
    case "initialize":
      return respond(rpc(id, {
        protocolVersion: String((msg.params as any)?.protocolVersion || "2025-06-18"),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "gremier-hub", version: "1.0.0" },
        instructions: "Gremier Coffee operations (cold brew business in Israel): schedule of brews/drains/deliveries, website orders, stock, stores, and an activity timeline. Call summary first for today's picture. Writes change real stock and billing — confirm amounts with the user before logging.",
      }));
    case "ping":
      return respond(rpc(id, {}));
    case "tools/list": {
      const tools = Object.entries(ACTIONS)
        .filter(([name, h]) => name !== "widget_config" && app.scopes.includes(h.scope))
        .map(([name, h]) => ({
          name,
          description: h.describe,
          inputSchema: { type: "object", ...(SCHEMAS[name] || { properties: {} }) },
          annotations: { readOnlyHint: h.scope === "read", destructiveHint: false },
        }));
      return respond(rpc(id, { tools }));
    }
    case "tools/call": {
      const p = (msg.params || {}) as { name?: string; arguments?: Record<string, unknown> };
      try {
        const result = await runAction(sb, app, String(p.name || ""), p.arguments || {});
        return respond(rpc(id, { content: [{ type: "text", text: JSON.stringify(result, null, 1) }] }));
      } catch (e) {
        const text = e instanceof HubError ? `${e.code}: ${e.message}` : "Server error";
        if (!(e instanceof HubError)) console.error("hub-mcp tool error:", p.name, e);
        return respond(rpc(id, { content: [{ type: "text", text }], isError: true }));
      }
    }
    default:
      return respond(rpcError(id, -32601, `Method not found: ${method}`));
  }
});
