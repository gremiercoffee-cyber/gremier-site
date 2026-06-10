-- Store-only WhatsApp drawer: clear mistaken private flags, backfill last 2 store deliveries
UPDATE jobs SET wa_needs_send = false
WHERE type = 'delivery' AND COALESCE(delivery_type, '') <> 'store';

UPDATE jobs j SET wa_needs_send = true
FROM (
  SELECT id FROM jobs
  WHERE type = 'delivery'
    AND delivery_type = 'store'
    AND done = true
    AND store_name IS NOT NULL
    AND COALESCE(wa_needs_send, false) = false
  ORDER BY date DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 2
) sub
WHERE j.id = sub.id;
