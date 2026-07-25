/**
 * Traducción ES→EN de los textos dinámicos del snapshot de Strategy (Wheelhouse).
 * Los textos se generan en español en lib/wheelhouse.ts con plantillas finitas;
 * aquí se mapean por regex (las partes variables son números/meses). Si un texto
 * no matchea ningún patrón, se deja en español (fallback seguro).
 */
import type { RevenueSnapshot } from '@/lib/wheelhouse'

const TAGS: Record<string, string> = {
  'Precio dinámico': 'Dynamic pricing',
  'Posicionamiento': 'Positioning',
  'Pisos de precio': 'Price floors',
  'Estancia mínima': 'Minimum stay',
  'Estancias largas': 'Long stays',
  'Último minuto': 'Last minute',
  'Temporada': 'Seasonality',
}

const MESES: Record<string, string> = {
  enero: 'January', febrero: 'February', marzo: 'March', abril: 'April', mayo: 'May', junio: 'June',
  julio: 'July', agosto: 'August', septiembre: 'September', octubre: 'October', noviembre: 'November', diciembre: 'December',
}

const RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^La tarifa se recalcula todos los días(?: para los próximos (\d+) días)? según demanda, eventos y ritmo de reservas de la zona, y se publica automáticamente en los canales\.$/,
    m => `Your rate is recalculated every day${m[1] ? ` for the next ${m[1]} days` : ''} based on demand, events and booking pace in your area, and published automatically to all channels.`],
  [/^Publicamos (\d+)% por debajo de la recomendación base para priorizar ocupación y ritmo de reservas\.$/,
    m => `We publish ${m[1]}% below the base recommendation to prioritize occupancy and booking pace.`],
  [/^Publicamos (\d+)% por encima de la recomendación base para priorizar tarifa por noche\.$/,
    m => `We publish ${m[1]}% above the base recommendation to prioritize nightly rate.`],
  [/^Publicamos la tarifa recomendada por el motor, sin ajustes manuales\.$/,
    () => 'We publish the rate recommended by the engine, with no manual adjustments.'],
  [/^Sin pisos de precio configurados\.$/, () => 'No price floors configured.'],
  [/^Tu tarifa nunca baja de \$([\d,]+) por noche(?:, con (\d+) pisos? especial(?:es)? para eventos y temporada alta(?: \(hasta \$([\d,]+)\))?)?\.$/,
    m => `Your rate never goes below $${m[1]} per night${m[2] ? `, with ${m[2]} special floor${+m[2] > 1 ? 's' : ''} for events and high season${m[3] ? ` (up to $${m[3]})` : ''}` : ''}.`],
  [/^Sin mínimo de noches configurado\.$/, () => 'No minimum-stay rule configured.'],
  [/^Mínimo de (.+)\. Más flexibilidad cerca de la fecha para capturar reservas de último minuto\.$/,
    m => `Minimum of ${m[1]
      .replace(/(\d+) noches en general/g, '$1 nights overall')
      .replace(/(\d+) noches para fechas dentro de (\d+) días/g, '$1 nights for dates within $2 days')
      .replace(/(\d+) noches a partir de (\d+) días/g, '$1 nights from $2 days out')}. More flexibility close to the date to capture last-minute bookings.`],
  [/^Descuento de (\d+)% por semana y (\d+)% por mes para atraer estancias largas que reducen rotación\.$/,
    m => `${m[1]}% weekly and ${m[2]}% monthly discount to attract longer stays that reduce turnover.`],
  [/^Descuentos de último minuto agresivos para rescatar noches que quedarían vacías\.$/,
    () => 'Aggressive last-minute discounts to rescue nights that would otherwise stay empty.'],
  [/^Descuentos de último minuto moderados\.$/, () => 'Moderate last-minute discounts.'],
  [/^Descuentos de último minuto conservadores para proteger la tarifa\.$/,
    () => 'Conservative last-minute discounts to protect your rate.'],
  [/^Descuentos de último minuto según lo recomendado por el mercado\.$/,
    () => 'Last-minute discounts as recommended by the market.'],
  [/^Curva propia calibrada a tu mercado: pico en (\w+) \(([+\-−]?\d+)%\) y valle en (\w+) \((sin ajuste|[+\-−]?\d+%)\)\.$/,
    m => `Custom curve calibrated to your market: peak in ${MESES[m[1]] ?? m[1]} (${m[2]}%) and low in ${MESES[m[3]] ?? m[3]} (${m[4] === 'sin ajuste' ? 'no adjustment' : m[4]}).`],
  [/^Seguimos la curva de temporada recomendada por el mercado, ajustada automáticamente cada día\.$/,
    () => 'We follow the seasonal curve recommended by the market, adjusted automatically every day.'],
]

const OCC_LABELS: Record<string, string> = {
  'Próximos 7 días': 'Next 7 days',
  'Próximos 30 días': 'Next 30 days',
  'Próximos 60 días': 'Next 60 days',
  'Próximos 90 días': 'Next 90 days',
}

const ATTR_LABELS: Record<string, string> = {
  'Punto de partida del mercado': 'Market starting point',
  'Historial de la unidad': 'Unit history',
  'Habitaciones': 'Bedrooms',
  'Capacidad': 'Capacity',
  'Amenidades': 'Amenities',
  'Reseñas': 'Reviews',
  'Fotos': 'Photos',
  'Baños': 'Bathrooms',
  'Ubicación': 'Location',
  'Ajuste manual': 'Manual adjustment',
}

function tr(text: string): string {
  for (const [re, fn] of RULES) {
    const m = text.match(re)
    if (m) return fn(m)
  }
  return text
}

/** Devuelve una copia del snapshot con los textos dinámicos en inglés. */
export function snapshotToEnglish(snap: RevenueSnapshot): RevenueSnapshot {
  return {
    ...snap,
    strategy: snap.strategy.map(s => ({ tag: TAGS[s.tag] ?? s.tag, text: tr(s.text) })),
    occWindows: snap.occWindows.map(w => ({ ...w, label: OCC_LABELS[w.label] ?? w.label })),
    basePrice: snap.basePrice
      ? { ...snap.basePrice, attribution: snap.basePrice.attribution.map(a => ({ ...a, label: ATTR_LABELS[a.label] ?? a.label })) }
      : snap.basePrice,
  }
}

export const FLAG_EN: Record<string, { title: string; text: string }> = {
  'High Availability': {
    title: 'High availability',
    text: 'A good part of the next 60 days is still open. The strategy switches to occupancy mode: competitive positioning and last-minute discounts stay active until pace recovers.',
  },
  'Base Price - High Historical Impact': {
    title: 'History is weighing on the base price',
    text: "The base price recommendation was adjusted based on your unit's actual booking pace. The engine learns from your unit's own behavior, not just the market.",
  },
  'Low Availability': {
    title: 'Low availability',
    text: 'Most upcoming dates are already booked — the engine raises rates to maximize the value of the remaining nights.',
  },
}
