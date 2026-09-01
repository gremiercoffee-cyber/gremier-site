-- Worker pay tracking: who works for you, at what rate, hours logged and
-- payments made, so the outstanding balance per worker is always known.
create table if not exists workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hourly_rate numeric not null default 0,
  phone text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists worker_entries (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  -- 'work' = hours worked (adds to what is owed); 'payment' = money paid out
  kind text not null check (kind in ('work', 'payment')),
  entry_date date not null,
  start_time time,
  end_time time,
  hours numeric,
  -- rate captured when the work was logged, so later rate changes don't rewrite history
  rate_snapshot numeric,
  amount numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists worker_entries_worker_idx on worker_entries (worker_id, entry_date desc);

alter table workers enable row level security;
alter table worker_entries enable row level security;

-- Admin-only: any signed-in admin can manage workers and their entries.
drop policy if exists workers_all on workers;
create policy workers_all on workers
  for all to authenticated using (true) with check (true);

drop policy if exists worker_entries_all on worker_entries;
create policy worker_entries_all on worker_entries
  for all to authenticated using (true) with check (true);
