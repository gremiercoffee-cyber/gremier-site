-- Daily (07:00 Israel): resume subscriptions whose pause ends tomorrow, so PayMe charges on the billing day.
-- Reuses the auth header of the existing reminders cron so no key is written here.
do $$
declare h text;
begin
  select substring(command from 'headers := ''([^'']*)''') into h from cron.job where jobname = 'gremier-job-reminders';
  if h is null then raise exception 'reminders cron header not found'; end if;
  perform cron.unschedule(jobname) from cron.job where jobname = 'gremier-subscription-resume';
  perform cron.schedule('gremier-subscription-resume', '0 4 * * *', format(
    $f$select net.http_post(url := 'https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/admin-tools', headers := %L::jsonb, body := '{"action":"subscription_resume_due"}'::jsonb);$f$, h));
end $$;
