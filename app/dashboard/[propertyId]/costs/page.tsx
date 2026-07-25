import { notFound } from 'next/navigation'
import { loadOwnerProperty } from '@/lib/admin'
import { CATEGORY_LABELS, type OwnerCostRow } from '@/lib/owner-costs'
import { createOwnerCost, deleteOwnerCost } from './actions'

interface Props {
  params: Promise<{ propertyId: string }>
}

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

export default async function CostsPage({ params }: Props) {
  const { propertyId } = await params
  const { property, sb } = await loadOwnerProperty(propertyId)
  if (!property) notFound()

  const { data: costs } = (await sb
    .from('owner_costs')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })) as { data: OwnerCostRow[] | null }

  const monthly = (costs || []).filter((c) => c.frequency === 'monthly')
  const oneTime = (costs || []).filter((c) => c.frequency === 'one_time')

  const monthlyTotal = monthly.reduce((s, c) => s + Number(c.amount), 0)

  const createAction = async (formData: FormData) => {
    'use server'
    await createOwnerCost(propertyId, formData)
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Costos propios</h1>
        <p className="text-sm text-gray-500 mt-1">
          Registra tus gastos directos (hipoteca, condominio, mantenimiento, etc.).
          Se restarán automáticamente de tu ingreso neto en el resumen.
        </p>
      </div>

      {/* Form */}
      <form
        action={createAction}
        className="bg-white border border-gray-200 rounded-xl p-5 mb-8 space-y-4"
      >
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Agregar costo
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Descripción</label>
            <input
              name="label"
              required
              placeholder="Ej. Hipoteca Banco Popular"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#833B0E]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Categoría</label>
            <select
              name="category"
              defaultValue="other"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#833B0E]"
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Monto</label>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0"
              required
              placeholder="500"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#833B0E]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Moneda</label>
            <select
              name="currency"
              defaultValue="USD"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#833B0E]"
            >
              <option value="USD">USD</option>
              <option value="DOP">DOP</option>
              <option value="COP">COP</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Frecuencia</label>
            <select
              name="frequency"
              defaultValue="monthly"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#833B0E]"
            >
              <option value="monthly">Mensual (recurrente)</option>
              <option value="one_time">Pago único</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fecha inicio</label>
            <input
              name="start_date"
              type="date"
              required
              defaultValue={today}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#833B0E]"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Fecha fin <span className="text-gray-400">(opcional, solo para mensuales)</span>
            </label>
            <input
              name="end_date"
              type="date"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#833B0E]"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Notas <span className="text-gray-400">(opcional)</span>
            </label>
            <input
              name="notes"
              placeholder="Cualquier detalle adicional"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#833B0E]"
            />
          </div>
        </div>

        <button
          type="submit"
          className="px-5 py-2.5 bg-[#833B0E] hover:bg-[#6B3009] text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Agregar costo
        </button>
      </form>

      {/* Monthly list */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Costos mensuales recurrentes
          </h2>
          {monthly.length > 0 && (
            <p className="text-xs text-gray-500">
              Total mensual estimado:{' '}
              <span className="font-semibold text-gray-900">{fmt(monthlyTotal, 'USD')}*</span>
            </p>
          )}
        </div>
        {monthly.length === 0 ? (
          <EmptyCard text="No has registrado costos mensuales todavía." />
        ) : (
          <div className="space-y-2">
            {monthly.map((c) => (
              <CostRow key={c.id} cost={c} propertyId={propertyId} />
            ))}
          </div>
        )}
      </section>

      {/* One-time list */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Costos únicos
        </h2>
        {oneTime.length === 0 ? (
          <EmptyCard text="No has registrado costos únicos todavía." />
        ) : (
          <div className="space-y-2">
            {oneTime.map((c) => (
              <CostRow key={c.id} cost={c} propertyId={propertyId} />
            ))}
          </div>
        )}
      </section>

      {monthly.length > 0 && (
        <p className="text-xs text-gray-400 mt-6">
          * El total mensual se muestra en la moneda original sin conversión; en el Resumen se
          convierte a USD al TRM del día.
        </p>
      )}
    </div>
  )
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-400 text-sm">
      {text}
    </div>
  )
}

function CostRow({ cost, propertyId }: { cost: OwnerCostRow; propertyId: string }) {
  const deleteAction = async () => {
    'use server'
    await deleteOwnerCost(propertyId, cost.id)
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-gray-900 text-sm truncate">{cost.label}</p>
          {cost.category && (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {CATEGORY_LABELS[cost.category] || cost.category}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">
          Desde {cost.start_date}
          {cost.end_date ? ` · hasta ${cost.end_date}` : ''}
          {cost.notes ? ` · ${cost.notes}` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold text-gray-900">{fmt(Number(cost.amount), cost.currency)}</p>
        <p className="text-xs text-gray-400">{cost.frequency === 'monthly' ? 'por mes' : 'único'}</p>
      </div>
      <form action={deleteAction}>
        <button
          type="submit"
          className="text-xs text-gray-400 hover:text-red-600 transition-colors px-2 py-1"
          title="Eliminar"
        >
          ✕
        </button>
      </form>
    </div>
  )
}
