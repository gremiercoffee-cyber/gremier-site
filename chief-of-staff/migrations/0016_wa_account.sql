-- Which WhatsApp a message came from (personal / business), set in the add-on's popup.
ALTER TABLE whatsapp_inbox ADD COLUMN account TEXT NOT NULL DEFAULT 'personal';
