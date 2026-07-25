-- Adjuntos en comunicados a propietarios (PDF comprobantes, etc.)
alter table owner_notifications add column if not exists attachments jsonb;
