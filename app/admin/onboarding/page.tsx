import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function AdminOnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const serviceSupabase = createServiceClient()
  const { data: sessions } = await serviceSupabase
    .from('onboarding_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  const statusLabel: Record<string, string> = {
    chat_in_progress: 'En chat',
    chat_complete: 'Chat listo',
    catalog_viewed: 'Vio catálogo',
    quote_sent: 'Cotización enviada',
    converted: 'Convertido',
  }

  const statusColor: Record<string, string> = {
    chat_in_progress: 'bg-yellow-100 text-yellow-800',
    chat_complete: 'bg-blue-100 text-blue-800',
    catalog_viewed: 'bg-purple-100 text-purple-800',
    quote_sent: 'bg-green-100 text-green-800',
    converted: 'bg-emerald-100 text-emerald-800',
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1A1A]">Cotizaciones express</h1>
          <p className="text-sm text-gray-500 mt-1">{sessions?.length ?? 0} sesiones registradas</p>
        </div>
        <Link
          href="/onboarding"
          className="bg-[#0080C6] hover:bg-[#0068A3] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
        >
          + Nueva cotización
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-[#EFEFEF] overflow-hidden">
        {!sessions?.length ? (
          <div className="p-12 text-center text-gray-400">
            <p className="text-4xl mb-3">📋</p>
            <p className="font-medium">Aún no hay sesiones</p>
            <p className="text-sm mt-1">Las cotizaciones aparecerán aquí cuando los propietarios completen el formulario.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#EFEFEF] bg-[#F7F7F7]">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Propietario</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Propiedad</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Fecha</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={s.id} className={`border-b border-[#EFEFEF] hover:bg-[#F7F7F7] transition-colors ${i === sessions.length - 1 ? 'border-b-0' : ''}`}>
                  <td className="px-5 py-4">
                    <p className="font-medium text-[#1A1A1A]">{s.owner_name}</p>
                    <p className="text-xs text-gray-400">{s.owner_email}</p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-[#1A1A1A]">{s.property_address}</p>
                    <p className="text-xs text-gray-400">{s.property_city} · {s.bedrooms ? `${s.bedrooms}h` : ''}{s.bathrooms ? ` ${s.bathrooms}b` : ''}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor[s.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {statusLabel[s.status] ?? s.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-gray-500 text-xs">
                    {new Date(s.created_at).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`/onboarding/${s.id}/catalog`}
                      className="text-[#0080C6] hover:underline text-xs font-medium"
                    >
                      Ver catálogo →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
