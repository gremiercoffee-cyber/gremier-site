-- Open loops: emails/WhatsApps that need a reply are filed silently and only nudge the user
-- once they've gone unanswered for a while (nudge_after, default created_at + 2h).
ALTER TABLE items ADD COLUMN nudge_after TEXT;
