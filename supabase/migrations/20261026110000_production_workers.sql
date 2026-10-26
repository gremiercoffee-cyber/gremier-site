begin;
create table public.production_shifts (
 id uuid primary key default gen_random_uuid(),worker_id uuid references public.workers(id) on delete restrict,
 is_owner boolean not null default false,started_at timestamptz not null default now(),ended_at timestamptz,
 rate_snapshot numeric not null default 0,created_by uuid default auth.uid(),
 check ((worker_id is not null) <> is_owner),check(ended_at is null or ended_at>started_at)
);
create unique index production_worker_open_shift on public.production_shifts(worker_id) where ended_at is null and worker_id is not null;
create unique index production_owner_open_shift on public.production_shifts(is_owner) where ended_at is null and is_owner;
alter table public.worker_entries add column production_shift_id uuid unique references public.production_shifts(id) on delete restrict;
create table public.production_entries (
 id uuid primary key default gen_random_uuid(),ref text not null,product text not null,kind text not null,
 units numeric not null,unit text not null,worker_id uuid references public.workers(id) on delete restrict,
 is_owner boolean not null default false,shift_id uuid references public.production_shifts(id) on delete restrict,
 source text not null default 'Admin',note text not null default '',created_at timestamptz not null default now(),
 voided boolean not null default false,updated_at timestamptz not null default now(),unique(ref,product,kind),check(not(is_owner and worker_id is not null))
);
create table public.production_entry_edits (
 id bigint generated always as identity primary key,entry_id uuid not null references public.production_entries(id),
 before_value jsonb not null,after_value jsonb not null,changed_at timestamptz not null default now(),changed_by uuid default auth.uid()
);
alter table public.production_shifts enable row level security;
alter table public.production_entries enable row level security;
alter table public.production_entry_edits enable row level security;
revoke all on public.production_shifts,public.production_entries,public.production_entry_edits from anon,authenticated;
grant select on public.production_shifts,public.production_entries,public.production_entry_edits to authenticated;
create policy production_shifts_read on public.production_shifts for select to authenticated using(public.is_gremier_admin());
create policy production_entries_read on public.production_entries for select to authenticated using(public.is_gremier_admin());
create policy production_edits_read on public.production_entry_edits for select to authenticated using(public.is_gremier_admin());

create function public.production_clock(p_worker text,p_operation text,p_id uuid default gen_random_uuid()) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s production_shifts;w workers;owner boolean:=p_worker='owner';wid uuid;finished timestamptz:=now();h numeric;
begin
 if not(public.is_gremier_admin() or auth.role()='service_role') then raise exception 'Admin access required';end if;
 if p_worker is null or p_worker='' then raise exception 'Choose who is working';end if;
 if not owner then wid:=p_worker::uuid;select * into w from workers where id=wid and (is_active or p_operation='out');if not found then raise exception 'Worker is inactive or missing';end if;end if;
 perform pg_advisory_xact_lock(hashtextextended('production-clock',0));
 if p_operation='in' then
  select * into s from production_shifts where id=p_id;
  if found then
   if s.worker_id is distinct from wid or s.is_owner<>owner then raise exception 'Clock request belongs to another worker';end if;
   return to_jsonb(s);
  end if;
  select * into s from production_shifts where worker_id is not distinct from wid and is_owner=owner and ended_at is null;
  if found then return to_jsonb(s);end if;
  insert into production_shifts(id,worker_id,is_owner,rate_snapshot) values(p_id,wid,owner,coalesce(w.hourly_rate,0)) returning * into s;
 elsif p_operation='out' then
  select * into s from production_shifts where id=p_id for update;
  if not found or s.worker_id is distinct from wid or s.is_owner<>owner then raise exception 'Shift does not match worker';end if;
  if s.ended_at is not null then return to_jsonb(s);end if;
  if finished<=s.started_at then finished:=s.started_at+interval '1 second';end if;
  update production_shifts set ended_at=finished where id=s.id returning * into s;
  h:=extract(epoch from (s.ended_at-s.started_at))/3600;
  if wid is not null then
   perform set_config('gremier.production_payroll','yes',true);
   insert into worker_entries(worker_id,kind,entry_date,start_time,end_time,hours,rate_snapshot,amount,note,production_shift_id)
    values(wid,'work',(s.started_at at time zone 'Asia/Jerusalem')::date,(s.started_at at time zone 'Asia/Jerusalem')::time,
    (s.ended_at at time zone 'Asia/Jerusalem')::time,h,s.rate_snapshot,round(h*s.rate_snapshot,2),'Production kiosk shift',s.id)
    on conflict(production_shift_id) do nothing;
  end if;
 else raise exception 'Unknown clock operation';end if;
 return to_jsonb(s);
end $$;

-- Capture the worker inside the same transaction that changes stock. Legacy paths stay unassigned.
create function public.capture_production_entry() returns trigger
language plpgsql security definer set search_path=public as $$
declare identity text:=nullif(current_setting('gremier.production_worker',true),'');sid uuid:=nullif(current_setting('gremier.production_shift',true),'')::uuid;
begin
 if new.kind='bottling_reversed' then update production_entries set voided=true,updated_at=now() where ref=new.ref and product=new.product and kind='bottling';return new;end if;
 if new.kind in ('brew','drain','bottling','labeling') or (new.kind='delivery' and new.inferred_units>0) then
  insert into production_entries(ref,product,kind,units,unit,worker_id,is_owner,shift_id,source,created_at)
  values(new.ref,case when new.kind='brew' then coalesce((select product from jobs where id=new.ref),new.product) else new.product end,new.kind,case when new.kind='delivery' then new.inferred_units when new.kind='drain' then abs(new.concentrate_used_l) else new.units end,
   case when new.kind='brew' then 'kg' when new.kind='drain' then 'L' else 'units' end,
   case when identity is not null and identity<>'owner' then identity::uuid end,identity is not null and identity='owner',sid,
   coalesce(nullif(current_setting('gremier.production_source',true),''),'Admin'),new.created_at) on conflict do nothing;
 end if;return new;
end $$;
create trigger capture_production_entry after insert on public.production_stock_events for each row execute function public.capture_production_entry();
insert into production_entries(ref,product,kind,units,unit,created_at,source)
 select ref,case when kind='brew' then coalesce((select product from jobs where id=e.ref),product) else product end,kind,case when kind='delivery' then inferred_units when kind='drain' then abs(concentrate_used_l) else units end,
 case when kind='brew' then 'kg' when kind='drain' then 'L' else 'units' end,created_at,'Earlier record'
 from production_stock_events e where kind in ('brew','drain','bottling','labeling') or (kind='delivery' and inferred_units>0) on conflict do nothing;

update production_entries e set voided=true where kind='bottling' and exists(select 1 from production_stock_events x where x.ref=e.ref and x.product=e.product and x.kind='bottling_reversed');

create function public.production_execute(p_action text,p_args jsonb,p_worker text,p_shift uuid default null,p_source text default 'Admin') returns jsonb
language plpgsql security definer set search_path=public as $$
declare s production_shifts;result jsonb;
begin
 if not(public.is_gremier_admin() or auth.role()='service_role') then raise exception 'Admin access required';end if;
 if p_worker is null or p_worker='' then raise exception 'Choose who performed this work';end if;
 if p_worker<>'owner' and not exists(select 1 from workers where id=p_worker::uuid and is_active) then raise exception 'Worker is inactive or missing';end if;
 if p_shift is not null then
  select * into s from production_shifts where id=p_shift for update;
  if not found or s.ended_at is not null or (p_worker='owner' and not s.is_owner) or (p_worker<>'owner' and s.worker_id is distinct from p_worker::uuid) then raise exception 'Shift ended or belongs to another worker. Choose who is working again.';end if;
 end if;
 perform set_config('gremier.production_worker',p_worker,true);
 perform set_config('gremier.production_shift',coalesce(p_shift::text,''),true);
 perform set_config('gremier.production_source',left(p_source,80),true);
 case p_action
 when 'start_production_brew' then result:=start_production_brew(p_args->>'p_id',p_args->>'p_product',(p_args->>'p_kg')::numeric);
 when 'complete_production_drain' then result:=complete_production_drain(p_args->>'p_id');
 when 'complete_bottling' then result:=complete_bottling(p_args->'p_job',case when p_args ? 'p_labeled' and p_args->'p_labeled'<>'null'::jsonb then p_args->'p_labeled' else null end);
 when 'complete_labeling' then result:=complete_labeling(p_args->>'p_id',p_args->>'p_product',(p_args->>'p_units')::numeric);
 else raise exception 'Unsupported production action';end case;
 return result;
end $$;

create function public.edit_production_entry(p_id uuid,p_worker text,p_note text) returns void
language plpgsql security definer set search_path=public as $$
declare old production_entries;updated production_entries;wid uuid;
begin
 if not public.is_gremier_admin() then raise exception 'Admin access required';end if;
 if p_worker is null or p_worker='' then raise exception 'Choose who performed this work';end if;
 if p_worker<>'owner' then wid:=p_worker::uuid;if not exists(select 1 from workers where id=wid) then raise exception 'Worker missing';end if;end if;
 select * into old from production_entries where id=p_id for update;if not found then raise exception 'Entry missing';end if;
 update production_entries set worker_id=wid,is_owner=p_worker='owner',note=left(coalesce(p_note,''),1000),
 shift_id=case when worker_id is not distinct from wid and is_owner=(p_worker='owner') then shift_id else null end,updated_at=now() where id=p_id returning * into updated;
 insert into production_entry_edits(entry_id,before_value,after_value) values(p_id,to_jsonb(old),to_jsonb(updated));
end $$;

create function public.correct_production_shift(p_id uuid,p_start timestamptz,p_end timestamptz) returns void
language plpgsql security definer set search_path=public as $$
declare s production_shifts;h numeric;
begin
 if not public.is_gremier_admin() then raise exception 'Admin access required';end if;
 perform pg_advisory_xact_lock(hashtextextended('production-clock',0));
 select * into s from production_shifts where id=p_id for update;
 if not found or p_start is null or p_end is null or p_end<=p_start or p_end>now() then raise exception 'Enter valid past start and end times';end if;
 if exists(select 1 from production_shifts x where x.id<>p_id and x.worker_id is not distinct from s.worker_id and x.is_owner=s.is_owner and tstzrange(x.started_at,x.ended_at,'[)')&&tstzrange(p_start,p_end,'[)')) then raise exception 'This overlaps another shift';end if;
 update production_shifts set started_at=p_start,ended_at=p_end where id=p_id;
 h:=extract(epoch from(p_end-p_start))/3600;
 if s.worker_id is not null then
  perform set_config('gremier.production_payroll','yes',true);
  insert into worker_entries(worker_id,kind,entry_date,start_time,end_time,hours,rate_snapshot,amount,note,production_shift_id)
  values(s.worker_id,'work',(p_start at time zone 'Asia/Jerusalem')::date,(p_start at time zone 'Asia/Jerusalem')::time,(p_end at time zone 'Asia/Jerusalem')::time,h,s.rate_snapshot,round(h*s.rate_snapshot,2),'Corrected production shift',s.id)
  on conflict(production_shift_id) do update set entry_date=excluded.entry_date,start_time=excluded.start_time,end_time=excluded.end_time,hours=excluded.hours,amount=excluded.amount,note=excluded.note;
 end if;
 perform log_activity('admin','production.shift.corrected','Corrected production shift',p_id::text,jsonb_build_object('before',to_jsonb(s),'start',p_start,'end',p_end));
end $$;
create function public.protect_shift_payroll() returns trigger
language plpgsql set search_path=public as $$
begin
 if old.production_shift_id is not null and coalesce(current_setting('gremier.production_payroll',true),'')<>'yes' then raise exception 'Correct the production shift times instead of changing its pay entry';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger protect_shift_payroll before update or delete on public.worker_entries for each row execute function public.protect_shift_payroll();
revoke all on function public.production_clock(text,text,uuid),public.production_execute(text,jsonb,text,uuid,text),public.edit_production_entry(uuid,text,text),public.correct_production_shift(uuid,timestamptz,timestamptz),public.capture_production_entry() from public,anon;
grant execute on function public.production_clock(text,text,uuid),public.production_execute(text,jsonb,text,uuid,text) to authenticated,service_role;
grant execute on function public.edit_production_entry(uuid,text,text),public.correct_production_shift(uuid,timestamptz,timestamptz) to authenticated;
commit;
