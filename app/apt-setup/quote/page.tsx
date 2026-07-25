'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWizard } from '@/components/apt-setup/WizardContext'
import type { AptSetupQuoteData, AptSetupQuoteCategory, AptSetupPhotoSummary } from '@/lib/apt-setup-pdf'

const CATEGORY_LABELS: Record<string, string> = {
  sala: 'Sala / Comedor',
  habitacion: 'Habitaciones',
  cocina: 'Cocina',
  lenceria: 'Lencería',
}

const CLEANING_FEE = 150000

export default function QuotePage() {
  const router = useRouter()
  const { state } = useWizard()
  const [downloading, setDownloading] = useState(false)

  const currency = state.country === 'CO' ? 'COP' : 'DOP'

  const formatPrice = (n: number) =>
    new Intl.NumberFormat('es-CO', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

  // Build categories from check results
  const categories: AptSetupQuoteCategory[] = Object.entries(state.checkResults).map(([cat, data]) => ({
    category: cat,
    label: CATEGORY_LABELS[cat] ?? cat,
    items: data.items.map(item => ({
      name: item.name,
      status: item.status === 'has_it' ? 'has_it' as const : item.status === 'not_nok_standard' ? 'not_nok_standard' as const : 'missing' as const,
      quantity: item.quantity_needed,
      unit_price: item.unit_price,
      currency,
    })),
  }))

  // Photo summaries
  const photoSummaries: AptSetupPhotoSummary[] = Object.entries(
    state.photoResults.reduce<Record<string, typeof state.photoResults>>((acc, p) => {
      if (!acc[p.category]) acc[p.category] = []
      acc[p.category].push(p)
      return acc
    }, {})
  ).map(([cat, photos]) => ({
    category: cat,
    total_photos: photos.length,
    approved: photos.filter(p => p.overall_status === 'approved').length,
    needs_review: photos.filter(p => p.overall_status === 'needs_review').length,
    rejected: photos.filter(p => p.overall_status === 'rejected').length,
    issues: photos.flatMap(p => p.issues),
  }))

  // Totals
  const presentItems = categories.flatMap(c => c.items.filter(i => i.status === 'has_it'))
  const missingItems = categories.flatMap(c => c.items.filter(i => i.status === 'missing'))
  const replaceItems = categories.flatMap(c => c.items.filter(i => i.status === 'not_nok_standard'))
  const missingTotal = missingItems.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  const replaceTotal = replaceItems.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  const grandTotal = missingTotal + replaceTotal + CLEANING_FEE

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const quoteData: AptSetupQuoteData = {
        owner_name: state.owner_name,
        owner_email: state.owner_email,
        property_address: state.property_address,
        property_city: state.property_city,
        country: state.country,
        bedrooms: state.bedrooms,
        bathrooms: state.bathrooms,
        categories,
        photo_summaries: photoSummaries,
        cleaning_fee: CLEANING_FEE,
        currency,
      }

      const res = await fetch('/api/apt-setup/generate-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteData }),
      })

      if (!res.ok) throw new Error('PDF generation failed')

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') ?? 'cotizacion-nok.pdf'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
    } finally {
      setDownloading(false)
    }
  }

  if (!state.checkComplete) {
    return (
      <div className="text-center py-20">
        <p className="text-[rgba(26,26,26,0.5)] mb-4">Primero completa la verificación de estándares.</p>
        <button
          onClick={() => router.push('/apt-setup/check')}
          className="px-6 py-3 bg-[#D6A700] text-[#F0EFED] rounded-xl text-sm font-semibold"
        >
          Ir al check
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center sm:text-left">
        <p className="text-[#D6A700] text-xs font-semibold tracking-[0.2em] uppercase mb-2">Paso 3</p>
        <h1 className="font-[family-name:var(--font-secondary)] text-3xl sm:text-4xl font-light mb-2">
          Cotización Express
        </h1>
        <p className="text-[rgba(26,26,26,0.45)] text-sm">
          Revisa el detalle de tu inversión para alcanzar el estándar NOK.
        </p>
      </div>

      {/* Quote preview card */}
      <div className="bg-[#FFFFFF] border border-[rgba(26,26,26,0.08)] rounded-2xl overflow-hidden">
        {/* Quote header */}
        <div className="bg-gradient-to-r from-[#D6A700]/10 to-transparent px-6 py-5 border-b border-[rgba(26,26,26,0.06)]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-xs text-[rgba(26,26,26,0.4)] tracking-wider uppercase">Cotización Express</p>
              <p className="text-[#1A1A1A] font-medium mt-1">{state.property_address}</p>
              <p className="text-xs text-[rgba(26,26,26,0.4)]">{state.property_city} &middot; {state.bedrooms}H {state.bathrooms}B</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[rgba(26,26,26,0.4)]">Preparado para</p>
              <p className="text-[#1A1A1A] font-medium">{state.owner_name}</p>
            </div>
          </div>
        </div>

        {/* Category tables */}
        <div className="divide-y divide-[rgba(26,26,26,0.04)]">
          {categories.map(cat => (
            <div key={cat.category} className="px-6 py-5">
              <h3 className="text-sm font-semibold text-[#1A1A1A] mb-3">{cat.label}</h3>
              <div className="space-y-1">
                {/* Header row */}
                <div className="flex items-center text-xs text-[rgba(26,26,26,0.3)] uppercase tracking-wider pb-2 border-b border-[rgba(26,26,26,0.04)]">
                  <span className="flex-1">Item</span>
                  <span className="w-24 text-center">Estado</span>
                  <span className="w-12 text-center">Cant.</span>
                  <span className="w-24 text-right">Precio</span>
                  <span className="w-24 text-right">Total</span>
                </div>
                {cat.items.map((item, j) => {
                  const isMissing = item.status !== 'has_it'
                  return (
                    <div
                      key={j}
                      className={`flex items-center py-2 text-sm ${isMissing ? 'border-l-2 border-[#D6A700] pl-3 -ml-3' : ''}`}
                    >
                      <span className={`flex-1 ${isMissing ? 'text-[#1A1A1A]' : 'text-[rgba(26,26,26,0.4)]'}`}>
                        {item.name}
                      </span>
                      <span className="w-24 text-center">
                        {item.status === 'has_it' ? (
                          <span className="text-xs text-[#0E6845]">Presente</span>
                        ) : item.status === 'missing' ? (
                          <span className="text-xs text-[#D6A700]">+ Faltante</span>
                        ) : (
                          <span className="text-xs text-[#F20022]">Reemplazar</span>
                        )}
                      </span>
                      <span className="w-12 text-center text-[rgba(26,26,26,0.5)] tabular-nums">{item.quantity}</span>
                      <span className="w-24 text-right text-[rgba(26,26,26,0.5)] tabular-nums">
                        {isMissing && item.unit_price > 0 ? formatPrice(item.unit_price) : '-'}
                      </span>
                      <span className="w-24 text-right font-medium tabular-nums">
                        {isMissing && item.unit_price > 0 ? (
                          <span className="text-[#D6A700]">{formatPrice(item.unit_price * item.quantity)}</span>
                        ) : (
                          <span className="text-[rgba(26,26,26,0.2)]">-</span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Photo summary */}
        {photoSummaries.length > 0 && (
          <div className="px-6 py-5 border-t border-[rgba(26,26,26,0.06)]">
            <h3 className="text-sm font-semibold text-[#1A1A1A] mb-3">Verificación fotográfica</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {photoSummaries.map(ps => (
                <div key={ps.category} className="bg-[#FFFFFF] rounded-xl p-3">
                  <p className="text-xs text-[rgba(26,26,26,0.4)] mb-1">{CATEGORY_LABELS[ps.category] ?? ps.category}</p>
                  <div className="flex items-center gap-2 text-xs">
                    {ps.approved > 0 && <span className="text-[#0E6845]">{ps.approved} ok</span>}
                    {ps.needs_review > 0 && <span className="text-[#D6A700]">{ps.needs_review} revisar</span>}
                    {ps.rejected > 0 && <span className="text-[#F20022]">{ps.rejected} no</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="bg-[#F0EFED] px-6 py-6">
          <div className="space-y-2.5 mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-[rgba(26,26,26,0.5)]">Items presentes</span>
              <span className="text-[#1A1A1A]">{presentItems.length} ítems</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[rgba(26,26,26,0.5)]">Items faltantes</span>
              <span className="text-[#D6A700]">{missingItems.length} ítems &mdash; {formatPrice(missingTotal)}</span>
            </div>
            {replaceItems.length > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[rgba(26,26,26,0.5)]">Items a reemplazar</span>
                <span className="text-[#F20022]">{replaceItems.length} ítems &mdash; {formatPrice(replaceTotal)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-[rgba(26,26,26,0.5)]">Preparación</span>
              <span className="text-[#1A1A1A]">{formatPrice(CLEANING_FEE)}</span>
            </div>
          </div>

          <div className="border-t border-[rgba(26,26,26,0.08)] pt-4">
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-[#1A1A1A]">Inversión total estimada</span>
              <span className="text-2xl font-bold text-[#D6A700] tabular-nums">{formatPrice(grandTotal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Note */}
      <p className="text-xs text-[rgba(26,26,26,0.25)] text-center">
        Esta cotización es estimada. El equipo NOK confirmará valores finales.
      </p>

      {/* Download CTA */}
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="w-full sm:w-auto px-10 py-4 bg-[#D6A700] hover:bg-[#C49800] text-[#F0EFED] rounded-xl font-semibold text-sm transition-all duration-200 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {downloading ? (
            <>
              <div className="w-4 h-4 border-2 border-[#F0EFED] border-t-transparent rounded-full animate-spin" />
              Generando PDF...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Descargar PDF
            </>
          )}
        </button>

        <div className="flex gap-4">
          <button
            onClick={() => router.push('/apt-setup/photos')}
            className="text-sm text-[rgba(26,26,26,0.4)] hover:text-[#1A1A1A] transition-colors"
          >
            Volver a fotos
          </button>
          <button
            onClick={() => router.push('/apt-setup')}
            className="text-sm text-[rgba(26,26,26,0.4)] hover:text-[#1A1A1A] transition-colors"
          >
            Nueva cotización
          </button>
        </div>
      </div>
    </div>
  )
}
