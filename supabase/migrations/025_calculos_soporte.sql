-- Feature Cálculos + Soporte bidireccional (2026-07-24)

-- 1. Nuevas categorías de gastos propios del owner: administración y banco
alter table owner_costs drop constraint if exists owner_costs_category_check;
alter table owner_costs add constraint owner_costs_category_check
  check (category in ('mortgage','maintenance','utilities','insurance','hoa','property_tax','admin','bank','other'));

-- 2. Bucket público para adjuntos de tickets de soporte (PDF / imágenes)
insert into storage.buckets (id, name, public)
values ('soporte-adjuntos', 'soporte-adjuntos', true)
on conflict (id) do nothing;

-- Escritura solo via service role (las APIs suben con service client); lectura pública por URL
drop policy if exists "soporte adjuntos public read" on storage.objects;
create policy "soporte adjuntos public read"
  on storage.objects for select
  using (bucket_id = 'soporte-adjuntos');
