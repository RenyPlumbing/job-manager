import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Reny Plumbing',
  description: 'Simple job scheduling, notes, todos and estimator',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Reny Plumbing',
  },
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('reny-dark')==='1')document.documentElement.classList.add('dark')}catch(e){}" }} />
        <style>{`html.dark,html.dark body{background:#0f172a !important;color:#e5e7eb !important}html.dark .min-h-screen,html.dark .bg-gray-50{background-color:#0f172a !important}html.dark .bg-white{background-color:#1e293b !important}html.dark .bg-gray-100{background-color:#334155 !important}html.dark .text-gray-900,html.dark .text-gray-800,html.dark .text-gray-700{color:#e5e7eb !important}html.dark .text-gray-600,html.dark .text-gray-500,html.dark .text-gray-400{color:#cbd5e1 !important}html.dark .border,html.dark .border-b,html.dark .border-t,html.dark .border-l{border-color:#334155 !important}html.dark input,html.dark textarea,html.dark select{background:#0f172a !important;color:#f8fafc !important;border-color:#475569 !important}html.dark .bg-blue-50{background-color:#1e3a5f !important}`}</style>
        {children}
      </body>
    </html>
  );
}
