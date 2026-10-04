// supabase/functions/hub-mcp/index.ts
// Gremier Hub as an MCP server (Streamable HTTP, stateless JSON responses) so a Claude-based
// assistant gets the Hub API actions as tools. Same keys, scopes and activity log as hub-api.
//
// Connect:  URL  https://<project>.supabase.co/functions/v1/hub-mcp
//           Auth Authorization: Bearer ghk_…   (or ?key=ghk_… for clients that can't send headers)
// Docs:     docs/HUB_API.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ACTIONS, authenticateKey, getServiceRoleKey, HubError, runAction, SCHEMAS } from "../_shared/hub-actions.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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
