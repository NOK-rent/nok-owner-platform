-- 025_rate_change_tracking: snapshots diarios de tarifas publicadas + eventos de cambio
create table if not exists public.rate_snapshots (
  property_id uuid primary key references public.properties(id) on delete cascade,
  prices jsonb not null,
  taken_at timestamptz not null default now()
);
create table if not exists public.rate_change_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  stay_date date not null,
  old_price numeric,
  new_price numeric not null,
  detected_at timestamptz not null default now()
);
create index if not exists rate_change_events_prop_idx on public.rate_change_events (property_id, detected_at desc);
alter table public.rate_snapshots enable row level security;
alter table public.rate_change_events enable row level security;
