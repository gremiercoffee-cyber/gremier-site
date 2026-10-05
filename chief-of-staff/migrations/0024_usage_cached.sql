-- How much of each request OpenAI served from its prompt cache (billed ~90% cheaper).
ALTER TABLE usage_log ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0;
