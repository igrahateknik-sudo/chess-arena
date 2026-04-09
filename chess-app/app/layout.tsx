'use client';

import './globals.css';
import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { useRealtime } from '@/lib/realtime';

// Provider yang mengaktifkan semua socket real-time selama sesi login
function RealtimeProvider({ children }: { children: React.ReactNode }) {
  useRealtime();
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return <>{children}</>;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { theme } = useAppStore();

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <title>Chess Arena — Platform Esports Catur Kompetitif</title>
        <meta name="description" content="Platform esports catur berbasis skill dengan match ranked, turnamen tiap jam, anti-cheat ketat, dan progres ELO real-time." />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="application-name" content="Chess Arena" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Chess Arena" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#f59e0b" />
        <meta name="msapplication-TileColor" content="#06070f" />
        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Chess Arena — Esports Catur Kompetitif" />
        <meta property="og:description" content="Platform esports catur dengan turnamen tiap jam dan hadiah uang tunai." />
        <meta property="og:image" content="/icons/icon-512.png" />
        {/* PWA Manifest */}
        <link rel="manifest" href="/manifest.json" />
        {/* Favicons */}
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>♔</text></svg>" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className={theme === 'dark' ? 'dark' : ''}>
        <div className="min-h-screen bg-[var(--bg-primary)] transition-colors duration-300">
          <RealtimeProvider>
            {children}
          </RealtimeProvider>
        </div>
      </body>
    </html>
  );
}
