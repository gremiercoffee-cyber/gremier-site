-- One live brief, immutable versions, and source revisions shared by app, Telegram and workers.
ALTER TABLE jobs ADD COLUMN context_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE jobs ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE job_runs ADD COLUMN context_revision INTEGER;
CREATE TABLE job_briefs (
 job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
 source_revision INTEGER NOT NULL, document TEXT NOT NULL, updated_at TEXT NOT NULL,
 telegram_message_id INTEGER, telegram_revision INTEGER NOT NULL DEFAULT 0,
 telegram_error TEXT, telegram_lease_until TEXT, lease_until TEXT, retry_after TEXT
);
CREATE TABLE job_brief_versions (
 job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 source_revision INTEGER NOT NULL, document TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(job_id,source_revision)
);
CREATE TRIGGER job_brief_job_change AFTER UPDATE OF title,instructions,status,project_id ON jobs
WHEN OLD.title IS NOT NEW.title OR OLD.instructions IS NOT NEW.instructions OR OLD.status IS NOT NEW.status OR OLD.project_id IS NOT NEW.project_id
BEGIN UPDATE jobs SET context_revision=context_revision+1 WHERE id=NEW.id OR project_id=NEW.project_id OR project_id=OLD.project_id; END;
CREATE TRIGGER job_brief_user_message AFTER INSERT ON job_messages WHEN NEW.role='you'
BEGIN UPDATE jobs SET context_revision=context_revision+1 WHERE id=NEW.job_id OR project_id=(SELECT project_id FROM jobs WHERE id=NEW.job_id); END;
CREATE TRIGGER job_brief_run_result AFTER UPDATE OF result,error ON job_runs
WHEN OLD.result IS NOT NEW.result OR OLD.error IS NOT NEW.error
BEGIN UPDATE jobs SET context_revision=context_revision+1 WHERE id=NEW.job_id OR project_id=(SELECT project_id FROM jobs WHERE id=NEW.job_id); END;
CREATE TRIGGER job_brief_email_insert AFTER INSERT ON job_emails
BEGIN UPDATE jobs SET context_revision=context_revision+1 WHERE id=NEW.job_id OR project_id=(SELECT project_id FROM jobs WHERE id=NEW.job_id); END;
CREATE TRIGGER job_brief_email_change AFTER UPDATE OF status,body,subject,to_email,reply_text,error ON job_emails
WHEN OLD.status IS NOT NEW.status OR OLD.body IS NOT NEW.body OR OLD.subject IS NOT NEW.subject OR OLD.to_email IS NOT NEW.to_email OR OLD.reply_text IS NOT NEW.reply_text OR OLD.error IS NOT NEW.error
BEGIN UPDATE jobs SET context_revision=context_revision+1 WHERE id=NEW.job_id OR project_id=(SELECT project_id FROM jobs WHERE id=NEW.job_id); END;
CREATE TRIGGER job_brief_email_delete AFTER DELETE ON job_emails
BEGIN UPDATE jobs SET context_revision=context_revision+1 WHERE id=OLD.job_id OR project_id=(SELECT project_id FROM jobs WHERE id=OLD.job_id); END;

ALTER TABLE job_emails ADD COLUMN message_id TEXT;
