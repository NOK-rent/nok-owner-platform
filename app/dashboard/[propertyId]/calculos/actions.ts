'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'

type Frequency = 'monthly' | 'one_time'
type Currency = 'USD' | 'DOP' | 'COP'

const CATEGORIES = ['mortgage', 'maintenance', 'utilities', 'insurance', 'hoa', 'property_tax', 'admin', 'bank', 'other'] as const
type Category = (typeof CATEGORIES)[number]

/** Auth + verify the property belongs to this owner (admins bypass). */
async function requireOwnerProperty(propertyId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('unauthenticated')

  const sb = createServiceClient() as any
  const { data: owner } = await sb
    .from('owners')
    .select('id, email')
    .eq('supabase_user_id', user.id)
    .single()
  if (!owner) throw new Error('owner not found')

  let q = sb.from('properties').select('id, owner_id').eq('id', propertyId)
  if (!isAdminEmail(owner.email)) q = q.eq('owner_id', owner.id)
  const { data: property } = await q.single()
  if (!property) throw new Error('property not found')

  return { owner, sb }
}

function revalidate(propertyId: string) {
  revalidatePath(`/dashboard/${propertyId}/calculos`)
  revalidatePath(`/dashboard/${propertyId}/costs`)
  revalidatePath(`/dashboard/${propertyId}/overview`)
}

export async function addExpense(propertyId: string, formData: FormData) {
  const { owner, sb } = await requireOwnerProperty(propertyId)

  const label = String(formData.get('label') || '').trim()
  const rawCategory = String(formData.get('category') || 'other')
  const category = (CATEGORIES.includes(rawCategory as Category) ? rawCategory : 'other') as Category
  const amount = Number(formData.get('amount') || 0)
  const currency = (['USD', 'DOP', 'COP'].includes(String(formData.get('currency'))) ? formData.get('currency') : 'USD') as Currency
  const frequency = (formData.get('frequency') === 'one_time' ? 'one_time' : 'monthly') as Frequency
  const monthKey = String(formData.get('month') || '').trim()       // YYYY-MM del mes visible (fallback)
  const startMonth = String(formData.get('start_month') || '').trim() // "desde" que designa el owner
  const endMonth = String(formData.get('end_month') || '').trim()     // "hasta" opcional

  if (!label || !(amount > 0)) throw new Error('label and amount required')

  // Mes de inicio: el que designa el owner, o el mes visible, o hoy.
  const baseMonth = /^\d{4}-\d{2}$/.test(startMonth) ? startMonth
    : /^\d{4}-\d{2}$/.test(monthKey) ? monthKey
    : new Date().toISOString().slice(0, 7)
  const startDate = `${baseMonth}-01`

  // "hasta": último día del mes designado (solo aplica a gastos mensuales; one_time es un solo mes)
  let endDate: string | null = null
  if (frequency === 'monthly' && /^\d{4}-\d{2}$/.test(endMonth) && endMonth >= baseMonth) {
    const [ey, em] = endMonth.split('-').map(Number)
    endDate = `${endMonth}-${String(new Date(ey, em, 0).getDate()).padStart(2, '0')}`
  }

  const { error } = await sb.from('owner_costs').insert({
    property_id: propertyId,
    owner_id: owner.id,
    label,
    category,
    amount,
    currency,
    frequency,
    start_date: startDate,
    end_date: endDate,
  })
  if (error) throw error
  revalidate(propertyId)
}

export async function removeExpense(propertyId: string, costId: string) {
  const { sb } = await requireOwnerProperty(propertyId)
  const { error } = await sb.from('owner_costs').delete().eq('id', costId).eq('property_id', propertyId)
  if (error) throw error
  revalidate(propertyId)
}
