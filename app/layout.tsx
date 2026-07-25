import type { Metadata, Viewport } from 'next'
import './globals.css'
import PwaRegister from '@/components/pwa/PwaRegister'
import InstallPrompt from '@/components/pwa/InstallPrompt'

export const metadata: Metadata = {
  title: 'NOK — Portal de Propietarios',
  description: 'Portal privado para propietarios de NOK. Curated stays designed to flow with you.',
  applicationName: 'NOK Owners',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'NOK',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  themeColor: '#833B0E',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover', // respeta el notch del iPhone (safe-area)
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased">
        {children}
        <PwaRegister />
        <InstallPrompt />
      </body>
    </html>
  )
}
