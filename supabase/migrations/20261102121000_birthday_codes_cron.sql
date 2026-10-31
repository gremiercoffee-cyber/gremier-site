-- Every morning (10:00 Israel, 07:00 UTC): birthday-month codes for anyone not sent one this year.
do $$
declare h text;
begin
  select substring(command from 'headers := ''([^'']*)''') into h from cron.job where jobname='gremier-job-reminders';
  if h is null then raise exception 'reminders cron header not found'; end if;
  perform cron.unschedule(jobname) from cron.job where jobname='gremier-birthday-codes';
  perform cron.schedule('gremier-birthday-codes','0 7 * * *',format(
    $f$select net.http_post(url := 'https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/birthday-codes',headers := %L::jsonb,body := '{}'::jsonb,timeout_milliseconds := 120000);$f$,h));
end $$;
