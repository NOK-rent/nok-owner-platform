'use client'

import { useChat, Chat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useRef, useEffect, useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'

interface ChatInterfaceProps {
  propertyId: string
  ownerName: string
  initialMessages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>
}

function toUIMessages(messages: ChatInterfaceProps['initialMessages']): UIMessage[] {
  return messages.map(m => ({
    id: m.id,
    role: m.role,
    parts: [{ type: 'text' as const, text: m.content }],
    metadata: undefined,
  }))
}

const SUGGESTED_QUESTIONS = [
  '¿Cuánto gané este mes?',
  '¿Cuáles son los precios para esta semana?',
  '¿Cuándo fue la última limpieza?',
  '¿Qué reseñas tengo recientes?',
  '¿Qué fechas están disponibles en julio?',
  '¿Qué artículos del inventario necesito reponer?',
]

export default function ChatInterface({
  propertyId,
  ownerName,
  initialMessages,
}: ChatInterfaceProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [inputValue, setInputValue] = useState('')

  const chat = useMemo(() => new Chat({
    messages: toUIMessages(initialMessages),
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { propertyId },
    }),
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  const { messages, sendMessage, status } = useChat({ chat })

  const isLoading = status === 'streaming' || status === 'submitted'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  function handleSend(content: string) {
    if (!content.trim() || isLoading) return
    sendMessage({ text: content })
    setInputValue('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    handleSend(inputValue)
  }

  const showWelcome = messages.length === 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 lg:px-10 py-6 space-y-5">
        {showWelcome && (
          <div className="flex flex-col items-center justify-center py-12 text-center max-w-lg mx-auto">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
              style={{ backgroundColor: 'rgba(131, 59, 14,0.15)', border: '1px solid rgba(131, 59, 14,0.3)' }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#833B0E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
            <h2 className="font-serif text-2xl font-light text-[#1A1A1A] mb-2">
              Hola, {ownerName.split(' ')[0]}
            </h2>
            <p className="text-sm mb-8" style={{ color: 'rgba(26,26,26,0.4)' }}>
              Soy tu asistente de NOK. Puedo responderte sobre ingresos, reservas,
              precios, reseñas, limpiezas e inventario de tu propiedad.
            </p>

            <div className="w-full grid grid-cols-1 gap-2">
              {SUGGESTED_QUESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="text-left px-4 py-3.5 rounded-xl text-sm transition-all duration-200 cursor-pointer"
                  style={{
                    color: 'rgba(26,26,26,0.7)',
                    border: '1px solid rgba(26,26,26,0.07)',
                    backgroundColor: '#FFFFFF',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(131, 59, 14,0.4)'
                    ;(e.currentTarget as HTMLElement).style.color = '#1A1A1A'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(26,26,26,0.07)'
                    ;(e.currentTarget as HTMLElement).style.color = 'rgba(26,26,26,0.7)'
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {message.role === 'assistant' && (
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mr-2.5 mt-0.5"
                style={{ backgroundColor: 'rgba(131, 59, 14,0.2)' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#833B0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              </div>
            )}

            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
                message.role === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm'
              }`}
              style={
                message.role === 'user'
                  ? { backgroundColor: '#833B0E', color: '#FFFFFF' }
                  : { backgroundColor: '#FFFFFF', color: 'rgba(26,26,26,0.85)', border: '1px solid rgba(26,26,26,0.07)' }
              }
            >
              {message.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-strong:text-[#833B0E] prose-a:text-[#833B0E]">
                  <ReactMarkdown>
                    {message.parts
                      .filter(p => p.type === 'text')
                      .map(p => (p as { type: 'text'; text: string }).text)
                      .join('')}
                  </ReactMarkdown>
                </div>
              ) : (
                <p>
                  {message.parts
                    .filter(p => p.type === 'text')
                    .map(p => (p as { type: 'text'; text: string }).text)
                    .join('')}
                </p>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mr-2.5 mt-0.5"
              style={{ backgroundColor: 'rgba(131, 59, 14,0.2)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#833B0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
            <div
              className="rounded-2xl rounded-bl-sm px-4 py-3"
              style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.07)' }}
            >
              <div className="flex gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:0ms]" style={{ backgroundColor: '#833B0E' }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:150ms]" style={{ backgroundColor: '#833B0E' }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:300ms]" style={{ backgroundColor: '#833B0E' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="shrink-0 px-6 lg:px-10 py-4"
        style={{ borderTop: '1px solid rgba(26,26,26,0.06)' }}
      >
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <textarea
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="Pregúntame algo sobre tu propiedad..."
            rows={1}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend(inputValue)
              }
            }}
            className="flex-1 resize-none rounded-xl px-4 py-3 text-sm outline-none transition-all duration-300 max-h-32 overflow-y-auto"
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid rgba(26,26,26,0.08)',
              color: '#1A1A1A',
            }}
            onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(131, 59, 14,0.5)'}
            onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(26,26,26,0.08)'}
          />
          <button
            type="submit"
            disabled={isLoading || !inputValue.trim()}
            className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 cursor-pointer"
            style={{ backgroundColor: '#833B0E', color: '#FFFFFF' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
            </svg>
          </button>
        </form>
        <p className="text-xs mt-2 text-center" style={{ color: 'rgba(26,26,26,0.2)' }}>
          Enter para enviar · Shift+Enter para nueva línea
        </p>
      </div>
    </div>
  )
}
