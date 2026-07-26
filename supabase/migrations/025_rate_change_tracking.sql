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

-- ai_weekly_briefings: cache semanal del briefing generado por NOK AI
create table if not exists public.ai_weekly_briefings (
  property_id uuid not null references public.properties(id) on delete cascade,
  week_start date not null,
  locale text not null default 'es',
  content text not null,
  created_at timestamptz not null default now(),
  primary key (property_id, week_start, locale)
);
alter table public.ai_weekly_briefings enable row level security;
