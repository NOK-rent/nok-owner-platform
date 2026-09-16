import { redirect } from 'next/navigation'

export default async function EdificioIndex({ params }: { params: Promise<{ configId: string }> }) {
  const { configId } = await params
  redirect(`/dashboard/edificio/${configId}/overview`)
}
