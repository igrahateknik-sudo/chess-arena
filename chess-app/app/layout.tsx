'use client';

import './globals.css';
import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { useRealtime } from '@/lib/realtime';

// Provider yang mengaktifkan semua socket real-time selama sesi login
function RealtimeProvider({ children }: { children: React.ReactNode }) {
  useRealtime();
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
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>♔</text></svg>" />
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
