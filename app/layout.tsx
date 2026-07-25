import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NOK — Portal de Propietarios',
  description: 'Portal privado para propietarios de NOK. Curated stays designed to flow with you.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  )
}
