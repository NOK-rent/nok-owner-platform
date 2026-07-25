-- Idioma del owner + inspecciones/incidencias owner-facing (2026-07-25)

alter table owners add column if not exists locale text not null default 'es' check (locale in ('es','en'));

create table if not exists owner_work_items (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid not null references properties(id) on delete cascade,
  owner_id        uuid references owners(id) on delete set null,
  tipo            text not null check (tipo in ('inspeccion','incidencia')),
  titulo          text not null,
  descripcion     text,
  valor_usd       numeric(12,2),
  pdf_url         text,
  fotos           jsonb,
  status          text not null default 'enviada' check (status in ('enviada','aceptada','programada','completada')),
  fecha_programada date,
  aceptada_at     timestamptz,
  completada_at   timestamptz,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists owner_work_items_owner_idx on owner_work_items(owner_id);
create index if not exists owner_work_items_property_idx on owner_work_items(property_id);

alter table owner_work_items enable row level security;
drop policy if exists "service role full access" on owner_work_items;
create policy "service role full access" on owner_work_items
  for all to service_role using (true) with check (true);
