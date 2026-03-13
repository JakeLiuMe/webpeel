'use client';

import { useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/api';
import {
  Activity,
  Search,
  RefreshCw,
  AlertCircle,
  Clock,
  ExternalLink,
  Filter,
  Globe,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  BookOpen,
} from 'lucide-react';

const fetcher = async <T,>(url: string, token: string): Promise<T> => {
  return apiClient<T>(url, { token });
};

interface ApiRequest {
  id: string;
  url: string;
  endpoint?: string | null;
  status: 'success' | 'error';
  responseTime: number;
  mode: 'basic' | 'stealth';
  timestamp: string;
  statusCode?: number | null;
  tokenCount?: number;
  tokensUsed?: number;
  contentPreview?: string;
  ipAddress?: string | null;
}

interface ActivityData {
  requests: ApiRequest[];
}

type StatusFilter = 'all' | 'success' | 'error';
type ModeFilter = 'all' | 'basic' | 'stealth';

// ── Content type detection ────────────────────────────────────────────────────

interface ContentTypeInfo {
  emoji: string;
  label: string;
  color: string;
}

function getContentTypeInfo(req: ApiRequest): ContentTypeInfo {
  const endpoint = req.endpoint || '';
  const url = req.url || '';

  // YouTube transcript
  if (
    endpoint.includes('/youtube') ||
    endpoint.includes('youtube') ||
    url.match(/youtube\.com|youtu\.be/)
  ) {
    return { emoji: '🎬', label: 'YouTube', color: 'bg-red-500/15 text-red-400 border-red-500/20' };
  }

  // Search query
  if (
    endpoint.includes('/search') ||
    endpoint === 'search'
  ) {
    return { emoji: '🔍', label: 'Search', color: 'bg-blue-500/15 text-blue-400 border-blue-500/20' };
  }

  // Screenshot
  if (
    endpoint.includes('/screenshot') ||
    endpoint === 'screenshot'
  ) {
    return { emoji: '📸', label: 'Screenshot', color: 'bg-purple-500/15 text-purple-400 border-purple-500/20' };
  }

  // AI Q&A / answer
  if (
    endpoint.includes('/ask') ||
    endpoint.includes('/answer') ||
    endpoint.includes('agent') ||
    url.includes('question=') ||
    url.includes('answer=')
  ) {
    return { emoji: '🤖', label: 'AI Q&A', color: 'bg-amber-500/15 text-amber-400 border-amber-500/20' };
  }

  // Default: web page fetch
  return { emoji: '🌐', label: 'Fetch', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' };
}

// ── Response time coloring ────────────────────────────────────────────────────

function getResponseTimeColor(ms: number): string {
  if (ms < 3000) return 'text-emerald-400';
  if (ms < 8000) return 'text-amber-400';
  return 'text-red-400';
}

function getResponseTimeBgColor(ms: number): string {
  if (ms < 3000) return 'text-emerald-600';
  if (ms < 8000) return 'text-amber-600';
  return 'text-red-600';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ── Expanded row ──────────────────────────────────────────────────────────────

function ExpandedRowContent({ req }: { req: ApiRequest }) {
  const playgroundUrl = `/playground?url=${encodeURIComponent(req.url)}`;
  const contentType = getContentTypeInfo(req);
  const tokens = req.tokensUsed ?? req.tokenCount;

  return (
    <div className="px-4 py-4 bg-zinc-950 border-t border-zinc-800 space-y-4">
      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
          <p className="text-xs text-zinc-500 mb-1">HTTP Status</p>
          <p className="text-sm font-semibold text-zinc-100">
            {req.statusCode != null ? (
              <span className={req.statusCode < 400 ? 'text-emerald-400' : 'text-red-400'}>
                {req.statusCode}
              </span>
            ) : (
              <span className="text-zinc-400 italic">N/A</span>
            )}
          </p>
        </div>
        <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
          <p className="text-xs text-zinc-500 mb-1">Response Time</p>
          <p className={`text-sm font-semibold ${getResponseTimeColor(req.responseTime)}`}>
            {req.responseTime}ms
          </p>
        </div>
        <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
          <p className="text-xs text-zinc-500 mb-1">Type</p>
          <p className="text-sm font-semibold text-zinc-100">
            {contentType.emoji} {contentType.label}
          </p>
        </div>
        <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
          <p className="text-xs text-zinc-500 mb-1">Tokens</p>
          <p className="text-sm font-semibold text-zinc-100">
            {tokens != null
              ? tokens.toLocaleString()
              : <span className="text-zinc-400 italic">N/A</span>
            }
          </p>
        </div>
      </div>

      {/* IP Address */}
      {req.ipAddress && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="text-zinc-600">IP:</span>
          <span className="font-mono text-zinc-400">{req.ipAddress}</span>
        </div>
      )}

      {/* Content preview */}
      <div>
        <p className="text-xs font-semibold text-zinc-400 mb-2">Response Preview</p>
        {req.contentPreview ? (
          <pre className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
            {req.contentPreview.slice(0, 300)}{req.contentPreview.length > 300 ? '…' : ''}
          </pre>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-500 italic">
            Response body not stored — use the Playground to re-fetch this URL.
          </div>
        )}
      </div>

      {/* Full URL + re-fetch */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="h-3.5 w-3.5 text-zinc-500 flex-shrink-0" />
          <span className="text-xs text-zinc-400 truncate">{req.url}</span>
          <a href={req.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
            <ExternalLink className="h-3 w-3 text-zinc-500 hover:text-zinc-300 transition-colors" />
          </a>
        </div>
        <a href={playgroundUrl}>
          <Button
            variant="ghost"
            size="sm"
            className="text-[#5865F2] hover:text-white hover:bg-[#5865F2] gap-1.5 text-xs h-7 px-3 whitespace-nowrap min-h-[44px] sm:min-h-0"
          >
            Re-fetch in Playground
            <ArrowRight className="h-3 w-3" />
          </Button>
        </a>
      </div>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function ActivitySkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-14 w-full bg-zinc-800" />
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken as string | undefined;

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const { data, isLoading, error, mutate } = useSWR<ActivityData>(
    token ? ['/v1/activity?limit=100', token] : null,
    ([url, token]: [string, string]) => fetcher<ActivityData>(url, token),
    { refreshInterval: 15000 }
  );

  const requests = data?.requests || [];

  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      if (statusFilter !== 'all' && req.status !== statusFilter) return false;
      if (modeFilter !== 'all' && req.mode !== modeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!req.url.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [requests, statusFilter, modeFilter, searchQuery]);

  // Stats
  const totalCount = requests.length;
  const successCount = requests.filter((r) => r.status === 'success').length;
  const errorCount = requests.filter((r) => r.status === 'error').length;
  const avgResponseTime = requests.length > 0
    ? Math.round(requests.reduce((sum, r) => sum + r.responseTime, 0) / requests.length)
    : 0;
  const hasActivityData = totalCount > 0;

  const toggleRow = (id: string) => {
    setExpandedRowId((prev) => (prev === id ? null : id));
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <AlertCircle className="h-8 w-8 text-red-500 mb-3" />
        <p className="text-sm text-zinc-500 mb-3">Failed to load activity. Please try again.</p>
        <Button variant="outline" size="sm" onClick={() => mutate()} className="min-h-[44px]">Retry</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-zinc-100 flex items-center gap-2">
            <Activity className="h-7 w-7 text-zinc-200" />
            Activity
          </h1>
          <p className="text-sm md:text-base text-zinc-500 mt-1">
            Your full API request history
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => mutate()}
          disabled={isLoading}
          className="gap-2 w-full sm:w-auto min-h-[44px]"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-zinc-700">
              <CardContent className="pt-4 pb-4">
                <Skeleton className="h-3 w-20 bg-zinc-800 mb-2" />
                <Skeleton className="h-7 w-12 bg-zinc-800" />
              </CardContent>
            </Card>
          ))
        ) : (
          [
            { label: 'Total Requests', value: totalCount.toLocaleString(), color: 'text-zinc-100', hint: '' },
            { label: 'Successful', value: successCount.toLocaleString(), color: 'text-emerald-600', hint: '' },
            { label: 'Errors', value: errorCount.toLocaleString(), color: errorCount > 0 ? 'text-red-600' : 'text-zinc-400', hint: '' },
            { label: 'Avg Response', value: hasActivityData ? `${avgResponseTime}ms` : '—', color: hasActivityData ? getResponseTimeBgColor(avgResponseTime) : 'text-zinc-400', hint: hasActivityData && avgResponseTime < 5000 ? 'Normal for web scraping' : hasActivityData ? 'Stealth mode adds latency' : '' },
          ].map((stat) => (
            <Card key={stat.label} className="border-zinc-700">
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-zinc-500 font-medium">{stat.label}</p>
                <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
                {stat.hint && <p className="text-[10px] text-zinc-500 mt-0.5">{stat.hint}</p>}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Filters */}
      <Card className="border-zinc-700">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input
                placeholder="Search by URL..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {/* Status Filter */}
              <div className="flex items-center gap-1 p-1 bg-zinc-800 rounded-lg">
                <Filter className="h-3.5 w-3.5 text-zinc-400 ml-1" />
                {(['all', 'success', 'error'] as StatusFilter[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all capitalize min-h-[36px] ${
                      statusFilter === s
                        ? 'bg-zinc-700 text-zinc-100 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Mode Filter */}
              <div className="flex items-center gap-1 p-1 bg-zinc-800 rounded-lg">
                {(['all', 'basic', 'stealth'] as ModeFilter[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setModeFilter(m)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all capitalize min-h-[36px] ${
                      modeFilter === m
                        ? 'bg-zinc-700 text-zinc-100 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Activity Table */}
      <Card className="border-zinc-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Request Log</CardTitle>
              <CardDescription>
                {isLoading
                  ? 'Loading requests…'
                  : `${filteredRequests.length} ${filteredRequests.length === 1 ? 'request' : 'requests'}`
                  + (filteredRequests.length !== totalCount ? ` (filtered from ${totalCount})` : '')}
                {filteredRequests.length > 0 && !isLoading && (
                  <span className="text-zinc-500"> · click any row to expand details</span>
                )}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ActivitySkeleton />
          ) : filteredRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              {requests.length === 0 ? (
                /* Empty state — no requests yet */
                <>
                  <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
                    <Activity className="h-8 w-8 text-zinc-200" />
                  </div>
                  <h3 className="text-lg font-semibold text-zinc-100 mb-2">No requests yet</h3>
                  <p className="text-sm text-zinc-500 text-center max-w-sm mb-4">
                    Your API requests will appear here once you start making calls.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <a href="/playground">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 min-h-[44px] w-full sm:w-auto"
                      >
                        <ArrowRight className="h-4 w-4" />
                        Try the Playground
                      </Button>
                    </a>
                    <a
                      href="https://webpeel.dev/docs"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2 text-zinc-400 hover:text-zinc-200 min-h-[44px] w-full sm:w-auto"
                      >
                        <BookOpen className="h-4 w-4" />
                        Read the docs
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </a>
                  </div>
                </>
              ) : (
                /* Filtered — no matches */
                <>
                  <Search className="h-12 w-12 text-zinc-300 mb-3" />
                  <h3 className="text-base font-semibold text-zinc-100 mb-1">No matching requests</h3>
                  <p className="text-sm text-zinc-500">Try adjusting your filters or search query</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 min-h-[44px]"
                    onClick={() => { setSearchQuery(''); setStatusFilter('all'); setModeFilter('all'); }}
                  >
                    Clear filters
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Mobile: Card view */}
              <div className="space-y-2 md:hidden">
                {filteredRequests.map((req) => {
                  const contentType = getContentTypeInfo(req);
                  const tokens = req.tokensUsed ?? req.tokenCount;
                  return (
                    <div key={req.id} className="rounded-lg overflow-hidden border border-zinc-800">
                      <button
                        onClick={() => toggleRow(req.id)}
                        className={`w-full text-left border rounded-lg p-3 space-y-2 transition-colors ${
                          req.status === 'success' ? 'border-l-4 border-l-emerald-400' : 'border-l-4 border-l-red-400'
                        } ${expandedRowId === req.id ? 'bg-zinc-900' : 'hover:bg-zinc-900/50'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                              <span className="text-xs">{contentType.emoji}</span>
                              <span className="text-xs text-zinc-500 truncate">{extractDomain(req.url)}</span>
                            </div>
                            <span className="text-sm text-zinc-100 truncate block font-medium">
                              {req.url}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <Badge
                              className={req.status === 'success'
                                ? 'bg-emerald-500/20 text-emerald-400 border-0'
                                : 'bg-red-500/20 text-red-400 border-0'
                              }
                            >
                              {req.status}
                            </Badge>
                            {expandedRowId === req.id
                              ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                              : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                            }
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-zinc-400 flex-wrap">
                          <span className={`flex items-center gap-1 ${getResponseTimeColor(req.responseTime)}`}>
                            <Clock className="h-3 w-3" />
                            {req.responseTime}ms
                          </span>
                          {tokens != null && (
                            <span className="text-zinc-500">🪙 {tokens.toLocaleString()} tokens</span>
                          )}
                          <span className="ml-auto">{timeAgo(req.timestamp)}</span>
                        </div>
                      </button>
                      {expandedRowId === req.id && (
                        <ExpandedRowContent req={req} />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop: Table view */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-700">
                      <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide w-6"></th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Type</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">URL</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Status</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Time</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Tokens</th>
                      <th className="text-left py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">IP</th>
                      <th className="text-right py-3 px-4 text-xs font-semibold text-zinc-500 uppercase tracking-wide">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((req) => {
                      const contentType = getContentTypeInfo(req);
                      const tokens = req.tokensUsed ?? req.tokenCount;
                      return (
                        <>
                          <tr
                            key={req.id}
                            onClick={() => toggleRow(req.id)}
                            className={`border-b border-zinc-800 last:border-0 transition-colors group cursor-pointer select-none ${
                              expandedRowId === req.id
                                ? 'bg-zinc-900 border-b-0'
                                : 'hover:bg-zinc-900/60'
                            }`}
                          >
                            <td className="py-3 px-4 w-6">
                              {expandedRowId === req.id
                                ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                                : <ChevronRight className="h-3.5 w-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                              }
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border ${contentType.color}`}
                                title={contentType.label}
                              >
                                <span>{contentType.emoji}</span>
                                <span className="hidden lg:inline">{contentType.label}</span>
                              </span>
                            </td>
                            <td className="py-3 px-4 max-w-xs">
                              <div className="flex items-center gap-2">
                                <span
                                  className="text-sm text-zinc-100 truncate block"
                                  title={req.url}
                                >
                                  {req.url}
                                </span>
                                <a
                                  href={req.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ExternalLink className="h-3 w-3 text-zinc-300 opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity hover:text-zinc-100" />
                                </a>
                              </div>
                              <span className="text-xs text-zinc-400">{extractDomain(req.url)}</span>
                            </td>
                            <td className="py-3 px-4">
                              <Badge
                                className={req.status === 'success'
                                  ? 'bg-emerald-500/20 text-emerald-400 border-0'
                                  : 'bg-red-500/20 text-red-400 border-0'
                                }
                              >
                                {req.statusCode ? `${req.statusCode} ` : ''}{req.status}
                              </Badge>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`text-sm font-medium ${getResponseTimeBgColor(req.responseTime)}`}>
                                {req.responseTime}ms
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className="text-xs text-zinc-400">
                                {tokens != null ? tokens.toLocaleString() : <span className="text-zinc-600">—</span>}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className="text-xs text-zinc-500 font-mono">
                                {req.ipAddress ? req.ipAddress : <span className="text-zinc-700">—</span>}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className="text-xs text-zinc-400">{timeAgo(req.timestamp)}</span>
                            </td>
                          </tr>
                          {expandedRowId === req.id && (
                            <tr key={`${req.id}-expanded`} className="border-b border-zinc-800">
                              <td colSpan={8} className="p-0">
                                <ExpandedRowContent req={req} />
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
