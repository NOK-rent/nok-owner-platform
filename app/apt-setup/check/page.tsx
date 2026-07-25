'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useWizard, type CheckItem, type CategoryResults } from '@/components/apt-setup/WizardContext'

type Message = { role: 'user' | 'assistant'; content: string }

const CATEGORY_META: Record<string, { icon: string; label: string }> = {
  sala: { icon: '🛋️', label: 'Sala / Comedor' },
  habitacion: { icon: '🛏️', label: 'Habitaciones' },
  cocina: { icon: '🍳', label: 'Cocina' },
  lenceria: { icon: '🛏️', label: 'Lencería' },
}

const INITIAL_MESSAGE =
  '¡Hola! Soy el inspector de estándares NOK. Voy a verificar rápidamente qué tiene tu apartamento. Empecemos por la **sala/comedor** — ¿qué muebles y accesorios tienes ahí?'

export default function CheckPage() {
  const router = useRouter()
  const { state, updateState } = useWizard()
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: INITIAL_MESSAGE },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showResults, setShowResults] = useState(state.checkComplete)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [expandedCat, setExpandedCat] = useState<string | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isLoading) return

    const userMsg: Message = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setIsLoading(true)

    try {
      const res = await fetch('/api/apt-setup/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          country: state.country,
          bedrooms: state.bedrooms,
          bathrooms: state.bathrooms,
          property_address: state.property_address,
        }),
      })

      if (!res.ok) throw new Error('API error')

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let assistantText = ''

      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '))

        for (const line of lines) {
          const data = JSON.parse(line.slice(6))
          if (data.text) {
            assistantText += data.text
            setMessages(prev => {
              const next = [...prev]
              next[next.length - 1] = { role: 'assistant', content: assistantText }
              return next
            })
          }
        }
      }

      // Check if AI returned JSON results
      const jsonMatch = assistantText.match(/```json\s*([\s\S]*?)```/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1])
          if (parsed.complete && parsed.results) {
            await processCheckResults(parsed.results)
          }
        } catch { /* not valid JSON yet */ }
      }
    } catch {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: 'Hubo un error de conexión. Inténtalo de nuevo.' },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const processCheckResults = async (results: Record<string, { items: Array<{ name: string; status: string; quantity_needed: number }> }>) => {
    // Fetch catalog items for pricing
    const res = await fetch(`/api/apt-setup/prices?country=${state.country}`)
    const catalogItems: Array<{ id: string; name: string; price: number; currency: string; purchase_url: string | null; space_type: string | null }> = res.ok ? await res.json() : []

    const checkResults: Record<string, CategoryResults> = {}

    for (const [category, data] of Object.entries(results)) {
      const items: CheckItem[] = data.items.map(item => {
        const match = catalogItems.find(c =>
          c.name.toLowerCase().includes(item.name.toLowerCase()) ||
          item.name.toLowerCase().includes(c.name.toLowerCase())
        )
        return {
          name: item.name,
          status: item.status as CheckItem['status'],
          quantity_needed: item.quantity_needed,
          unit_price: match?.price ?? 0,
          currency: match?.currency ?? (state.country === 'CO' ? 'COP' : 'DOP'),
          link: match?.purchase_url ?? null,
          notes: null,
          catalog_item_id: match?.id ?? null,
        }
      })

      const present = items.filter(i => i.status === 'has_it').length
      const missing = items.filter(i => i.status !== 'has_it').length

      checkResults[category] = { items, total: items.length, present, missing }
    }

    updateState({ checkResults, checkComplete: true })
    setShowResults(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const totalStandard = Object.values(state.checkResults).reduce((s, c) => s + c.total, 0)
  const totalPresent = Object.values(state.checkResults).reduce((s, c) => s + c.present, 0)
  const totalMissingValue = Object.values(state.checkResults).reduce((s, c) =>
    s + c.items.filter(i => i.status !== 'has_it').reduce((sum, i) => sum + i.unit_price * i.quantity_needed, 0)
  , 0)
  const currency = state.country === 'CO' ? 'COP' : 'DOP'

  const formatPrice = (n: number) =>
    new Intl.NumberFormat('es-CO', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

  // Results view
  if (showResults && state.checkComplete) {
    return (
      <div className="space-y-8">
        <div className="text-center sm:text-left">
          <p className="text-[#D6A700] text-xs font-semibold tracking-[0.2em] uppercase mb-2">Resultado del check</p>
          <h1 className="font-[family-name:var(--font-secondary)] text-3xl sm:text-4xl font-light mb-2">
            {totalPresent} de {totalStandard} ítems en estándar NOK
          </h1>
          <p className="text-[rgba(26,26,26,0.45)]">
            Faltan <span className="text-[#D6A700] font-semibold">{formatPrice(totalMissingValue)}</span> en artículos
          </p>
        </div>

        {/* Category cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Object.entries(state.checkResults).map(([cat, data]) => {
            const meta = CATEGORY_META[cat] ?? { icon: '✅', label: cat }
            const pct = data.total > 0 ? Math.round((data.present / data.total) * 100) : 0
            const isExpanded = expandedCat === cat

            return (
              <div key={cat} className="bg-[#FFFFFF] border border-[rgba(26,26,26,0.08)] rounded-2xl overflow-hidden">
                <button
                  onClick={() => setExpandedCat(isExpanded ? null : cat)}
                  className="w-full p-5 flex items-center gap-4 text-left hover:bg-[#FFFFFF] transition-colors"
                >
                  <span className="text-2xl">{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[#1A1A1A] text-sm">{meta.label}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-2 bg-[#E5E3DF] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700 ease-out"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: pct === 100 ? '#0E6845' : pct >= 50 ? '#D6A700' : '#F20022',
                          }}
                        />
                      </div>
                      <span className="text-xs text-[rgba(26,26,26,0.45)] tabular-nums whitespace-nowrap">
                        {data.present}/{data.total}
                      </span>
                    </div>
                  </div>
                  <svg
                    className={`w-4 h-4 text-[rgba(26,26,26,0.3)] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="border-t border-[rgba(26,26,26,0.06)] px-5 py-3 space-y-2">
                    {data.items.map((item, i) => (
                      <div
                        key={i}
                        className={`flex items-center justify-between py-2 ${i < data.items.length - 1 ? 'border-b border-[rgba(26,26,26,0.04)]' : ''}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-sm">
                            {item.status === 'has_it' ? '✅' : item.status === 'not_nok_standard' ? '⚠️' : '❌'}
                          </span>
                          <span className={`text-sm ${item.status === 'has_it' ? 'text-[rgba(26,26,26,0.5)]' : 'text-[#1A1A1A]'}`}>
                            {item.name}
                            {item.quantity_needed > 1 && <span className="text-[rgba(26,26,26,0.3)]"> x{item.quantity_needed}</span>}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {item.status !== 'has_it' && item.unit_price > 0 && (
                            <span className="text-xs text-[#D6A700] tabular-nums">{formatPrice(item.unit_price)}</span>
                          )}
                          {item.link && (
                            <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-xs text-[#833B0E] hover:text-[#833B0E]">
                              ver
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Summary bar */}
        <div className="bg-[#FFFFFF] border border-[rgba(26,26,26,0.08)] rounded-2xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-sm text-[rgba(26,26,26,0.5)]">
                {totalPresent} de {totalStandard} ítems en estándar NOK
              </p>
              <p className="text-xl font-semibold text-[#D6A700] tabular-nums mt-1">
                Faltan {formatPrice(totalMissingValue)} en artículos
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => router.push('/apt-setup/photos')}
                className="px-5 py-3 border border-[rgba(26,26,26,0.15)] rounded-xl text-sm font-medium text-[#1A1A1A] hover:bg-[#FFFFFF] transition-colors"
              >
                Verificar con fotos
              </button>
              <button
                onClick={() => router.push('/apt-setup/quote')}
                className="px-5 py-3 bg-[#D6A700] hover:bg-[#C49800] text-[#F0EFED] rounded-xl text-sm font-semibold transition-colors"
              >
                Generar cotización
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Chat view
  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 200px)' }}>
      <div className="mb-6">
        <p className="text-[#D6A700] text-xs font-semibold tracking-[0.2em] uppercase mb-2">Paso 1</p>
        <h1 className="font-[family-name:var(--font-secondary)] text-3xl font-light">Verificación de estándares</h1>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-4 mb-6">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-[#D6A700] text-[#F0EFED] text-xs flex items-center justify-center font-bold mr-3 flex-shrink-0 mt-1">
                N
              </div>
            )}
            <div
              className={`max-w-md rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[#1A1A1A] text-[#F0EFED] rounded-tr-sm'
                  : 'bg-[#FFFFFF] text-[#1A1A1A] border border-[rgba(26,26,26,0.06)] rounded-tl-sm'
              }`}
            >
              <span className="whitespace-pre-wrap" dangerouslySetInnerHTML={{
                __html: (msg.content.replace(/```json[\s\S]*```/g, '').trim() || msg.content)
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              }} />
              {msg.role === 'assistant' && i === messages.length - 1 && isLoading && (
                <span className="inline-block w-1.5 h-4 bg-[#D6A700] ml-1 animate-pulse rounded-sm" />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="sticky bottom-0 bg-[#F0EFED] pt-4 pb-2">
        <div className="flex items-end gap-3">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe qué tienes..."
            rows={1}
            className="flex-1 bg-[#FFFFFF] border border-[rgba(26,26,26,0.1)] rounded-xl px-4 py-3 text-sm text-[#1A1A1A] placeholder:text-[rgba(26,26,26,0.25)] focus:outline-none focus:ring-2 focus:ring-[#D6A700]/50 focus:border-[#D6A700] resize-none transition-all"
            style={{ maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="p-3 bg-[#D6A700] hover:bg-[#C49800] text-[#F0EFED] rounded-xl transition-colors disabled:opacity-30 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-[rgba(26,26,26,0.2)] mt-2 text-center">Enter para enviar</p>
      </div>
    </div>
  )
}
