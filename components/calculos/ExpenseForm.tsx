'use client'

import { useRef, useState, useTransition } from 'react'
import { addExpense, removeExpense } from '@/app/dashboard/[propertyId]/calculos/actions'

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'admin', label: 'Administración' },
  { value: 'bank', label: 'Banco / crédito' },
  { value: 'hoa', label: 'Condominio / HOA' },
  { value: 'mortgage', label: 'Hipoteca' },
  { value: 'insurance', label: 'Seguro' },
  { value: 'property_tax', label: 'Impuestos' },
  { value: 'utilities', label: 'Servicios' },
  { value: 'maintenance', label: 'Mantenimiento' },
  { value: 'other', label: 'Otro' },
]

const inputStyle: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  border: '1px solid rgba(26,26,26,0.12)',
  color: '#1A1A1A',
}

export function AddExpenseForm({ propertyId, monthKey }: { propertyId: string; monthKey: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [freq, setFreq] = useState('monthly')
  const formRef = useRef<HTMLFormElement>(null)

  function onSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      try {
        await addExpense(propertyId, formData)
        formRef.current?.reset()
        setFreq('monthly')
      } catch {
        setError('No se pudo guardar el gasto. Revisa los datos e intenta de nuevo.')
      }
    })
  }

  return (
    <form ref={formRef} action={onSubmit} className="mt-4">
      <input type="hidden" name="month" value={monthKey} />
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <input
          name="label"
          required
          placeholder="Ej: Cuota administración"
          className="col-span-2 px-3 py-2 rounded-lg text-sm outline-none"
          style={inputStyle}
        />
        <select name="category" className="px-3 py-2 rounded-lg text-sm outline-none cursor-pointer" style={inputStyle} defaultValue="admin">
          {CATEGORY_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="flex gap-1">
          <input
            name="amount"
            required
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Monto"
            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
            style={inputStyle}
          />
          <select name="currency" className="px-2 py-2 rounded-lg text-sm outline-none cursor-pointer" style={inputStyle} defaultValue="USD">
            <option value="USD">USD</option>
            <option value="COP">COP</option>
            <option value="DOP">DOP</option>
          </select>
        </div>
        <select name="frequency" value={freq} onChange={e => setFreq(e.target.value)} className="px-3 py-2 rounded-lg text-sm outline-none cursor-pointer" style={inputStyle}>
          <option value="monthly">Cada mes</option>
          <option value="one_time">Solo este mes</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer disabled:opacity-60"
          style={{ backgroundColor: '#833B0E', color: '#FFFFFF' }}
        >
          {pending ? 'Guardando…' : '+ Agregar'}
        </button>
      </div>

      {/* Vigencia — el owner designa desde/hasta qué mes aplica */}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <label className="text-[11px] flex items-center gap-1.5" style={{ color: 'rgba(26,26,26,0.5)' }}>
          Desde
          <input type="month" name="start_month" defaultValue={monthKey} className="px-2 py-1 rounded-lg text-xs outline-none" style={inputStyle} />
        </label>
        {freq === 'monthly' && (
          <label className="text-[11px] flex items-center gap-1.5" style={{ color: 'rgba(26,26,26,0.5)' }}>
            Hasta (opcional)
            <input type="month" name="end_month" min={monthKey} className="px-2 py-1 rounded-lg text-xs outline-none" style={inputStyle} />
          </label>
        )}
        <span className="text-[11px]" style={{ color: 'rgba(26,26,26,0.35)' }}>
          {freq === 'monthly' ? 'Se descuenta cada mes en el rango que elijas (sin “hasta” = permanente).' : 'Se descuenta solo en el mes “desde”.'}
        </span>
      </div>
      {error && <p className="mt-2 text-xs" style={{ color: '#F20022' }}>{error}</p>}
    </form>
  )
}

export function RemoveExpenseButton({ propertyId, costId }: { propertyId: string; costId: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      onClick={() => startTransition(async () => { try { await removeExpense(propertyId, costId) } catch { /* noop */ } })}
      disabled={pending}
      aria-label="Eliminar gasto"
      className="w-7 h-7 flex items-center justify-center rounded-full transition-colors cursor-pointer disabled:opacity-50"
      style={{ color: 'rgba(26,26,26,0.35)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#F20022' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(26,26,26,0.35)' }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    </button>
  )
}
