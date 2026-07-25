'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Image from 'next/image'

type Message = {
  role: 'user' | 'assistant'
  content: string
  attachments?: string[]
}

const STEPS = ['Datos', 'Chat', 'Catálogo', 'Cotización']

export default function OnboardingChatPage() {
  const router = useRouter()
  const params = useParams()
  const sessionId = params.sessionId as string

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: '¡Hola! Soy el asistente de NOK 👋 Voy a ayudarte a preparar el inventario completo de tu apartamento. Empecemos por la **cocina** — ¿qué electrodomésticos y utensilios tienes ahí actualmente?',
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setImageFiles(prev => [...prev, ...files])
    files.forEach(f => {
      const reader = new FileReader()
      reader.onload = ev => setImagePreviews(prev => [...prev, ev.target?.result as string])
      reader.readAsDataURL(f)
    })
  }

  const removeImage = (idx: number) => {
    setImageFiles(prev => prev.filter((_, i) => i !== idx))
    setImagePreviews(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text && imageFiles.length === 0) return
    if (isLoading) return

    const userMessage: Message = {
      role: 'user',
      content: text || '(foto adjunta)',
      attachments: imagePreviews.length > 0 ? [...imagePreviews] : undefined,
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setImageFiles([])
    setImagePreviews([])
    setIsLoading(true)

    let messageContent = text
    if (imageFiles.length > 0) {
      messageContent = `${text ? text + '\n\n' : ''}[El propietario adjuntó ${imageFiles.length} foto(s) del espacio]`
    }

    const chatMessages = [
      ...messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: messageContent },
    ]

    try {
      const res = await fetch('/api/onboarding/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, messages: chatMessages }),
      })

      if (!res.ok) throw new Error('Error en el chat')

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
          if (data.done && data.complete) setIsComplete(true)
        }
      }
    } catch (err) {
      console.error(err)
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Tuve un problema de conexión. ¿Puedes intentarlo de nuevo?' },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="min-h-screen bg-[#F0EFED] flex flex-col">
      {/* Header */}
      <header className="border-b border-[#EFEFEF] px-6 py-4 flex items-center justify-between flex-shrink-0">
        <Image src="/brand/nok-logo-dark.png" alt="NOK" width={110} height={30} priority />

        {/* Step indicator */}
        <div className="flex items-center gap-1.5 text-xs">
          {STEPS.map((step, i) => {
            const stepNum = i + 1
            const isActive = stepNum === 2
            const isDone = stepNum < 2
            return (
              <div key={step} className="flex items-center gap-1.5">
                {i > 0 && <span className="w-5 h-px bg-[#EFEFEF]" />}
                <span className={`w-6 h-6 rounded-full flex items-center justify-center font-semibold text-xs ${
                  isDone ? 'bg-[#0080C6] text-white' :
                  isActive ? 'bg-[#1A1A1A] text-white' :
                  'bg-[#EFEFEF] text-[#8A8A8A]'
                }`}>{stepNum}</span>
                <span className={`${isActive ? 'text-[#1A1A1A] font-medium' : 'text-[#C8C8C8]'}`}>{step}</span>
              </div>
            )
          })}
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 max-w-2xl mx-auto w-full">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-[#0080C6] text-white text-xs flex items-center justify-center font-bold mr-2 flex-shrink-0 mt-1">
                N
              </div>
            )}
            <div
              className={`max-w-sm rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[#1A1A1A] text-white rounded-tr-sm'
                  : 'bg-[#F7F7F7] text-[#1A1A1A] rounded-tl-sm'
              }`}
            >
              {msg.attachments && (
                <div className="flex gap-2 mb-2 flex-wrap">
                  {msg.attachments.map((src, j) => (
                    <div key={j} className="relative w-24 h-24 rounded-lg overflow-hidden">
                      <Image src={src} alt="foto adjunta" fill className="object-cover" />
                    </div>
                  ))}
                </div>
              )}
              <span className="whitespace-pre-wrap">{msg.content}</span>
              {msg.role === 'assistant' && i === messages.length - 1 && isLoading && (
                <span className="inline-block w-1.5 h-4 bg-[#0080C6] ml-1 animate-pulse rounded-sm" />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Complete banner */}
      {isComplete && (
        <div className="max-w-2xl mx-auto w-full px-4 mb-4">
          <div className="bg-[#E6F3FB] border border-[#0080C6]/20 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="font-semibold text-[#0080C6] text-sm">¡Inventario completo! 🎉</p>
              <p className="text-xs text-[#4A4A4A] mt-0.5">Revisa el catálogo y elige los productos que necesitas.</p>
            </div>
            <button
              onClick={() => router.push(`/onboarding/${sessionId}/catalog`)}
              className="bg-[#0080C6] hover:bg-[#0068A3] text-white text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors whitespace-nowrap"
            >
              Ver catálogo →
            </button>
          </div>
        </div>
      )}

      {/* Image previews */}
      {imagePreviews.length > 0 && (
        <div className="max-w-2xl mx-auto w-full px-4 pb-2">
          <div className="flex gap-2 flex-wrap">
            {imagePreviews.map((src, i) => (
              <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden group">
                <Image src={src} alt="preview" fill className="object-cover" />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs transition-opacity"
                >✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-[#EFEFEF] px-4 py-3 flex-shrink-0 max-w-2xl mx-auto w-full">
        <div className="flex items-end gap-2">
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 text-[#C8C8C8] hover:text-[#0080C6] hover:bg-[#E6F3FB] rounded-xl transition-colors flex-shrink-0"
            title="Adjuntar foto"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu respuesta..."
            rows={1}
            className="flex-1 border border-[#C8C8C8] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0080C6] focus:border-transparent resize-none leading-relaxed placeholder:text-[#C8C8C8]"
            style={{ maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || (!input.trim() && imageFiles.length === 0)}
            className="p-2.5 bg-[#0080C6] hover:bg-[#0068A3] text-white rounded-xl transition-colors disabled:opacity-40 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-[#C8C8C8] mt-2 text-center">Enter para enviar · Shift+Enter para nueva línea</p>
      </div>
    </div>
  )
}
