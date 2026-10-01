-- 030_properties_area_m2 — Área por unidad para repartir los costos del edificio por coeficiente
-- (coeficiente = área de la unidad ÷ área total de las unidades activas del mes).
-- Copia espejo en nok-hub/scripts/migration_properties_area_m2.sql. PENDIENTE de aplicar.

alter table public.properties add column if not exists area_m2 numeric(8,2);
comment on column public.properties.area_m2 is 'Área construida en m². Base del coeficiente de reparto de costos en edificios de un propietario (Wellness).';

-- Wellness: columnas 01 y 02 = 55 m², columnas 03 y 04 = 50 m² (dato de Santi, 2026-10-01).
-- Las unidades del piso 6 (601–604) se cargan cuando entren a Guesty desde nok-hub → Edificios → Configuración.
update public.properties set area_m2 = 55 where name ~ '^Wellness\s+\d?0?[12]\s*$' and area_m2 is null;
update public.properties set area_m2 = 50 where name ~ '^Wellness\s+\d?0?[34]\s*$' and area_m2 is null;
