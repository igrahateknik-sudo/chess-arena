'use client';

import { useState } from 'react';
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
        <div className="p-4 sm:p-6 min-h-[calc(100vh-64px)]">
          {children}
        </div>
      </main>
    </div>
  );
}
