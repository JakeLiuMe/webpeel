'use client';

import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { ApiErrorBanner } from '@/components/api-error-banner';
import { checkApiHealth } from '@/lib/api';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Pre-warm the API on dashboard mount — fire and forget.
  // By pinging /health now we ensure the connection is established before
  // SWR makes its first data requests.
  useEffect(() => {
    checkApiHealth().catch(() => { /* silent — this is best-effort */ });
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-violet-600" />
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  const tier = (session as any)?.tier || 'free';

  // Show a recovery banner when:
  //   1. The OAuth back-end call set apiError = true, OR
  //   2. The session exists but has no apiToken (same root cause)
  const hasApiError = (session as any)?.apiError === true;
  const hasToken = !!(session as any)?.apiToken;
  const showRecoveryBanner = hasApiError || !hasToken;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        tier={tier}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          user={session.user}
          tier={tier}
          onMenuClick={() => setSidebarOpen(!sidebarOpen)}
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-6" style={{ backgroundColor: '#FAFAF8' }}>
          {showRecoveryBanner && (
            <div className="mb-6">
              <ApiErrorBanner
                title="API Connection Issue"
                message="We couldn't connect to the API during sign-in. Please sign out and sign back in to restore full access."
              />
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
