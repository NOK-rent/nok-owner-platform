-- NOK Owner AI — Knowledge Base
-- Curated, admin-editable knowledge the AI assistant can cite when owners ask
-- general questions about short-term rentals, the market, or NOK policies that
-- are NOT answered by the per-property Supabase tools.
--
-- Kept intentionally simple (no embeddings): the table is small, so the chat
-- tool fetches the active rows that match a topic and lets the model pick.

CREATE TABLE IF NOT EXISTS ai_knowledge (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category    text NOT NULL,                 -- 'market' | 'pricing' | 'nok_policy' | 'operations' | 'general'
  title       text NOT NULL,
  content     text NOT NULL,                 -- plain text / light markdown the AI can quote
  tags        text[] DEFAULT '{}',           -- keywords to help retrieval (e.g. 'temporada alta','adr')
  country     text,                          -- 'DO' | 'CO' | NULL = applies everywhere
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_active   ON ai_knowledge(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_category ON ai_knowledge(category);

-- ── Seed: short-term rental market & NOK basics (RD / Punta Cana) ──────────────
INSERT INTO ai_knowledge (category, title, content, tags, country) VALUES
('market', 'Temporada alta en Punta Cana / República Dominicana',
 'La temporada alta de alquiler vacacional en Punta Cana va de mediados de diciembre a mediados de abril, con picos en Navidad/Año Nuevo, Semana Santa y los meses secos de enero–marzo. Julio–agosto tiene un repunte menor por vacaciones de verano. Septiembre–noviembre es temporada baja (más lluvia y temporada de huracanes). En temporada alta las tarifas por noche pueden subir 40–80% sobre la tarifa base y se exige estadía mínima más larga (3–7 noches en fechas pico).',
 ARRAY['temporada alta','temporada baja','estacionalidad','navidad','semana santa','peak season'], 'DO'),

('pricing', 'Cómo se fijan las tarifas (pricing dinámico)',
 'NOK usa pricing dinámico: la tarifa por noche se ajusta según demanda, ocupación del mercado, día de la semana, eventos y anticipación de la reserva (lead time). No es un precio fijo. Las tarifas de fechas lejanas (ej. el próximo diciembre) a veces aún no están publicadas porque el equipo de Revenue las carga conforme se acerca la fecha y hay señal de demanda. Que una fecha no tenga tarifa visible NO significa que el precio sea cero: significa que todavía no se ha publicado.',
 ARRAY['pricing','tarifa','adr','dynamic pricing','revenue management','precio por noche'], NULL),

('market', 'Métricas clave: ADR, ocupación y RevPAR',
 'ADR (Average Daily Rate) = ingreso por noche reservada promedio. Ocupación = % de noches vendidas sobre noches disponibles. RevPAR = ingreso por noche disponible (ADR × ocupación); es la métrica que combina precio y ocupación y la mejor para comparar desempeño mes a mes. Un error común es subir la tarifa y celebrar el ADR mientras cae la ocupación: lo que importa es el RevPAR y el ingreso neto del propietario.',
 ARRAY['adr','revpar','ocupacion','occupancy','metricas','kpi'], NULL),

('nok_policy', 'Comisión NOK y costos al propietario',
 'El ingreso neto del propietario = ingreso después de comisiones de canal (Airbnb/Booking) − comisión NOK − limpieza − servicios públicos/mantenimiento que apliquen a la unidad. La comisión NOK es un porcentaje sobre el ingreso por gestión integral (operación, limpieza coordinada, revenue management, atención al huésped). El propietario ve el desglose completo en su reporte mensual en el portal.',
 ARRAY['comision','nok','ingreso neto','costos','desglose','payout'], NULL),

('operations', 'Servicios públicos y mantenimiento en el reporte',
 'Los costos de servicios públicos (luz, agua, internet, gas) y mantenimiento (piscina, jardinería) se registran por mes y por propiedad, y se reflejan en el reporte del mes correspondiente. Si un mes aparece en 0 normalmente es porque la factura de ese mes todavía no se ha cargado en el sistema, no porque no exista el costo. El equipo de operaciones carga estos valores periódicamente.',
 ARRAY['servicios publicos','utilities','mantenimiento','luz','agua','internet','reporte'], NULL),

('general', 'Qué puede y qué no puede hacer este asistente',
 'Este asistente da información sobre TU propiedad (ingresos, reservas, tarifas publicadas, reseñas, operación e inventario) y sobre temas generales del alquiler de corto plazo. NO puede cambiar precios, modificar reservas ni ejecutar acciones operativas: para eso crea un ticket y el equipo NOK te contacta. Para decisiones de tarifa de fechas específicas que aún no están publicadas, lo correcto es escalar al equipo de Revenue.',
 ARRAY['asistente','alcance','que puede hacer','ticket','soporte'], NULL);
