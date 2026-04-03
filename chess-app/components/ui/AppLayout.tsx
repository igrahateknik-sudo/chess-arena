'use client';

import { useState } from 'react';
import Link from 'next/link';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useAppStore } from '@/lib/store';

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export default function AppLayout({ children, title }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { sidebarOpen } = useAppStore();

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <Topbar onMenuClick={() => setMobileOpen(true)} title={title} />
      <main className={`transition-all duration-300 pt-16 ${sidebarOpen ? 'lg:ml-60' : 'lg:ml-[68px]'}`}>
        <div className="p-4 sm:p-6 min-h-[calc(100vh-64px-40px)]">
          {children}
        </div>
        {/* Legal footer — required for Play Store & web compliance */}
        <footer className={`border-t border-[var(--border)] px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]`}>
          <span>© 2026 Chess Arena</span>
          <span className="hidden sm:inline text-[var(--border)]">·</span>
          <span className="text-[var(--text-muted)]">Platform kompetisi catur skill-based</span>
          <span className="hidden sm:inline text-[var(--border)]">·</span>
          <Link href="/terms" className="hover:text-[var(--text-secondary)] transition-colors">Syarat & Ketentuan</Link>
          <Link href="/privacy" className="hover:text-[var(--text-secondary)] transition-colors">Kebijakan Privasi</Link>
          <Link href="/appeal" className="hover:text-[var(--text-secondary)] transition-colors">Banding</Link>
        </footer>
      </main>
    </div>
  );
}
