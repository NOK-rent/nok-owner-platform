'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

type ApartmentType = 'empty' | 'furnished' | null

export default function OnboardingStartPage() {
  const router = useRouter()

  const [form, setForm] = useState({
    owner_name: '',
    owner_email: '',
    owner_phone: '',
    property_address: '',
    property_city: 'Santo Domingo',
    property_country: 'DO',
    bedrooms: '',
    bathrooms: '',
  })
  const [apartmentType, setApartmentType] = useState<ApartmentType>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!apartmentType) {
      setError('Selecciona si el apartamento está vacío o amueblado')
      return
    }
    setLoading(true)
    setError('')

    const res = await fetch('/api/onboarding/create-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, apartment_type: apartmentType }),
    })

    const result = await res.json()

    if (!res.ok || !result.id) {
      setError('Error iniciando el proceso. Intenta de nuevo.')
      setLoading(false)
      return
    }

    if (apartmentType === 'empty') {
      router.push(`/onboarding/${result.id}/plan`)
    } else {
      router.push(`/onboarding/${result.id}/chat`)
    }
  }

  const inputClass = "w-full border border-[#C8C8C8] rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0080C6] focus:border-transparent transition bg-white placeholder:text-[#C8C8C8]"
  const selectClass = "w-full border border-[#C8C8C8] rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0080C6] focus:border-transparent transition bg-white"

  return (
    <div className="min-h-screen bg-[#F0EFED]">
      {/* Header */}
      <header className="border-b border-[#EFEFEF] px-6 py-4">
        <Image src="/brand/nok-logo-dark.png" alt="NOK" width={120} height={32} priority />
      </header>

      <div className="max-w-xl mx-auto px-6 py-12">
        {/* Intro */}
        <div className="mb-10">
          <p className="text-xs font-semibold tracking-widest text-[#0080C6] uppercase mb-3">
            Evaluación gratuita
          </p>
          <h1 className="text-3xl font-bold text-[#1A1A1A] mb-3 leading-tight">
            Empieza a ganar con tu apartamento
          </h1>
          <p className="text-[#8A8A8A] text-base">
            En 15–20 minutos sabrás exactamente qué necesitas y cuánto cuesta. Sin visitas, sin esperas.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Personal info */}
          <div className="space-y-4">
            <h2 className="text-xs font-semibold text-[#8A8A8A] uppercase tracking-widest">Tus datos</h2>
            <div>
              <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">Nombre completo</label>
              <input
                type="text"
                required
                value={form.owner_name}
                onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))}
                placeholder="María González"
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">Email</label>
                <input
                  type="email"
                  required
                  value={form.owner_email}
                  onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))}
                  placeholder="maria@email.com"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">WhatsApp</label>
                <input
                  type="tel"
                  value={form.owner_phone}
                  onChange={e => setForm(f => ({ ...f, owner_phone: e.target.value }))}
                  placeholder="+1 809 000 0000"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Property info */}
          <div className="space-y-4">
            <h2 className="text-xs font-semibold text-[#8A8A8A] uppercase tracking-widest">Tu apartamento</h2>
            <div>
              <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">Dirección</label>
              <input
                type="text"
                required
                value={form.property_address}
                onChange={e => setForm(f => ({ ...f, property_address: e.target.value }))}
                placeholder="Av. Winston Churchill 123, Apto 4B"
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">Ciudad</label>
                <select value={form.property_city} onChange={e => setForm(f => ({ ...f, property_city: e.target.value }))} className={selectClass}>
                  <option>Santo Domingo</option>
                  <option>Punta Cana</option>
                  <option>Santiago de los Caballeros</option>
                  <option>Las Terrenas</option>
                  <option>Bogotá</option>
                  <option>Medellín</option>
                  <option>Cartagena</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">País</label>
                <select value={form.property_country} onChange={e => setForm(f => ({ ...f, property_country: e.target.value }))} className={selectClass}>
                  <option value="DO">República Dominicana</option>
                  <option value="CO">Colombia</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">Habitaciones</label>
                <select value={form.bedrooms} onChange={e => setForm(f => ({ ...f, bedrooms: e.target.value }))} className={selectClass}>
                  <option value="">No sé aún</option>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} habitación{n > 1 ? 'es' : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">Baños</label>
                <select value={form.bathrooms} onChange={e => setForm(f => ({ ...f, bathrooms: e.target.value }))} className={selectClass}>
                  <option value="">No sé aún</option>
                  {[1,2,3,4].map(n => <option key={n} value={n}>{n} baño{n > 1 ? 's' : ''}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Apartment type */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-[#8A8A8A] uppercase tracking-widest">Estado del apartamento</h2>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setApartmentType('empty')}
                className={`p-5 rounded-xl border-2 text-left transition-all ${
                  apartmentType === 'empty'
                    ? 'border-[#0080C6] bg-[#E6F3FB]'
                    : 'border-[#EFEFEF] hover:border-[#0080C6]/40'
                }`}
              >
                <div className="text-2xl mb-2">🏗️</div>
                <div className={`font-semibold text-sm ${apartmentType === 'empty' ? 'text-[#0080C6]' : 'text-[#1A1A1A]'}`}>
                  Vacío / sin muebles
                </div>
                <div className="text-xs mt-1 text-[#8A8A8A]">
                  Subes el plano y la IA genera el inventario
                </div>
              </button>
              <button
                type="button"
                onClick={() => setApartmentType('furnished')}
                className={`p-5 rounded-xl border-2 text-left transition-all ${
                  apartmentType === 'furnished'
                    ? 'border-[#0080C6] bg-[#E6F3FB]'
                    : 'border-[#EFEFEF] hover:border-[#0080C6]/40'
                }`}
              >
                <div className="text-2xl mb-2">🛋️</div>
                <div className={`font-semibold text-sm ${apartmentType === 'furnished' ? 'text-[#0080C6]' : 'text-[#1A1A1A]'}`}>
                  Con muebles
                </div>
                <div className="text-xs mt-1 text-[#8A8A8A]">
                  Chat con IA espacio por espacio
                </div>
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-lg border border-red-100">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#0080C6] hover:bg-[#0068A3] text-white py-4 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Iniciando...' : 'Empezar evaluación →'}
          </button>

          <p className="text-xs text-center text-[#C8C8C8]">
            Sin compromiso · Cotización gratuita · Tu información es confidencial
          </p>
        </form>
      </div>
    </div>
  )
}
