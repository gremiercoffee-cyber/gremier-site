-- Re-queue store deliveries that were incorrectly marked WhatsApp-sent (e.g. bulk wa_sent_at on 2026-06-10)
UPDATE jobs
SET wa_sent_at = NULL,
    wa_needs_send = TRUE
WHERE type = 'delivery'
  AND delivery_type = 'store'
  AND store_name IS NOT NULL
  AND done = TRUE
  AND date >= '2026-06-01';
