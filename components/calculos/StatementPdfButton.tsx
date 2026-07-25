'use client'

import { useState } from 'react'
import type { MonthlyStatement } from '@/lib/monthly-statement'

interface Props {
  statement: MonthlyStatement
  ownerName: string
  monthLabel: string
}

export default function StatementPdfButton({ statement, ownerName, monthLabel }: Props) {
  const [busy, setBusy] = useState(false)

  async function download() {
    if (busy) return
    setBusy(true)
    try {
      // Import on click — react-pdf pesa; no cargarlo con la página
      const [{ pdf }, { StatementPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/lib/statement-pdf'),
      ])
      const blob = await pdf(
        <StatementPDF s={statement} ownerName={ownerName} monthLabel={monthLabel} />
      ).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `NOK-estado-de-cuenta-${statement.propertyName.replace(/\s+/g, '-')}-${statement.monthKey}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('PDF error', e)
      alert('No se pudo generar el PDF. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={download}
      disabled={busy}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-60"
      style={{ backgroundColor: '#1A1A1A', color: '#FFFFFF' }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {busy ? 'Generando…' : 'Descargar PDF'}
    </button>
  )
}
