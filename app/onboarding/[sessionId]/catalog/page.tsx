'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createClient = () => createBrowserClient<any>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
import Image from 'next/image'

type InventoryItem = {
  id: string
  space: string
  item_name: string
  status: 'has_it' | 'missing' | 'not_nok_standard' | 'optional'
  quantity_needed: number
  selected_color: string | null
  unit_price: number | null
  currency: string | null
  notes: string | null
  catalog_item_id: string | null
  catalog_items?: {
    id: string
    name: string
    provider: string
    price: number
    currency: string
    photo_url: string | null
    colors_available: Array<{ color: string; photo_url: string }>
    purchase_url: string | null
  } | null
}

type Selection = {
  color?: string
  quantity?: number
}

const SPACE_LABELS: Record<string, string> = {
  sala: 'Sala / Comedor',
  cocina: 'Cocina',
  habitacion: 'Habitaciones',
  baño: 'Baños',
  general: 'General',
  lavanderia: 'Lavandería',
  terraza: 'Terraza',
}

const STATUS_CONFIG = {
  has_it: { label: 'Lo tienes', icon: '✅', bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
  missing: { label: 'Lo necesitas', icon: '❌', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' },
  not_nok_standard: { label: 'No cumple NOK', icon: '⚠️', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
  optional: { label: 'Opcional', icon: '⚪', bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-500' },
}

function formatCurrency(amount: number, currency: string): string {
  if (currency === 'DOP') return `RD$${amount.toLocaleString()}`
  if (currency === 'COP') return `$${amount.toLocaleString()}`
  return `$${amount.toFixed(0)}`
}

export default function CatalogPage() {
  const router = useRouter()
  const params = useParams()
  const sessionId = params.sessionId as string
  const supabase = createClient()

  const [items, setItems] = useState<InventoryItem[]>([])
  const [selections, setSelections] = useState<Record<string, Selection>>({})
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [activeTab, setActiveTab] = useState<'missing' | 'has_it' | 'not_nok_standard'>('missing')

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('onboarding_inventory_items')
        .select(`
          *,
          catalog_items (
            id, name, provider, price, currency, photo_url,
            colors_available, purchase_url
          )
        `)
        .eq('session_id', sessionId)
        .order('space')

      setItems((data as InventoryItem[]) ?? [])
      setLoading(false)
    }
    load()
  }, [sessionId, supabase])

  const updateSelection = (itemId: string, updates: Partial<Selection>) => {
    setSelections(prev => ({ ...prev, [itemId]: { ...prev[itemId], ...updates } }))
  }

  const updateItemInDB = async (itemId: string) => {
    const sel = selections[itemId]
    if (!sel) return
    await supabase
      .from('onboarding_inventory_items')
      .update({ selected_color: sel.color, quantity_needed: sel.quantity })
      .eq('id', itemId)
  }

  const totalItems = items.filter(i => i.status === 'missing' || i.status === 'not_nok_standard')
  const grandTotal = totalItems.reduce((sum, item) => {
    const price = item.unit_price ?? item.catalog_items?.price ?? 0
    const qty = selections[item.id]?.quantity ?? item.quantity_needed
    return sum + price * qty
  }, 0)
  const currency = items[0]?.currency ?? items[0]?.catalog_items?.currency ?? 'DOP'

  const spaces = [...new Set(items.map(i => i.space))]
  const filteredItems = items.filter(i => i.status === activeTab)

  const handleGenerateQuote = async () => {
    setGenerating(true)
    // Save all selections first
    await Promise.all(Object.keys(selections).map(id => updateItemInDB(id)))

    try {
      const res = await fetch('/api/onboarding/generate-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })

      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = res.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') ?? 'cotizacion-nok.pdf'
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setGenerating(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F0EFED] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Cargando tu inventario...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <span className="text-xl font-bold tracking-widest">NOK</span>
        <div className="flex items-center gap-4">
          {grandTotal > 0 && (
            <div className="text-right">
              <p className="text-xs text-gray-400">Total estimado</p>
              <p className="font-bold text-gray-900">{formatCurrency(grandTotal, currency)}</p>
            </div>
          )}
          <button
            onClick={handleGenerateQuote}
            disabled={generating}
            className="bg-gray-900 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {generating ? 'Generando...' : 'Generar cotización →'}
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Tu inventario NOK</h1>
          <p className="text-gray-500 text-sm mt-1">
            {items.filter(i => i.status === 'has_it').length} ítems ✅ ·{' '}
            {items.filter(i => i.status === 'missing').length} faltan ❌ ·{' '}
            {items.filter(i => i.status === 'not_nok_standard').length} no cumplen ⚠️
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl">
          {([
            { key: 'missing', label: `Necesitas (${items.filter(i => i.status === 'missing').length})` },
            { key: 'not_nok_standard', label: `No cumple NOK (${items.filter(i => i.status === 'not_nok_standard').length})` },
            { key: 'has_it', label: `Ya tienes (${items.filter(i => i.status === 'has_it').length})` },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {filteredItems.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-4xl mb-3">
              {activeTab === 'has_it' ? '✅' : activeTab === 'missing' ? '❌' : '⚠️'}
            </p>
            <p className="text-sm">No hay ítems en esta categoría</p>
          </div>
        ) : (
          <div className="space-y-4">
            {spaces.map(space => {
              const spaceItems = filteredItems.filter(i => i.space === space)
              if (!spaceItems.length) return null
              return (
                <div key={space}>
                  <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">
                    {SPACE_LABELS[space] ?? space}
                  </h2>
                  <div className="space-y-2">
                    {spaceItems.map(item => {
                      const cfg = STATUS_CONFIG[item.status]
                      const cat = item.catalog_items
                      const sel = selections[item.id] ?? {}
                      const price = item.unit_price ?? cat?.price ?? 0
                      const qty = sel.quantity ?? item.quantity_needed
                      const colors = cat?.colors_available ?? []

                      return (
                        <div key={item.id} className={`bg-white rounded-xl border ${cfg.border} p-4`}>
                          <div className="flex items-start gap-3">
                            {/* Photo */}
                            <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                              {cat?.photo_url ? (
                                <Image src={cat.photo_url} alt={item.item_name} width={64} height={64} className="object-cover w-full h-full" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-300 text-2xl">
                                  {cfg.icon}
                                </div>
                              )}
                            </div>
                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-semibold text-gray-900 text-sm">{item.item_name}</p>
                                  {cat && (
                                    <p className="text-xs text-gray-400 mt-0.5">{cat.provider}</p>
                                  )}
                                </div>
                                <div className="text-right flex-shrink-0">
                                  {price > 0 && (
                                    <p className="font-bold text-gray-900 text-sm">{formatCurrency(price * qty, item.currency ?? 'DOP')}</p>
                                  )}
                                  <span className={`text-xs ${cfg.text}`}>{cfg.label}</span>
                                </div>
                              </div>

                              {item.notes && (
                                <p className="text-xs text-gray-500 mt-1 bg-gray-50 px-2 py-1 rounded">{item.notes}</p>
                              )}

                              {/* Controls (only for items to buy) */}
                              {(item.status === 'missing' || item.status === 'not_nok_standard') && (
                                <div className="flex items-center gap-3 mt-3 flex-wrap">
                                  {/* Quantity */}
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => updateSelection(item.id, { quantity: Math.max(1, (sel.quantity ?? item.quantity_needed) - 1) })}
                                      className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-sm hover:bg-gray-200"
                                    >−</button>
                                    <span className="text-sm font-medium w-4 text-center">{qty}</span>
                                    <button
                                      onClick={() => updateSelection(item.id, { quantity: (sel.quantity ?? item.quantity_needed) + 1 })}
                                      className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-sm hover:bg-gray-200"
                                    >+</button>
                                  </div>

                                  {/* Color selector */}
                                  {colors.length > 0 && (
                                    <div className="flex items-center gap-1.5">
                                      {colors.map(c => (
                                        <button
                                          key={c.color}
                                          onClick={() => updateSelection(item.id, { color: c.color })}
                                          title={c.color}
                                          className={`text-xs px-2 py-0.5 rounded-full border transition-all ${
                                            (sel.color ?? item.selected_color) === c.color
                                              ? 'border-gray-900 bg-gray-900 text-white'
                                              : 'border-gray-200 text-gray-600 hover:border-gray-400'
                                          }`}
                                        >
                                          {c.color}
                                        </button>
                                      ))}
                                    </div>
                                  )}

                                  {/* Link */}
                                  {cat?.purchase_url && (
                                    <a
                                      href={cat.purchase_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-blue-600 hover:underline ml-auto"
                                    >
                                      Ver en tienda ↗
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Bottom CTA */}
        <div className="mt-8 bg-gray-900 rounded-2xl p-6 text-white text-center">
          <p className="text-lg font-bold mb-1">Total a invertir: {formatCurrency(grandTotal, currency)}</p>
          <p className="text-sm text-gray-400 mb-4">{totalItems.length} ítems seleccionados</p>
          <button
            onClick={handleGenerateQuote}
            disabled={generating}
            className="bg-white text-gray-900 font-bold px-8 py-3 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {generating ? 'Generando PDF...' : 'Generar mi cotización →'}
          </button>
        </div>
      </div>
    </div>
  )
}
