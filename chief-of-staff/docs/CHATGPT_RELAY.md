# Direct Chief of Staff tools in ChatGPT

The same MCP endpoint now exposes get_tasks, add_task, complete_task and defer_task. These use live Chief of Staff records directly; there is no Codex queue, second model call, or desktop requirement for these tools. The existing relay remains for asynchronous longer work.

New OAuth scopes: cos.tasks.read (compact task lists), cos.tasks.write (ordinary task changes). Existing cos.relay grants do not gain task access automatically. Refresh the custom connection’s tool list and reconnect/approve the requested scopes in ChatGPT. Authorization, PKCE, resource checks and revocation remain enforced. Each write requires a stable idempotency key; completion and deferral require the actual task ID and current title. No email sending, payments, general admin actions, or health records are exposed by these tools.

Verified in backend integration tests: direct task operations make zero provider/relay calls; old grants are denied; read-only grants cannot write; retries return stored receipts. Public discovery and authorization metadata are checked after deployment. A real Android power-button live-Voice tool call is NOT yet verified. Phone Work/plugin support does not establish that the live Voice shortcut exposes custom MCP tools. If that mode cannot invoke them, it is a ChatGPT client limitation; server changes alone cannot provide the missing access. Dictating into a supported normal ChatGPT/Work conversation is a separate path.

## Existing background relay

# Phone → ChatGPT → existing Chief of Staff chat

MCP endpoint: `https://chief-of-staff.gremiercoffee.workers.dev/api/mcp`.
Transport: stateless Streamable HTTP JSON responses. Authentication: OAuth authorization
code with S256 PKCE. A connection grants only `cos.relay`, not direct database,
settings, payment, email-send or arbitrary tool access. No owner/agent key is shared
with ChatGPT. Access tokens expire after one hour; refresh tokens rotate and expire
after 30 days. Revocation invalidates the whole grant. Already delivered requests
cannot be recalled by disconnecting.

The existing chat is fixed server-side to `01a14e9f-dfd2-7901-8e50-d3f7f93959c6`.
There is no new coach, model selection, `thread/start`, or fresh agent conversation.
The tools send an owner request and poll its result. `queued`, `claimed`, `submitted`,
`uncertain`, `needs_user`, `failed`, and `done` are distinct. Only the main chat's
explicit response receipt marks a request done. A receipt is the chat's answer,
not independent proof of any business action; the chat still verifies action tools.

## Account connection

In ChatGPT Plugins, add a custom MCP server with the endpoint above, choose OAuth,
and create it as a private/personal plugin. Review discovered tools, install and
connect. The owner consent page reuses the Chief of Staff browser sign-in
(`cos.token`); otherwise the owner must sign in. Helpers must not type passcodes.
This cannot be installed into the owner's ChatGPT account through the CoS API.

The server supports public DCR limited to exact ChatGPT callback patterns and a
predefined stable ChatGPT client. It requires the resource parameter to exactly
match the MCP endpoint. All redirects are validated before returning them.
Owner-only `GET /api/mcp/connections` lists grants; owner-only DELETE with `{id}`
revokes one. These routes require the original owner bearer and are not MCP tools.

Official setup references:
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://developers.openai.com/plugins/build/auth
- https://learn.chatgpt.com/docs/developer-commands (`codex queue`)

## Local adapter

`node runner/chief-chat-relay.mjs` polls every 15 seconds. It reads the existing
agent key from the private token file or COS_AGENT_KEY and runs only the documented
`codex queue --thread <fixed-id> --message <owner-request>` command. It does not
change the model, launch a second agent, force resume a writer-locked chat, or
approve a sensitive action. It stores local delivery receipts under `.local/relay-claims`.
`--once` performs one poll for safe diagnostics.

The prompt asks the existing main chat to save its concise answer to a local file
and run `node runner/relay-response.mjs <id> done <absolute-answer-file>` from this
repository. Use `needs_user` to return a concrete approval question or missing input.
The claim is read locally, never embedded in the model prompt. The server checks
the authenticated agent and claim before accepting a response. Retry-safe request
keys prevent duplicate submissions; expired claims become uncertain and are never
automatically replayed. Only one submitted/claimed request can be outstanding.

## Verification limits

The current desktop chat was identified read-only through App Server. A separate
App Server safely refused `thread/resume` with "already has an active writer".
The local desktop control socket was unavailable. The documented CLI queue accepted
a harmless marker for the exact chat, but queue acceptance alone is NOT proof that
the desktop automatically wakes and executes it. Do not advertise instant replies,
working phone voice, or automatic same-chat routing until a main-chat response
receipt has been observed end to end. The adapter status reports this limitation.

Connection to ChatGPT, mobile plugin availability, and power-button voice tool use
must each be tested on the owner's actual account/device. Never infer one from the
other. No scheduled AI polling has been enabled as a workaround.
