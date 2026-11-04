-- Which plan handled a ChatGPT relay request: NULL/codex = the Codex desktop chat, claude = the Claude routine backup.
ALTER TABLE cos_relay_requests ADD COLUMN engine TEXT;
