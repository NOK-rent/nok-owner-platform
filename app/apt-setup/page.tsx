'use client'

import { useRouter } from 'next/navigation'
import { useWizard } from '@/components/apt-setup/WizardContext'
import { useState } from 'react'

const CITIES_CO = ['Bogotá', 'Medellín', 'Cartagena', 'Barranquilla', 'Cali', 'Santa Marta']
const CITIES_DO = ['Santo Domingo', 'Punta Cana', 'Santiago de los Caballeros', 'Las Terrenas']

export default function AptSetupEntry() {
  const router = useRouter()
  const { state, updateState } = useWizard()
  const [errors, setErrors] = useState<Record<string, boolean>>({})

  const cities = state.country === 'CO' ? CITIES_CO : CITIES_DO

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const newErrors: Record<string, boolean> = {}
    if (!state.owner_name.trim()) newErrors.owner_name = true
    if (!state.owner_email.trim()) newErrors.owner_email = true
    if (!state.property_address.trim()) newErrors.property_address = true
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }
    router.push('/apt-setup/check')
  }

  const inputClass = (field: string) =>
    `w-full bg-[#FFFFFF] border ${errors[field] ? 'border-[#F20022]' : 'border-[rgba(26,26,26,0.1)]'} rounded-xl px-4 py-3.5 text-sm text-[#1A1A1A] placeholder:text-[rgba(26,26,26,0.25)] focus:outline-none focus:ring-2 focus:ring-[#D6A700]/50 focus:border-[#D6A700] transition-all`

  const selectClass =
    'w-full bg-[#FFFFFF] border border-[rgba(26,26,26,0.1)] rounded-xl px-4 py-3.5 text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#D6A700]/50 focus:border-[#D6A700] transition-all appearance-none'

  return (
    <div className="max-w-xl mx-auto">
      {/* Hero */}
      <div className="mb-10 text-center sm:text-left">
        <p className="text-[#D6A700] text-xs font-semibold tracking-[0.2em] uppercase mb-3">
          Apt Setup
        </p>
        <h1 className="font-[family-name:var(--font-secondary)] text-4xl sm:text-5xl font-light text-[#1A1A1A] mb-3 leading-tight">
          Prepara tu apartamento
        </h1>
        <p className="text-[rgba(26,26,26,0.45)] text-base">
          Verificamos tu inventario contra los est&aacute;ndares NOK, analizamos fotos y generamos tu cotizaci&oacute;n en minutos.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Personal info */}
        <div className="space-y-4">
          <h2 className="text-xs font-semibold text-[rgba(26,26,26,0.4)] uppercase tracking-[0.15em]">
            Propietario
          </h2>
          <div>
            <label className="block text-sm font-medium text-[rgba(26,26,26,0.7)] mb-1.5">
              Nombre completo
            </label>
            <input
              type="text"
              required
              value={state.owner_name}
              onChange={e => { updateState({ owner_name: e.target.value }); setErrors(p => ({ ...p, owner_name: false })) }}
              placeholder="María González"
              className={inputClass('owner_name')}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[rgba(26,26,26,0.7)] mb-1.5">Email</label>
              <input
                type="email"
                required
                value={state.owner_email}
                onChange={e => { updateState({ owner_email: e.target.value }); setErrors(p => ({ ...p, owner_email: false })) }}
                placeholder="maria@email.com"
                className={inputClass('owner_email')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[rgba(26,26,26,0.7)] mb-1.5">WhatsApp</label>
              <input
                type="tel"
                value={state.owner_phone}
                onChange={e => updateState({ owner_phone: e.target.value })}
                placeholder="+57 300 000 0000"
                className={inputClass('owner_phone')}
              />
            </div>
          </div>
        </div>

        {/* Property info */}
        <div className="space-y-4">
          <h2 className="text-xs font-semibold text-[rgba(26,26,26,0.4)] uppercase tracking-[0.15em]">
            Apartamento
          </h2>
          <div>
            <label className="block text-sm font-medium text-[rgba(26,26,26,0.7)] mb-1.5">Direcci&oacute;n</label>
            <input
              type="text"
              required
              value={state.property_address}
              onChange={e => { updateState({ property_address: e.target.value }); setErrors(p => ({ ...p, property_address: false })) }}
              placeholder="Cra 7 #123-45, Apto 801"
              className={inputClass('property_address')}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[rgba(26,26,26,0.7)] mb-1.5">Pa&iacute;s</label>
              <select
                value={state.country}
                onChange={e => updateState({ country: e.target.value as 'CO' | 'DO', property_city: e.target.value === 'CO' ? 'Bogotá' : 'Santo Domingo' })}
                className={selectClass}
              >
                <option value="CO">Colombia</option>
                <option value="DO">Rep&uacute;blica Dominicana</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[rgba(26,26,26,0.7)] mb-1.5">Ciudad</label>
              <select
                value={state.property_city}
                onChange={e => updateState({ property_city: e.target.value })}
                className={selectClass}
              >
                {cities.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[rgba(26,26,26,0.7)] mb-1.5">Habitaciones</label>
              <select
                value={state.bedrooms}
                onChange={e => updateState({ bedrooms: Number(e.target.value) })}
                className={selectClass}
              >
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[rgba(26,26,26,0.7)] mb-1.5">Ba&ntilde;os</label>
              <select
                value={state.bathrooms}
                onChange={e => updateState({ bathrooms: Number(e.target.value) })}
                className={selectClass}
              >
                {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="w-full bg-[#D6A700] hover:bg-[#C49800] text-[#F0EFED] py-4 rounded-xl font-semibold text-sm transition-all duration-200 active:scale-[0.98]"
        >
          Iniciar verificaci&oacute;n
        </button>

        <p className="text-xs text-center text-[rgba(26,26,26,0.2)]">
          Sin compromiso &middot; Cotizaci&oacute;n gratuita &middot; Informaci&oacute;n confidencial
        </p>
      </form>
    </div>
  )
}
