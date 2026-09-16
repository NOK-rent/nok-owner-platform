# COORDINATION.md — sesiones Claude activas en nok-owner-platform

## Sesión: Features owner dashboard (2026-07-24)
4 features: (1) tab Cálculos por propiedad (statement mensual + gastos propios del owner + PDF NOK) con card
de links de publicación (airbnb_url/booking_url/etc.), (2) tab global /dashboard/equipo (hilos de tickets
bidireccionales + comunicados), (3) /api/soporte con email Resend directo (reemplaza webhook n8n roto),
(4) adjuntos en ticket_events.metadata via Storage bucket soporte-adjuntos.
- Archivos nuevos: lib/monthly-statement.ts, lib/statement-pdf.tsx, app/dashboard/[propertyId]/calculos/*,
  app/dashboard/equipo/*, app/api/soporte/tickets/*, lib/soporte-email.ts
- Tocados: components/dashboard/TopNav.tsx (tabs Cálculos + Equipo NOK), app/api/soporte/route.ts (email directo)
- NO toco overview/page.tsx ni NotificationsBanner.tsx (conflicto con sesiones previas)
- También en nok-hub: broadcast modal en owners-portal + composer de respuesta en /soporte/tickets

## Sesión: Restyle nok.rent (2026-07-24)
Redesign completo al sistema de diseño de nok.rent: Aeonik + Hedvig Letters Serif,
tema claro (#F0EFED / cards blancas / texto #1A1A1A), acento Earth #833B0E.
- Tocados: globals.css, layout.tsx (root), TODOS los page.tsx de dashboard/apt-setup/login/onboarding,
  components/dashboard/*, components/calendar/*, components/chat/*, public/fonts/, public/nok_negro.png
- OJO: `app/dashboard/[propertyId]/overview/page.tsx` y `components/dashboard/NotificationsBanner.tsx`
  tienen MIS cambios de estilo mezclados con cambios sin commitear de otra sesión (feature notificaciones/AI).
  RESUELTO 2026-07-25: overview/page.tsx y NotificationsBanner quedaron commiteados junto con el bloque de próximos 12 meses (ya estaban live en prod).
- El mapeo de colores: #1D1D1B→#F0EFED, #141413→#FFFFFF, #F2F2F2→#1A1A1A, texto serenity→earth.
  Nuevos tokens en globals.css (:root + @theme). No reintroducir hexes del tema oscuro viejo.

## Sesión: Notificaciones/AI knowledge base (previa, sin commitear)
Archivos: app/api/chat, app/api/sync/guesty, lib/ai/*, app/admin/notifications,
app/api/admin, app/api/notifications, NotificationsBanner, migrations 023/024.

## Sesión: Revenue/Wheelhouse + NOK AI (2026-07-23 → 25) — COMMITEADO, DEPLOYADO fb973fc
- `lib/wheelhouse.ts`: cliente RM API. `resolveWheelhouseRef()`: `properties.wheelhouse_property_id` (prefijo `airbnb:` para canal airbnb) con fallback `guesty_listing_id`. 9 propiedades mapeadas así en DB.
- Página revenue/Strategy: ya integrada al restyle claro + bilingüe por la sesión de features ✓.
- NOK AI: nuevo tool `getRevenueStrategy` (snapshot Wheelhouse en vivo) en `lib/ai/tools.ts` + registrado en chat route + guía en system-prompt (vocabulario: "Revenue Management NOK", "zona" no "barrio").
- fix build fb973fc: quité `NotificationsBanner` del overview — d48effc decía incluirlo pero el archivo NUNCA se agregó a git (sigue untracked). Cuando se commitee el componente + APIs + migración 024, re-agregar el banner al overview.
- Deploys: manual `git archive HEAD` → tmp → `vercel deploy --prod` (NUNCA working tree directo — siempre hay WIP de otras sesiones).

## Sesión: Edificio (Wellness, 1 propietario × 20 unidades) — 2026-09-15
Nueva sección `/dashboard/edificio/[configId]/*` sobre `building_pnl_configs` (tabla compartida con Gardens/Ekkos):
overview (P&L neto: net − costos = NOI; comisión NOK solo si el NOI del mes ≥ umbral COP), costos (costos del edificio
con facturas firmadas + servicios/mantenimiento por unidad), calendario (grilla unidades × días), reservas, strategy
(agregado sin llamar Wheelhouse por unidad + briefing IA), chat (NOK AI con tools de edificio).
- Nuevos: `lib/building-pnl.ts` (FUENTE ÚNICA del cálculo — nok-hub la consume vía `/api/edificio/[id]/pnl?secret=`),
  `lib/edificio.ts` (acceso: admin | config.owner_id | shared_emails | dueño de alguna unidad), `lib/edificio-i18n.ts`,
  `lib/ai/building-tools.ts`, `lib/ai/building-system-prompt.ts`, `lib/ai/building-briefing.ts`,
  `app/api/edificio/[configId]/pnl/route.ts`, `app/api/chat/edificio/route.ts`, `components/edificio/*`.
- Tocados: `components/dashboard/TopNav.tsx` (selector "Edificios" + tabs; `'edificio'` en `reserved`), `app/dashboard/layout.tsx`
  (carga `listOwnerBuildings`), `app/dashboard/page.tsx` (landing → edificio si el owner tiene uno), `lib/i18n.ts`,
  `middleware.ts` (pasa `/api/edificio/*` solo con secret M2M válido), `components/chat/ChatInterface.tsx` (props `api`/`body` opcionales).
- Migración `supabase/migrations/029_edificios.sql` — **PENDIENTE de aplicar** (copia en nok-hub/scripts/migration_edificios.sql).
  Sin ella: la config existe (seed por REST) pero sin umbral/start_month/slug; los costos con factura y el chat de edificio fallan al insertar.
- Carga de costos + facturas: la hace el equipo desde nok-hub `/edificios` (bucket privado `soporte-adjuntos`, path `edificios/{configId}/{YYYY-MM}/…`).
- Comisión Wellness: umbral 80.000.000 COP sobre NOI mensual; tasa por encima del umbral = 0 hasta que Santi la defina (config en el hub).
