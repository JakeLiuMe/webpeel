'use client';

import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UsageBar } from '@/components/usage-bar';
import { Badge } from '@/components/ui/badge';
import { BarChart3, TrendingUp, TrendingDown, Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient, Usage } from '@/lib/api';

const fetcher = async <T,>(url: string, token: string): Promise<T> => {
  return apiClient<T>(url, { token });
};

interface DailyUsage {
  date: string;
  fetches: number;
  stealth: number;
  search: number;
}

// Stacked bar chart rendered in pure CSS/SVG — no dependencies
function StackedBarChart({ data }: { data: DailyUsage[] }) {
  const maxValue = Math.max(...data.map((d) => d.fetches + d.stealth + d.search), 1);

  return (
    <div className="space-y-3">
      {/* Chart */}
      <div className="h-48 flex items-end justify-between gap-1.5 px-1">
        {data.map((day, i) => {
          const total = day.fetches + day.stealth + day.search;
          const totalPct = maxValue > 0 ? (total / maxValue) * 100 : 0;
          const totalPx = Math.max(totalPct * 1.72, total > 0 ? 4 : 2);

          // Proportional segments
          const fetchH = total > 0 ? (day.fetches / total) * totalPx : 0;
          const stealthH = total > 0 ? (day.stealth / total) * totalPx : 0;
          const searchH = total > 0 ? (day.search / total) * totalPx : 0;

          const isToday = i === data.length - 1;
          const dayName = new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' });

          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group">
              {/* Tooltip */}
              <div className="relative w-full flex flex-col items-center">
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  <div className="bg-zinc-900 text-white text-xs rounded-lg px-2.5 py-2 whitespace-nowrap shadow-lg">
                    <p className="font-semibold mb-1">{total} requests</p>
                    {day.fetches > 0 && <p className="text-zinc-500">Basic: {day.fetches}</p>}
                    {day.stealth > 0 && <p className="text-amber-300">Stealth: {day.stealth}</p>}
                    {day.search > 0 && <p className="text-emerald-300">Search: {day.search}</p>}
                  </div>
                </div>

                {/* Stacked bar segments */}
                <div className="w-full flex flex-col-reverse" style={{ height: `${Math.max(totalPx, 2)}px` }}>
                  {/* Basic fetches — bottom (zinc) */}
                  {fetchH > 0 && (
                    <div
                      className={`w-full ${isToday ? 'bg-zinc-900' : 'bg-zinc-500 group-hover:bg-zinc-600'} transition-colors ${searchH === 0 && stealthH === 0 ? 'rounded-t-md' : ''}`}
                      style={{ height: `${fetchH}px` }}
                    />
                  )}
                  {/* Stealth — middle (amber) */}
                  {stealthH > 0 && (
                    <div
                      className={`w-full ${isToday ? 'bg-amber-400' : 'bg-amber-200 group-hover:bg-amber-300'} transition-colors ${searchH === 0 ? 'rounded-t-md' : ''}`}
                      style={{ height: `${stealthH}px` }}
                    />
                  )}
                  {/* Search — top (emerald) */}
                  {searchH > 0 && (
                    <div
                      className={`w-full rounded-t-md ${isToday ? 'bg-emerald-500' : 'bg-emerald-200 group-hover:bg-emerald-300'} transition-colors`}
                      style={{ height: `${searchH}px` }}
                    />
                  )}
                  {/* Empty bar */}
                  {total === 0 && (
                    <div className="w-full rounded-t-sm bg-zinc-100" style={{ height: '2px' }} />
                  )}
                </div>
              </div>
              <span className={`text-[9px] font-medium ${isToday ? 'text-zinc-800' : 'text-zinc-400'}`}>
                {dayName}
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-5 text-xs text-zinc-500">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-zinc-600" />
          <span>Basic</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-amber-300" />
          <span>Stealth</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />
          <span>Search</span>
        </div>
      </div>
    </div>
  );
}

// Week-over-week comparison badge
function WeekComparison({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const delta = current - previous;
  const pct = Math.abs(Math.round((delta / previous) * 100));
  const up = delta > 0;

  return (
    <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
      up ? 'bg-zinc-50 text-zinc-800' : 'bg-zinc-100 text-zinc-500'
    }`}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : '-'}{pct}% vs last week
    </div>
  );
}

export default function UsagePage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken;

  const { data: usage, isLoading, error: usageError, mutate: mutateUsage } = useSWR<Usage>(
    token ? ['/v1/usage', token] : null,
    ([url, token]: [string, string]) => fetcher<Usage>(url, token),
    { refreshInterval: 30000 }
  );

  // Fetch 14 days to support week-over-week comparison
  const { data: history, error: historyError, mutate: mutateHistory } = useSWR<{ history: DailyUsage[] }>(
    token ? ['/v1/usage/history?days=14', token] : null,
    ([url, token]: [string, string]) => fetcher<{ history: DailyUsage[] }>(url, token),
    { refreshInterval: 60000 }
  );

  const pageError = usageError || historyError;
  const pageMutate = () => { mutateUsage(); mutateHistory(); };

  const allHistory = history?.history || [];
  // Last 7 days = current week; days 8–14 = previous week
  const dailyHistory = allHistory.slice(-7);
  const previousWeek = allHistory.slice(0, 7);

  const currentWeekTotal = dailyHistory.reduce((s, d) => s + d.fetches + d.stealth + d.search, 0);
  const prevWeekTotal = previousWeek.reduce((s, d) => s + d.fetches + d.stealth + d.search, 0);

  // Type totals for the breakdown tab
  const weekFetches = dailyHistory.reduce((s, d) => s + d.fetches, 0);
  const weekStealth = dailyHistory.reduce((s, d) => s + d.stealth, 0);
  const weekSearch = dailyHistory.reduce((s, d) => s + d.search, 0);

  if (pageError) return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <AlertCircle className="h-8 w-8 text-red-500 mb-3" />
      <p className="text-sm text-muted-foreground mb-3">Failed to load data. Please try again.</p>
      <Button variant="outline" size="sm" onClick={() => pageMutate()}>Retry</Button>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Usage</h1>
        <p className="text-sm md:text-base text-muted-foreground">Detailed breakdown of your API usage</p>
      </div>

      <Tabs defaultValue="overview" className="space-y-4 md:space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview" className="text-xs sm:text-sm">Overview</TabsTrigger>
          <TabsTrigger value="history" className="text-xs sm:text-sm">History</TabsTrigger>
          <TabsTrigger value="breakdown" className="text-xs sm:text-sm">Breakdown</TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* OVERVIEW TAB                                                     */}
        {/* ================================================================ */}
        <TabsContent value="overview" className="space-y-4 md:space-y-6">

          {/* Weekly Usage Chart */}
          <Card className="border-zinc-200">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-xl flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-zinc-800" />
                    Usage Trend
                  </CardTitle>
                  <CardDescription>Daily breakdown for the past 7 days</CardDescription>
                </div>
                <WeekComparison current={currentWeekTotal} previous={prevWeekTotal} />
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-48 animate-pulse rounded-lg bg-zinc-100" />
              ) : dailyHistory.length > 0 ? (
                <StackedBarChart data={dailyHistory} />
              ) : (
                <div className="h-48 flex items-center justify-center">
                  <div className="text-center">
                    <BarChart3 className="h-12 w-12 text-zinc-300 mx-auto mb-3" />
                    <p className="text-sm text-zinc-500">No usage data yet</p>
                    <p className="text-xs text-zinc-400 mt-1">
                      Usage data will appear when you start making API requests
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Weekly Quota Progress */}
          <Card className="border-zinc-200">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg md:text-xl">Weekly Quota</CardTitle>
                  <CardDescription className="text-sm">
                    {usage?.weekly
                      ? `Resets on ${new Date(usage.weekly.resetsAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`
                      : 'Loading...'}
                  </CardDescription>
                </div>
                {usage?.weekly && (
                  <div className="text-right">
                    <p className="text-2xl font-bold text-zinc-900">
                      {usage.weekly.remaining.toLocaleString()}
                    </p>
                    <p className="text-xs text-zinc-500">requests remaining</p>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {usage?.weekly ? (
                <>
                  {/* Big progress bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-zinc-700">
                        {usage.weekly.totalUsed.toLocaleString()} used
                      </span>
                      <span className="text-zinc-400">
                        of {usage.weekly.totalAvailable.toLocaleString()} total
                      </span>
                    </div>
                    <div className="relative h-4 w-full rounded-full bg-zinc-100 overflow-hidden">
                      {/* Stacked color segments in the big bar */}
                      {usage.weekly.totalAvailable > 0 && (
                        <div className="h-full flex">
                          <div
                            className="h-full bg-zinc-900 transition-all duration-700"
                            style={{ width: `${(usage.weekly.basicUsed / usage.weekly.totalAvailable) * 100}%` }}
                          />
                          <div
                            className="h-full bg-amber-400 transition-all duration-700"
                            style={{ width: `${(usage.weekly.stealthUsed / usage.weekly.totalAvailable) * 100}%` }}
                          />
                          <div
                            className="h-full bg-emerald-500 transition-all duration-700"
                            style={{ width: `${(usage.weekly.searchUsed / usage.weekly.totalAvailable) * 100}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-zinc-500">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-zinc-900" />
                        Basic: {usage.weekly.basicUsed}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-amber-400" />
                        Stealth: {usage.weekly.stealthUsed}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        Search: {usage.weekly.searchUsed}
                      </div>
                    </div>
                  </div>

                  {/* Rollover credits if any */}
                  {usage.weekly.rolloverCredits > 0 && (
                    <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-lg text-sm text-zinc-800">
                      ✨ <strong>{usage.weekly.rolloverCredits}</strong> rollover credits included in your quota
                    </div>
                  )}

                  <UsageBar
                    label="All fetches"
                    used={usage.weekly.totalUsed}
                    limit={usage.weekly.totalAvailable}
                  />
                  <UsageBar
                    label="Stealth fetches"
                    used={usage.weekly.stealthUsed}
                    limit={usage.weekly.totalAvailable}
                  />
                </>
              ) : (
                <>
                  <div className="h-24 animate-pulse rounded-lg bg-zinc-100" />
                  <div className="h-24 animate-pulse rounded-lg bg-zinc-100" />
                </>
              )}
            </CardContent>
          </Card>

          {/* Current Session */}
          <Card className="border-zinc-200">
            <CardHeader>
              <CardTitle className="text-lg md:text-xl">Current Session</CardTitle>
              <CardDescription className="text-sm">Burst rate limiting — resets automatically</CardDescription>
            </CardHeader>
            <CardContent>
              {usage?.session ? (
                <UsageBar
                  label="Session usage"
                  used={usage.session.burstUsed}
                  limit={usage.session.burstLimit}
                  resetInfo={`Resets in ${usage.session.resetsIn}`}
                />
              ) : (
                <div className="h-24 animate-pulse rounded-lg bg-zinc-100" />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================ */}
        {/* HISTORY TAB                                                      */}
        {/* ================================================================ */}
        <TabsContent value="history" className="space-y-4 md:space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg md:text-xl">Daily History</CardTitle>
              <CardDescription className="text-sm">Your API usage over the past 7 days</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 md:space-y-4">
                {dailyHistory.length > 0 ? (
                  [...dailyHistory].reverse().map((day) => {
                    const total = day.fetches + day.stealth + day.search;
                    const maxTotal = Math.max(...dailyHistory.map(d => d.fetches + d.stealth + d.search), 1);
                    const barWidth = (total / maxTotal) * 100;

                    return (
                      <div key={day.date} className="flex flex-col gap-2 p-3 md:p-4 border border-zinc-100 rounded-lg hover:border-zinc-200 transition-colors">
                        <div className="flex sm:items-center justify-between gap-2">
                          <p className="font-medium text-sm">
                            {new Date(day.date).toLocaleDateString('en-US', {
                              weekday: 'long',
                              month: 'short',
                              day: 'numeric'
                            })}
                          </p>
                          <Badge variant="secondary" className="text-xs w-fit shrink-0">
                            {total} total
                          </Badge>
                        </div>

                        {/* Mini stacked bar */}
                        {total > 0 && (
                          <div className="h-2 rounded-full overflow-hidden bg-zinc-100 flex">
                            <div className="bg-zinc-600 transition-all" style={{ width: `${(day.fetches / total) * barWidth}%` }} />
                            <div className="bg-amber-300 transition-all" style={{ width: `${(day.stealth / total) * barWidth}%` }} />
                            <div className="bg-emerald-400 transition-all" style={{ width: `${(day.search / total) * barWidth}%` }} />
                          </div>
                        )}

                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-zinc-600 inline-block" />
                            {day.fetches} basic
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-amber-300 inline-block" />
                            {day.stealth} stealth
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                            {day.search} search
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 px-4">
                    <div className="w-16 h-16 rounded-full bg-zinc-100 flex items-center justify-center mb-4">
                      <BarChart3 className="h-8 w-8 text-zinc-800" />
                    </div>
                    <h3 className="text-lg font-semibold text-zinc-900 mb-2">No data yet</h3>
                    <p className="text-sm text-zinc-500 text-center max-w-md">
                      Daily usage history will appear here once you start making API requests.
                      Check out the{' '}
                      <a href="https://webpeel.dev/docs" className="text-zinc-800 hover:underline">
                        documentation
                      </a>{' '}
                      to get started.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================ */}
        {/* BREAKDOWN TAB                                                    */}
        {/* ================================================================ */}
        <TabsContent value="breakdown" className="space-y-4 md:space-y-6">
          <div className="grid gap-4 md:gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg md:text-xl">By Request Type</CardTitle>
                <CardDescription className="text-sm">This week's distribution</CardDescription>
              </CardHeader>
              <CardContent>
                {usage?.weekly && usage.weekly.totalUsed > 0 ? (
                  <div className="space-y-5">
                    {/* Visual type breakdown */}
                    {[
                      { label: 'Basic Fetch', value: usage.weekly.basicUsed, color: 'bg-zinc-900', textColor: 'text-zinc-800', bg: 'bg-zinc-50' },
                      { label: 'Stealth Mode', value: usage.weekly.stealthUsed, color: 'bg-amber-400', textColor: 'text-amber-700', bg: 'bg-amber-50' },
                      { label: 'Search API', value: usage.weekly.searchUsed, color: 'bg-emerald-500', textColor: 'text-emerald-700', bg: 'bg-emerald-50' },
                    ].map(({ label, value, color, textColor, bg }) => {
                      const pct = usage.weekly.totalUsed > 0
                        ? Math.round((value / usage.weekly.totalUsed) * 100)
                        : 0;
                      return (
                        <div key={label} className="space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-zinc-700">{label}</span>
                            <span className="text-zinc-500">
                              {value.toLocaleString()} <span className="text-xs">({pct}%)</span>
                            </span>
                          </div>
                          <div className="h-2.5 rounded-full bg-zinc-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${color} transition-all duration-700`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}

                    {/* Donut-style summary */}
                    <div className="mt-4 p-4 bg-zinc-50 rounded-xl flex items-center gap-4">
                      <div className="relative w-16 h-16 flex-shrink-0">
                        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#F4F4F5" strokeWidth="3" />
                          {/* Basic */}
                          <circle
                            cx="18" cy="18" r="15.9155" fill="none" stroke="#18181B" strokeWidth="3"
                            strokeDasharray={`${(usage.weekly.basicUsed / usage.weekly.totalUsed) * 100} 100`}
                            strokeDashoffset="0"
                          />
                          {/* Stealth offset after basic */}
                          <circle
                            cx="18" cy="18" r="15.9155" fill="none" stroke="#FBBF24" strokeWidth="3"
                            strokeDasharray={`${(usage.weekly.stealthUsed / usage.weekly.totalUsed) * 100} 100`}
                            strokeDashoffset={`-${(usage.weekly.basicUsed / usage.weekly.totalUsed) * 100}`}
                          />
                          {/* Search offset after basic+stealth */}
                          <circle
                            cx="18" cy="18" r="15.9155" fill="none" stroke="#10B981" strokeWidth="3"
                            strokeDasharray={`${(usage.weekly.searchUsed / usage.weekly.totalUsed) * 100} 100`}
                            strokeDashoffset={`-${((usage.weekly.basicUsed + usage.weekly.stealthUsed) / usage.weekly.totalUsed) * 100}`}
                          />
                        </svg>
                      </div>
                      <div className="text-sm space-y-1">
                        <p className="text-zinc-500 text-xs">Total this week</p>
                        <p className="text-2xl font-bold text-zinc-900">{usage.weekly.totalUsed.toLocaleString()}</p>
                        <p className="text-xs text-zinc-400">{usage.weekly.remaining.toLocaleString()} remaining</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 px-4">
                    <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center mb-3">
                      <BarChart3 className="h-6 w-6 text-zinc-800" />
                    </div>
                    <p className="text-sm text-zinc-500 text-center">No usage data yet this week</p>
                    <p className="text-xs text-zinc-400 mt-1">Make API requests to see your breakdown</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg md:text-xl">Response Times</CardTitle>
                <CardDescription className="text-sm">Average response times by type</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center justify-center py-8 px-4">
                  <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-3">
                    <Clock className="h-6 w-6 text-amber-600" />
                  </div>
                  <p className="text-sm text-zinc-500 text-center">Response time analytics coming soon</p>
                  <p className="text-xs text-zinc-400 mt-1">We're building detailed performance tracking</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
