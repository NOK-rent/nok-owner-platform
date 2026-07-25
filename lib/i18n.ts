/**
 * i18n ligero del portal (es/en). El idioma vive en owners.locale y en la
 * cookie nok_locale (para SSR inmediato). Cobertura v1: navegación, pestaña
 * Equipo NOK, Cálculos y los emails transaccionales (esos se arman en nok-hub
 * leyendo owners.locale).
 */
import { cookies } from 'next/headers'

export type Locale = 'es' | 'en'

export async function getLocale(): Promise<Locale> {
  try {
    const c = await cookies()
    return c.get('nok_locale')?.value === 'en' ? 'en' : 'es'
  } catch {
    return 'es'
  }
}

export const NAV: Record<Locale, Record<string, string>> = {
  es: {
    resumen: 'Resumen', calendario: 'Calendario', reservas: 'Reservas', resenas: 'Reseñas',
    strategy: 'Strategy', calculos: 'Cálculos', analiticas: 'Analíticas', equipo: 'Equipo NOK',
    cerrarSesion: 'Cerrar sesión',
  },
  en: {
    resumen: 'Overview', calendario: 'Calendar', reservas: 'Reservations', resenas: 'Reviews',
    strategy: 'Strategy', calculos: 'My numbers', analiticas: 'Analytics', equipo: 'NOK Team',
    cerrarSesion: 'Sign out',
  },
}
