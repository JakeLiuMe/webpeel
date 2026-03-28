'use client';

import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import { apiClient, Usage } from '@/lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DailyUsage {
  date: string;
  fetches: number;
  stealth: number;
  search: number;
}

export interface WeeklyHistoryEntry {
  week: string;           // ISO week start date (YYYY-MM-DD)
  totalRequests: number;
  basicUsed: number;
  stealthUsed: number;
  searchUsed: number;
}

export interface UsageHistoricalResponse {
  history: WeeklyHistoryEntry[];
}

export interface UsageDailyResponse {
  history: DailyUsage[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SWR fetcher
// ─────────────────────────────────────────────────────────────────────────────

const fetcher = async <T,>([url, token]: [string, string]): Promise<T> =>
  apiClient<T>(url, { token });

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch current period usage: credits used, remaining, breakdown by type.
 * Corresponds to GET /v1/usage
 */
export function useUsage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken as string | undefined;

  const { data, error, isLoading, mutate } = useSWR<Usage>(
    token ? ['/v1/usage', token] : null,
    fetcher<Usage>,
    { refreshInterval: 30_000 }
  );

  return { data, loading: isLoading, error, mutate };
}

/**
 * Fetch historical usage for the last 12 weeks.
 * Corresponds to GET /v1/usage/historical
 */
export function useUsageHistory() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken as string | undefined;

  const { data, error, isLoading, mutate } = useSWR<UsageHistoricalResponse>(
    token ? ['/v1/usage/historical', token] : null,
    fetcher<UsageHistoricalResponse>,
    { refreshInterval: 60_000 }
  );

  return { data, loading: isLoading, error, mutate };
}

/**
 * Fetch daily usage breakdown for the current week.
 * Corresponds to GET /v1/usage/daily
 */
export function useUsageDaily() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken as string | undefined;

  const { data, error, isLoading, mutate } = useSWR<UsageDailyResponse>(
    token ? ['/v1/usage/daily', token] : null,
    fetcher<UsageDailyResponse>,
    { refreshInterval: 30_000 }
  );

  return { data, loading: isLoading, error, mutate };
}
