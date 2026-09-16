import ChatInterface from '@/components/chat/ChatInterface'
import { loadOwnerBuilding } from '@/lib/edificio'
import { getLocale } from '@/lib/i18n'

interface Props { params: Promise<{ configId: string }> }

export const revalidate = 0

const QUESTIONS = {
  es: [
    '¿Cuál fue el NOI del edificio este mes?',
    '¿Qué unidades tienen menor ocupación los próximos 30 días?',
    '¿Cuánto se gastó en lavandería este mes?',
    '¿Cuándo empieza NOK a cobrar comisión?',
    '¿Qué reservas entran esta semana?',
  ],
  en: [
    "What was the building's NOI this month?",
    'Which units have the lowest occupancy in the next 30 days?',
    'How much was spent on laundry this month?',
    'When does NOK start charging commission?',
    'Which bookings arrive this week?',
  ],
}

export default async function EdificioChatPage({ params }: Props) {
  const { configId } = await params
  const [{ owner, config, properties, sb }, locale] = await Promise.all([loadOwnerBuilding(configId), getLocale()])

  // Historial del edificio (si la migración aún no está aplicada, empezamos vacío)
  let history: any[] = []
  try {
    const { data } = await sb.from('chat_messages').select('role, content, created_at')
      .eq('building_id', configId).eq('owner_id', owner.id)
      .order('created_at', { ascending: false }).limit(30)
    history = (data ?? []).reverse()
  } catch { history = [] }

  const initialMessages = history.map((m: any) => ({
    id: crypto.randomUUID(),
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  const welcome = locale === 'en'
    ? `I'm your NOK assistant for ${config.name}. Ask me about the building's P&L, NOI and commission, costs and invoices, bookings and occupancy per unit.`
    : `Soy tu asistente de NOK para ${config.name}. Pregúntame por el P&L del edificio, el NOI y la comisión, costos y facturas, reservas y ocupación por unidad.`

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col" style={{ backgroundColor: '#F0EFED' }}>
      <div className="px-5 sm:px-8 py-4 shrink-0 flex items-center gap-3" style={{ borderBottom: '1px solid rgba(26,26,26,0.06)' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(131, 59, 14,0.2)', border: '1px solid rgba(131, 59, 14,0.4)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#833B0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </div>
        <div className="min-w-0">
          <h1 className="font-semibold text-[#1A1A1A] text-sm truncate">{locale === 'en' ? 'NOK AI Assistant' : 'Asistente NOK AI'} — {config.name}</h1>
          <p className="text-xs" style={{ color: 'rgba(26,26,26,0.35)' }}>{properties.length} {locale === 'en' ? 'units · whole-building context' : 'unidades · contexto de todo el edificio'}</p>
        </div>
      </div>

      <ChatInterface
        ownerName={owner.name}
        initialMessages={initialMessages}
        api="/api/chat/edificio"
        body={{ configId }}
        suggestedQuestions={QUESTIONS[locale]}
        welcomeText={welcome}
      />
    </div>
  )
}
