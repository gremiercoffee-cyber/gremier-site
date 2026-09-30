-- Unpaid-order alerts (every 15 min) and the Sunday weekly summary (09:30 Israel).
-- Reuses the auth header of the existing reminders cron so no key is written here.
do $$
declare h text;
begin
  select substring(command from 'headers := ''([^'']*)''') into h from cron.job where jobname = 'gremier-job-reminders';
  if h is null then raise exception 'reminders cron header not found'; end if;
  perform cron.unschedule(jobname) from cron.job where jobname in ('gremier-unpaid-alerts', 'gremier-weekly-summary');
  perform cron.schedule('gremier-unpaid-alerts', '*/15 * * * *', format(
    $f$select net.http_post(url := 'https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/admin-tools', headers := %L::jsonb, body := '{"action":"unpaid_alerts"}'::jsonb);$f$, h));
  perform cron.schedule('gremier-weekly-summary', '30 6 * * 0', format(
    $f$select net.http_post(url := 'https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/admin-tools', headers := %L::jsonb, body := '{"action":"weekly_summary"}'::jsonb);$f$, h));
end $$;
