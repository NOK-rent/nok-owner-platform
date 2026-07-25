import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import CalendarView from '@/components/calendar/CalendarView'
import SyncButton from '@/components/calendar/SyncButton'
import { loadOwnerProperty } from '@/lib/admin'

interface Props {
  params: Promise<{ propertyId: string }>
  searchParams: Promise<{ month?: string; year?: string }>
}

export default async function CalendarPage({ params, searchParams }: Props) {
  const { propertyId } = await params
  const { month, year } = await searchParams

  const { property, sb } = await loadOwnerProperty(propertyId)
  if (!property) notFound()

  // Determine the month/year to show
  const now = new Date()
  const displayYear = year ? parseInt(year) : now.getFullYear()
  const displayMonth = month ? parseInt(month) : now.getMonth() + 1 // 1-12

  // Build date range for the month
  const firstDay = new Date(displayYear, displayMonth - 1, 1)
  const lastDay = new Date(displayYear, displayMonth, 0)
  const from = firstDay.toISOString().split('T')[0]
  const to = lastDay.toISOString().split('T')[0]

  // Load reservations and pricing in parallel
  const [reservationsRes, pricingRes] = await Promise.all([
    sb.from('reservations')
      .select('id, check_in, check_out, nights, guest_name, channel, status, num_guests, owner_revenue, currency, total_price, is_blocked')
      .eq('property_id', propertyId)
      .not('status', 'in', '(canceled,cancelled,declined,expired,inquiry)')
      .lte('check_in', to)
      .gte('check_out', from)
      .order('check_in'),
    sb.from('pricing_calendar')
      .select('calendar_date, base_rate, recommended_rate, is_available, is_blocked, block_reason, min_stay_nights, currency')
      .eq('property_id', propertyId)
      .gte('calendar_date', from)
      .lte('calendar_date', to)
      .order('calendar_date'),
  ])

  return (
    <div className="px-8 lg:px-16 py-10 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-4xl font-light text-[#1A1A1A]">Calendario</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(26,26,26,0.4)' }}>{property.name}</p>
        </div>
        <SyncButton propertyId={propertyId} />
      </div>

      <CalendarView
        propertyId={propertyId}
        year={displayYear}
        month={displayMonth}
        reservations={reservationsRes.data ?? []}
        pricing={pricingRes.data ?? []}
      />
    </div>
  )
}
