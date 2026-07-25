import ChatInterface from '@/components/chat/ChatInterface'
import { loadOwnerGroup } from '@/lib/group'

interface Props { params: Promise<{ groupId: string }> }

export default async function GroupChatPage({ params }: Props) {
  const { groupId } = await params
  const { owner, group, propertyIds, properties, sb } = await loadOwnerGroup(groupId)
  const firstPropId = propertyIds[0]

  const { data: history } = firstPropId
    ? await sb.from('chat_messages').select('role, content, created_at')
        .eq('property_id', firstPropId).order('created_at', { ascending: true }).limit(20)
    : { data: [] as any[] }

  const initialMessages = (history ?? []).map((m: any) => ({
    id: crypto.randomUUID(),
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col" style={{ backgroundColor: '#F0EFED' }}>
      <div className="px-8 py-4 shrink-0 flex items-center gap-3" style={{ borderBottom: '1px solid rgba(26,26,26,0.06)' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(131, 59, 14,0.2)', border: '1px solid rgba(131, 59, 14,0.4)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#833B0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </div>
        <div>
          <h1 className="font-semibold text-[#1A1A1A] text-sm">Asistente NOK AI — Grupo: {group.name}</h1>
          <p className="text-xs text-[#1A1A1A]/35">{properties.length} propiedades · contexto de {properties[0]?.name ?? '—'}</p>
        </div>
      </div>

      {firstPropId ? (
        <ChatInterface propertyId={firstPropId} ownerName={owner.name} initialMessages={initialMessages} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-[#1A1A1A]/40">El grupo no tiene propiedades asignadas.</div>
      )}
    </div>
  )
}
