export const metadata = { title: 'Sin conexión — NOK' }

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: '#F0EFED' }}>
      <div className="text-center max-w-sm">
        <p className="font-serif text-3xl font-light tracking-[0.25em] text-[#1A1A1A]">NOK</p>
        <h1 className="font-serif text-2xl font-light text-[#1A1A1A] mt-6">Sin conexión</h1>
        <p className="text-sm mt-2" style={{ color: 'rgba(26,26,26,0.5)' }}>
          Parece que no tienes internet en este momento. Vuelve a intentarlo cuando recuperes la conexión.
        </p>
        <a href="/dashboard" className="inline-block mt-6 px-5 py-2.5 rounded-lg text-sm font-medium" style={{ backgroundColor: '#833B0E', color: '#FFFFFF' }}>
          Reintentar
        </a>
      </div>
    </div>
  )
}
