-- 029_edificios — Portal de edificio (un propietario, N unidades) en NOK Owners
-- + carga de costos operativos con facturas desde nok-hub (/edificios).
-- Reutiliza building_pnl_configs / building_pnl_costs (Gardens, Ekkos) en la Supabase compartida.
-- Copia espejo en nok-hub/scripts/migration_edificios.sql. Escrita 2026-09-15 — PENDIENTE de aplicar
-- (correr completa en el SQL editor de qqtorevaoprloxnvabeh ANTES de desplegar nok-hub y nok-owner-platform).

-- ── Config del edificio ────────────────────────────────────────────────────
alter table public.building_pnl_configs
  add column if not exists owner_id uuid references public.owners(id) on delete set null,
  add column if not exists shared_emails text[] not null default '{}',
  add column if not exists start_month text,                                   -- 'YYYY-MM' primer mes reportado
  add column if not exists commission_threshold_cop numeric(14,0) not null default 0,
  add column if not exists commission_threshold_basis text not null default 'noi',
  add column if not exists city text,
  add column if not exists country text,
  add column if not exists slug text;

alter table public.building_pnl_configs drop constraint if exists building_pnl_configs_threshold_basis_chk;
alter table public.building_pnl_configs
  add constraint building_pnl_configs_threshold_basis_chk check (commission_threshold_basis in ('noi', 'gross'));
create unique index if not exists building_pnl_configs_slug_idx on public.building_pnl_configs (slug) where slug is not null;
create index if not exists building_pnl_configs_owner_idx on public.building_pnl_configs (owner_id);

comment on column public.building_pnl_configs.commission_threshold_cop is 'NOK no cobra comisión en un mes hasta que la base (noi|gross) de ese mes alcance este valor en COP. 0 = sin umbral.';

-- ── Costos del edificio (con facturas) ─────────────────────────────────────
alter table public.building_pnl_costs
  add column if not exists category text not null default 'otros',
  add column if not exists vendor text,
  add column if not exists invoice_date date,
  add column if not exists invoice_number text,
  add column if not exists attachments jsonb not null default '[]'::jsonb,     -- [{name,path,type,size}] en bucket privado soporte-adjuntos
  add column if not exists property_id uuid references public.properties(id) on delete set null,  -- opcional: costo de una unidad puntual
  add column if not exists created_by text;

create index if not exists building_pnl_costs_month_idx on public.building_pnl_costs (config_id, month);

-- Backfill de categoría para costos viejos que la codificaban en el nombre ([NOMINA]/[LIMPIEZA])
update public.building_pnl_costs
   set category = case
     when lower(name) like '%[nomina]%' or lower(name) like '%nomin%' or lower(name) like '%salari%' or lower(name) like '%sueldo%' then 'nomina'
     when lower(name) like '%[limpieza]%' or lower(name) like '%limpi%' or lower(name) like '%clean%' or lower(name) like '%aseo%' then 'limpieza'
     else 'otros' end
 where category = 'otros';

-- ── Chat NOK AI con contexto de edificio ───────────────────────────────────
alter table public.chat_messages alter column property_id drop not null;
alter table public.chat_messages add column if not exists building_id uuid references public.building_pnl_configs(id) on delete cascade;
create index if not exists chat_messages_building_idx on public.chat_messages (building_id, created_at);

-- ── Briefing semanal IA por edificio (cache) ───────────────────────────────
create table if not exists public.building_ai_briefings (
  config_id  uuid not null references public.building_pnl_configs(id) on delete cascade,
  week_start date not null,
  locale     text not null default 'es',
  content    text not null,
  created_at timestamptz not null default now(),
  primary key (config_id, week_start, locale)
);
alter table public.building_ai_briefings enable row level security;

-- ── Wellness (Bogotá, 20 unidades, nickname Guesty "Wellness NNN") ─────────
-- La fila base puede existir ya (seed por REST el 2026-09-15): se crea solo si falta
-- y luego se completan los campos nuevos.
insert into public.building_pnl_configs (name, property_ids, commission_rate_on_net, active)
select 'Wellness', array_agg(id order by name), 0, true
  from public.properties
 where name ilike 'Wellness %' and guesty_listing_id is not null
   and not exists (select 1 from public.building_pnl_configs where name = 'Wellness')
having count(*) > 0;   -- sin HAVING, un agregado vacío insertaría property_ids NULL y abortaría

update public.building_pnl_configs
   set start_month = coalesce(start_month, '2026-09'),
       commission_threshold_cop = case when commission_threshold_cop = 0 then 80000000 else commission_threshold_cop end,
       commission_threshold_basis = 'noi',
       city = coalesce(city, 'Bogotá'),
       country = coalesce(country, 'CO'),
       slug = coalesce(slug, 'wellness'),   -- slug = "habilitado en NOK Owners" (ver lib/edificio.ts isPortalEnabled)
       updated_at = now()
 where name = 'Wellness';

-- Gardens/Ekkos NO se habilitan en NOK Owners (sin slug): siguen en nok-special-properties.
-- Se les fija el mismo umbral que ya aplica allá (100M COP sobre ingreso bruto del mes) para que,
-- si algún día se habilitan, el cálculo no cambie de modelo en silencio.
update public.building_pnl_configs
   set commission_threshold_cop = 100000000, commission_threshold_basis = 'gross', updated_at = now()
 where name in ('Gardens', 'Ekkos') and commission_threshold_cop = 0;
