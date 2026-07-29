-- Bloqueos de calendario hechos por el propietario desde el portal (2026-07-26)
create table if not exists owner_calendar_blocks (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id) on delete cascade,
  owner_id      uuid references owners(id) on delete set null,
  guesty_listing_id text not null,
  start_date    date not null,
  end_date      date not null,           -- inclusive (última noche bloqueada)
  para          text not null check (para in ('propietario','familiar')),
  huesped_nombre text,                    -- opcional: nombre de quien se queda
  hora_llegada  text,                     -- "HH:mm"
  hora_salida   text,                     -- "HH:mm"
  estado        text not null default 'activo' check (estado in ('activo','cancelado')),
  guesty_ok     boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists ocb_property_idx on owner_calendar_blocks(property_id);
create index if not exists ocb_owner_idx on owner_calendar_blocks(owner_id);
alter table owner_calendar_blocks enable row level security;
drop policy if exists "service role all ocb" on owner_calendar_blocks;
create policy "service role all ocb" on owner_calendar_blocks for all to service_role using (true) with check (true);
