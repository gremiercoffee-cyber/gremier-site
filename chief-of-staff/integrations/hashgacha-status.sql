-- Applied to the Hashgacha Supabase project. Metadata only: never returns ratings,
-- notes, student identities, report-link tokens, or any ability to write reports.
create table if not exists public.cos_integration_keys (
 name text primary key, key_hash text not null check(length(key_hash)=64)
);
alter table public.cos_integration_keys enable row level security;
revoke all on public.cos_integration_keys from public,anon,authenticated;
create or replace function public.cos_hashgacha_status(access_key text,week_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if access_key is null or length(access_key)<32 or not exists(
  select 1 from public.cos_integration_keys k where k.name='chief-of-staff'
  and k.key_hash=encode(sha256(convert_to(access_key,'UTF8')),'hex')
 ) then raise exception 'Invalid integration key' using errcode='42501'; end if;
 if week_date is null or extract(dow from week_date)<>0 then raise exception 'Supply the Sunday reporting-week date'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.class_id) from (
  select c.id as class_id,c.name as class_name,c.rabbi_name,c.rabbi_email,c.seder::text,
   week_date as week_of,count(s.id)::integer as expected,
   (count(r.rabbi_submitted_at) filter(where r.rabbi_rating is not null))::integer as submitted,
   max(r.rabbi_submitted_at) as last_submission
  from public.night_classes c
  left join public.enrollment e on e.shiur_id=c.id and e.seder=c.seder
  left join public.students s on s.id=e.student_id and s.active
  left join public.weekly_reports r on r.student_id=s.id and r.seder=c.seder and r.week_of=week_date
  where c.active and not c.is_chavrusa and exists(
   select 1 from public.report_links l where l.class_id=c.id and l.week_of=week_date
  ) group by c.id
 ) x),'[]'::jsonb);
end;$$;
revoke all on function public.cos_hashgacha_status(text,date) from public;
grant execute on function public.cos_hashgacha_status(text,date) to anon,authenticated;
notify pgrst, 'reload schema';
