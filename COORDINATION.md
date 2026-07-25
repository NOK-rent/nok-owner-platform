# COORDINATION.md — sesiones Claude activas en nok-owner-platform

## Sesión: Restyle nok.rent (2026-07-24)
Redesign completo al sistema de diseño de nok.rent: Aeonik + Hedvig Letters Serif,
tema claro (#F0EFED / cards blancas / texto #1A1A1A), acento Earth #833B0E.
- Tocados: globals.css, layout.tsx (root), TODOS los page.tsx de dashboard/apt-setup/login/onboarding,
  components/dashboard/*, components/calendar/*, components/chat/*, public/fonts/, public/nok_negro.png
- OJO: `app/dashboard/[propertyId]/overview/page.tsx` y `components/dashboard/NotificationsBanner.tsx`
  tienen MIS cambios de estilo mezclados con cambios sin commitear de otra sesión (feature notificaciones/AI).
  El restyle de esos 2 archivos queda SIN commitear hasta que esa sesión commitee su feature.
- El mapeo de colores: #1D1D1B→#F0EFED, #141413→#FFFFFF, #F2F2F2→#1A1A1A, texto serenity→earth.
  Nuevos tokens en globals.css (:root + @theme). No reintroducir hexes del tema oscuro viejo.

## Sesión: Notificaciones/AI knowledge base (previa, sin commitear)
Archivos: app/api/chat, app/api/sync/guesty, lib/ai/*, app/admin/notifications,
app/api/admin, app/api/notifications, NotificationsBanner, migrations 023/024.
