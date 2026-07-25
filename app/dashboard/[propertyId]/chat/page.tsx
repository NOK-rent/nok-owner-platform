import { notFound } from 'next/navigation'
import ChatInterface from '@/components/chat/ChatInterface'
import { loadOwnerProperty } from '@/lib/admin'

interface Props {
  params: Promise<{ propertyId: string }>
}

export default async function ChatPage({ params }: Props) {
  const { propertyId } = await params

  const { owner, property, sb } = await loadOwnerProperty(propertyId)
  if (!property) notFound()

  const { data: history } = await sb
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: true })
    .limit(20)

  const initialMessages = (history ?? []).map((m: any) => ({
    id: crypto.randomUUID(),
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col" style={{ backgroundColor: '#F0EFED' }}>
      {/* Header */}
      <div
        className="px-8 py-4 shrink-0 flex items-center gap-3"
        style={{ borderBottom: '1px solid rgba(26,26,26,0.06)' }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(131, 59, 14,0.2)', border: '1px solid rgba(131, 59, 14,0.4)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#833B0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </div>
        <div>
          <h1 className="font-semibold text-[#1A1A1A] text-sm">Asistente NOK AI</h1>
          <p className="text-xs" style={{ color: 'rgba(26,26,26,0.35)' }}>{property.name}</p>
        </div>
        <span
          className="ml-auto flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
          style={{ backgroundColor: 'rgba(14,104,69,0.15)', color: '#0E6845', border: '1px solid rgba(14,104,69,0.3)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: '#0E6845' }} />
          En línea
        </span>
      </div>

      <ChatInterface
        propertyId={propertyId}
        ownerName={owner.name}
        initialMessages={initialMessages}
      />
    </div>
  )
}
