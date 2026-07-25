/**
 * Soporte — creación de tickets del propietario + notificaciones por email (Resend).
 *
 * Reemplaza el webhook n8n (proceso viejo que no funcionaba): ahora el email
 * al responsable del área sale directo desde aquí, con copia a owners@nok.rent.
 * El equipo responde desde el dashboard de Soporte en nok-hub y esa respuesta
 * llega al owner por email y a su pestaña "Equipo NOK" del portal.
 */

import Anthropic from '@anthropic-ai/sdk'

export const OWNERS_INBOX = process.env.OWNERS_INBOX_EMAIL || 'owners@nok.rent'
export const SOPORTE_FROM = process.env.SOPORTE_FROM_ADDRESS || 'NOK Owners <owners@nok.rent>'
const HUB_TICKETS_URL = process.env.NOK_HUB_URL
  ? `${process.env.NOK_HUB_URL}/soporte/tickets`
  : 'https://nok-hub.vercel.app/soporte/tickets'

export const AREAS_ROUTING: Record<string, string> = {
  'Revenue Management': 'jad@nok.rent',
  'Finanzas': 'jp@nok.rent',
  'Operaciones CO': 'jcc@nok.rent',
  'Operaciones RD': 'rg@nok.rent',
  'Growth': 'mc@nok.rent',
  'CX': 'mam@nok.rent',
  'C-level': 'se@nok.rent',
}

export interface Classification {
  area: string
  urgencia: string
  confianza: string
  titulo: string
  resumen: string
  respuestaSugerida: string
}

export interface TicketAttachment {
  name: string
  path: string          // ruta en el bucket privado (fuente de verdad)
  url?: string          // URL firmada de corta vida, generada al leer/enviar
  type: string
  size: number
}

const BUCKET = 'soporte-adjuntos'

/** Firma una ruta del bucket privado. In-app: 1h. Email: pasar 7 días. */
export async function signAttachmentPath(sb: any, path: string, expiresSec = 3600): Promise<string | null> {
  if (!path) return null
  // Compat: si viniera una URL pública vieja, extrae la ruta después del nombre del bucket
  const clean = path.includes(`/${BUCKET}/`) ? path.split(`/${BUCKET}/`)[1].split('?')[0] : path
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(clean, expiresSec)
  return data?.signedUrl ?? null
}

/** Firma un arreglo de adjuntos (rellena .url). */
export async function signAttachments(sb: any, atts: TicketAttachment[] | null | undefined, expiresSec = 3600): Promise<TicketAttachment[]> {
  if (!Array.isArray(atts)) return []
  return Promise.all(atts.map(async a => ({ ...a, url: (await signAttachmentPath(sb, a.path || a.url || '', expiresSec)) ?? undefined })))
}

export async function classifyMessage(ownerName: string, propertyName: string, message: string): Promise<Classification> {
  const fallback: Classification = {
    area: 'CX', urgencia: 'baja', confianza: 'baja',
    titulo: 'Consulta de propietario', resumen: '', respuestaSugerida: '',
  }
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Eres un asistente de clasificación de consultas de propietarios para NOK, empresa de gestión de apartamentos.

Clasifica la consulta en UNA de estas áreas:

**Revenue Management**: Reportes mensuales, liquidaciones, ingresos, ocupación, ADR, tarifas, rendimiento del apto, listing.
**Finanzas**: Impuestos, declaración de renta, DIAN, contribuciones parafiscales, FONTUR.
**Operaciones**: Limpieza, mantenimiento, daños, reparaciones, servicios públicos, incidencias.
**Growth**: Comisión NOK, contrato, acceso a Guesty, inventario, onboarding, fotos.
**CX**: Bloqueo de fechas, reservas directas, quejas de huéspedes, RNT, check-in.
**C-level**: Pagos al propietario, fecha de pago, comprobantes, reclamos de pago.

Responde ÚNICAMENTE en JSON (sin texto adicional):
{
  "area": "Revenue Management|Finanzas|Operaciones|Growth|CX|C-level",
  "urgencia": "alta|media|baja",
  "confianza": "alta|media|baja",
  "titulo": "Titulo corto y descriptivo",
  "resumen": "Resumen breve en español (máximo 80 palabras)",
  "respuestaSugerida": "Borrador de respuesta profesional en español"
}

---
Propietario: ${ownerName}
Apartamento: ${propertyName}
Consulta: ${message}`
      }],
    })
    // sonnet-5 puede emitir bloques 'thinking' antes del texto — buscar el bloque text
    const aiText = (res.content.find((c: any) => c.type === 'text') as any)?.text ?? ''
    const cleaned = aiText.replace(/```json\n?|```\n?/g, '').trim()
    return { ...fallback, ...JSON.parse(cleaned) }
  } catch {
    return fallback
  }
}

export function resolveResponsable(classification: Classification, countryHint: string): string {
  const pais = countryHint.toLowerCase()
  if (classification.confianza === 'baja') return 'cg@nok.rent'
  if (classification.area === 'Operaciones') {
    return pais.includes('dominicana') || pais.includes('rd') ? 'rg@nok.rent' : 'jcc@nok.rent'
  }
  return AREAS_ROUTING[classification.area] || 'cg@nok.rent'
}

// ── Email (Resend via fetch, mismo patrón que nok-hub/lib/email.ts) ──

export async function sendSoporteEmail(params: {
  to: string | string[]
  cc?: string | string[]
  replyTo?: string
  subject: string
  html: string
}): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[soporte-email] RESEND_API_KEY missing — email not sent:', params.subject)
    return { sent: false, error: 'RESEND_API_KEY missing' }
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        from: SOPORTE_FROM,
        to: Array.isArray(params.to) ? params.to : [params.to],
        ...(params.cc ? { cc: Array.isArray(params.cc) ? params.cc : [params.cc] } : {}),
        reply_to: params.replyTo || OWNERS_INBOX,
        subject: params.subject,
        html: params.html,
      }),
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      console.error('[soporte-email] resend error', res.status, err)
      return { sent: false, error: `${res.status} ${err}` }
    }
    return { sent: true }
  } catch (e) {
    console.error('[soporte-email] fetch error', e)
    return { sent: false, error: String(e) }
  }
}

const emailShell = (inner: string) => `
<div style="background:#F0EFED;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid rgba(26,26,26,0.08);">
    <div style="padding:24px 32px;border-bottom:1px solid rgba(26,26,26,0.06);">
      <span style="font-size:20px;letter-spacing:6px;color:#1A1A1A;font-weight:bold;">NOK</span>
      <span style="font-size:11px;color:#9A9A9A;margin-left:10px;">Feels right. Anywhere.</span>
    </div>
    <div style="padding:28px 32px;color:#1A1A1A;font-size:14px;line-height:1.6;">${inner}</div>
    <div style="padding:16px 32px;border-top:1px solid rgba(26,26,26,0.06);font-size:11px;color:#9A9A9A;">
      NOK · owners.nok.rent · owners@nok.rent
    </div>
  </div>
</div>`

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')

const attachmentsHtml = (attachments: TicketAttachment[]) =>
  attachments.length
    ? `<div style="margin-top:12px;">${attachments.map(a =>
        `<a href="${a.url}" style="display:inline-block;margin:2px 6px 2px 0;padding:6px 12px;border:1px solid rgba(26,26,26,0.12);border-radius:8px;color:#833B0E;text-decoration:none;font-size:12px;">📎 ${escapeHtml(a.name)}</a>`
      ).join('')}</div>`
    : ''

/** Email al responsable del área cuando el owner escribe (consulta nueva o respuesta en el hilo). */
export function buildTeamNotificationEmail(p: {
  kind: 'nueva' | 'respuesta'
  ticketId: string
  titulo: string
  area: string
  urgencia: string
  ownerName: string
  apartamento: string
  message: string
  attachments?: TicketAttachment[]
}) {
  const badge = p.kind === 'nueva' ? 'Nueva consulta de propietario' : 'El propietario respondió'
  return {
    subject: `[NOK Owners] ${badge}: ${p.titulo} · ${p.apartamento}`,
    html: emailShell(`
      <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#833B0E;">${badge}</p>
      <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;">${escapeHtml(p.titulo)}</h2>
      <table style="font-size:13px;color:#555;margin-bottom:16px;" cellpadding="2">
        <tr><td style="color:#9A9A9A;padding-right:12px;">Propietario</td><td>${escapeHtml(p.ownerName)}</td></tr>
        <tr><td style="color:#9A9A9A;padding-right:12px;">Apartamento</td><td>${escapeHtml(p.apartamento)}</td></tr>
        <tr><td style="color:#9A9A9A;padding-right:12px;">Área</td><td>${escapeHtml(p.area)} · urgencia ${escapeHtml(p.urgencia)}</td></tr>
      </table>
      <div style="background:#F0EFED;border-radius:12px;padding:16px;">${escapeHtml(p.message)}</div>
      ${attachmentsHtml(p.attachments ?? [])}
      <a href="${HUB_TICKETS_URL}" style="display:inline-block;margin-top:20px;background:#1A1A1A;color:#FFFFFF;padding:10px 20px;border-radius:10px;text-decoration:none;font-size:13px;">Responder desde el dashboard de Soporte</a>
      <p style="margin:16px 0 0;font-size:11px;color:#9A9A9A;">Responde desde el dashboard para que quede en el historial del propietario. Ticket ${p.ticketId}</p>
    `),
  }
}

/** Email al owner cuando el equipo NOK responde desde el dashboard. */
export function buildOwnerResponseEmail(p: {
  ownerFirstName: string
  titulo: string
  apartamento: string
  response: string
  attachments?: TicketAttachment[]
  portalUrl: string
}) {
  return {
    subject: `NOK respondió tu consulta: ${p.titulo}`,
    html: emailShell(`
      <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#0E6845;">Tienes una respuesta del equipo NOK</p>
      <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;">${escapeHtml(p.titulo)}</h2>
      <p style="margin:0 0 16px;font-size:12px;color:#9A9A9A;">${escapeHtml(p.apartamento)}</p>
      <p style="margin:0 0 12px;">Hola ${escapeHtml(p.ownerFirstName)},</p>
      <div style="background:#F0EFED;border-radius:12px;padding:16px;">${escapeHtml(p.response)}</div>
      ${attachmentsHtml(p.attachments ?? [])}
      <a href="${p.portalUrl}" style="display:inline-block;margin-top:20px;background:#833B0E;color:#FFFFFF;padding:10px 20px;border-radius:10px;text-decoration:none;font-size:13px;">Ver la conversación en tu portal</a>
      <p style="margin:16px 0 0;font-size:11px;color:#9A9A9A;">¿Tienes más preguntas? Responde directo desde tu portal en la pestaña Equipo NOK.</p>
    `),
  }
}

// ── Adjuntos ──

export const ATTACHMENT_MAX_MB = 10
export const ATTACHMENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Sube archivos al bucket soporte-adjuntos y devuelve metadata para ticket_events.metadata */
export async function uploadAttachments(sb: any, ticketId: string, files: File[]): Promise<TicketAttachment[]> {
  const out: TicketAttachment[] = []
  for (const file of files.slice(0, 5)) {
    const ext = ATTACHMENT_TYPES[file.type]
    if (!ext) throw new Error(`Tipo de archivo no permitido: ${file.type}. Usa PDF, JPG o PNG.`)
    if (file.size > ATTACHMENT_MAX_MB * 1024 * 1024) throw new Error(`${file.name} supera ${ATTACHMENT_MAX_MB}MB.`)

    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80)
    const path = `${ticketId}/${Date.now()}-${safeName}`
    const buf = Buffer.from(await file.arrayBuffer())
    const { error } = await sb.storage.from('soporte-adjuntos').upload(path, buf, {
      contentType: file.type,
      upsert: false,
    })
    if (error) throw new Error(`Error subiendo ${file.name}: ${error.message}`)
    // Guarda la RUTA (bucket privado). La URL se firma al leer/enviar.
    out.push({ name: file.name, path, type: file.type, size: file.size })
  }
  return out
}

// ── Creación de ticket (compartida entre SupportForm y la pestaña Equipo NOK) ──

export async function createTicketForOwner(opts: {
  sb: any
  owner: { id: string; name: string; email: string; pais?: string | null }
  property: { id: string; name: string; country?: string | null }
  message: string
  attachments?: TicketAttachment[]
}) {
  const { sb, owner, property, message } = opts
  const attachments = opts.attachments ?? []

  const classification = await classifyMessage(owner.name, property.name, message)
  const correoResponsable = resolveResponsable(classification, property.country || owner.pais || '')

  const { data: ticket, error: ticketError } = await sb
    .from('support_tickets')
    .insert({
      title: classification.titulo || 'Consulta de propietario',
      description: message,
      status: 'open',
      urgencia: classification.urgencia,
      confianza_ia: classification.confianza,
      area_responsable: classification.area,
      correo_responsable: correoResponsable,
      owner_id: owner.id,
      property_id: property.id,
      apartamento: property.name,
      correo_propietario: owner.email,
      propietario_nombre: owner.name,
      resumen_ia: classification.resumen,
      source: 'platform',
      last_owner_message_at: new Date().toISOString(),
    })
    .select()
    .single()
  if (ticketError) throw ticketError

  await Promise.all([
    sb.from('ticket_events').insert({
      ticket_id: ticket.id,
      event_type: 'owner_message',
      content: message,
      author_name: owner.name,
      author_email: owner.email,
      metadata: attachments.length ? { attachments } : null,
    }),
    sb.from('ticket_events').insert({
      ticket_id: ticket.id,
      event_type: 'ai_response',
      content: `Area: ${classification.area} | Urgencia: ${classification.urgencia} | Confianza: ${classification.confianza} | Resumen: ${classification.resumen}`,
      author_name: 'system',
    }),
  ])

  // Notificación directa por Resend al responsable + copia a owners@nok.rent.
  // Los adjuntos se firman 7 días para que el link del email funcione al abrirlo.
  const emailAtts = await signAttachments(sb, attachments, 7 * 24 * 3600)
  const email = buildTeamNotificationEmail({
    kind: 'nueva',
    ticketId: ticket.id,
    titulo: ticket.title,
    area: classification.area,
    urgencia: classification.urgencia,
    ownerName: owner.name,
    apartamento: property.name,
    message,
    attachments: emailAtts,
  })
  const emailResult = await sendSoporteEmail({
    to: correoResponsable,
    cc: OWNERS_INBOX,
    replyTo: OWNERS_INBOX,
    subject: email.subject,
    html: email.html,
  })
  if (emailResult.sent) {
    await sb.from('ticket_events').insert({
      ticket_id: ticket.id,
      event_type: 'email_sent',
      content: `Notificación enviada a ${correoResponsable} (cc ${OWNERS_INBOX})`,
      author_name: 'system',
    })
  }

  return { ticket, classification }
}
