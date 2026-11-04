-- Cover the filters used by frequent reads and sync-window replacement.
CREATE INDEX IF NOT EXISTS items_project_status ON items(project_id,status);
CREATE INDEX IF NOT EXISTS items_status ON items(status);
CREATE INDEX IF NOT EXISTS daynote_updated ON daynote_measurements(updated_at);
CREATE INDEX IF NOT EXISTS daynote_type_date ON daynote_measurements(type,date,id);
CREATE INDEX IF NOT EXISTS daynote_type_start ON daynote_measurements(type,start_at);
CREATE INDEX IF NOT EXISTS daynote_type_end ON daynote_measurements(type,end_at);
CREATE INDEX IF NOT EXISTS whatsapp_account_chat ON whatsapp_inbox(account,chat);
CREATE INDEX IF NOT EXISTS whatsapp_reply_item ON whatsapp_inbox(item_id) WHERE reply_ids!='[]';
CREATE INDEX IF NOT EXISTS daynote_ai_expiry ON daynote_ai_requests(state,expires_at);
CREATE INDEX IF NOT EXISTS daynote_ai_created ON daynote_ai_requests(created_at);
