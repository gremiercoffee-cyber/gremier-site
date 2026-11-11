# Store shopping route

The Store list uses shared/shopping-route.ts for deterministic read-time ordering and aisle headings. Other lists retain their original ordering. Checked purchases keep their existing 24-hour/archive sections and order. Nothing is rewritten or classified by AI when a list is read.

Route: spices/oatmeal; bread/pita/challah; fresh fish/chicken; produce; dairy/eggs/herring; refrigerated/frozen; dry goods including biscuits/canned crushed tomatoes/cereal bars/salt/sugar; cleaning; drinks/alcohol; pretzels/chips/snacks; home/baby/disposables/paper products. Unrecognized items remain visible under Other items at the end. Stable original order is retained within an aisle.

Explicit overrides: oatmeal with spices; herring with dairy; biscuits with dry goods; frozen fish/chicken with cold foods. English/Hebrew matching and item notes (Fish, notes frozen) are supported. This is a practical keyword catalog, not an AI guess; extend with tested aliases as needed.

worker/shopping.ts supplies the same ordered items to the app and internal assistant. The MCP get_shopping_lists read tool uses the same function and instructs the assistant to preserve the route. The existing authenticated agent API also exposes GET /api/agent/shopping, returning lists without WhatsApp setup details. No new OAuth scopes, write operations, schema migrations or cron tasks. ChatGPT may need Refresh tools to discover the added direct tool.

Tests: node --test tests/shopping*.test.mjs tests/chatgpt-relay.test.mjs
