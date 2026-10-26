import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock,
  Flame,
  Gauge,
  MapPinned,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { useMeta } from '../context/AppProviders';
import { useAsync } from '../hooks/useAsync';
import { useReportFilters } from '../hooks/useFilters';
import { analyticsApi } from '../services/endpoints';
import type { PriorityQueueItem } from '../types';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, ProgressBar, Skeleton } from '../components/ui';
import { CategoryBarChart, DonutChart, TimeSeriesChart, TrendLineChart } from '../components/charts';
import { CATEGORY_LABELS, PriorityBadge, SEVERITY_LABELS, StatusBadge } from '../components/badges';
import { FilterBar } from '../components/FilterBar';

const ICONS: Record<string, typeof ClipboardList> = {
  total_reports: ClipboardList,
  reports_this_month: TrendingUp,
  verified_reports: ShieldCheck,
  unresolved_reports: TriangleAlert,
  under_repair: Wrench,
  resolved_reports: CheckCircle2,
  avg_resolution_days: Clock,
  high_priority_verified: Flame,
};

const TONE: Record<string, string> = {
  total_reports: 'text-ink-900 dark:text-white',
  reports_this_month: 'text-sky-600 dark:text-sky-400',
  verified_reports: 'text-violet-600 dark:text-violet-400',
  unresolved_reports: 'text-amber-600 dark:text-amber-400',
  under_repair: 'text-ember-600 dark:text-ember-400',
  resolved_reports: 'text-emerald-600 dark:text-emerald-400',
  avg_resolution_days: 'text-teal-600 dark:text-teal-400',
  high_priority_verified: 'text-signal-red',
};

function queryFromFilters(filters: ReturnType<typeof useReportFilters>['filters']) {
  return {
    q: filters.q,
    status: filters.status,
    category: filters.category,
    severity: filters.severity,
    date_from: filters.date_from,
    date_to: filters.date_to,
    include_synthetic: filters.include_synthetic ?? true,
    only_synthetic: filters.only_synthetic ?? false,
  };
}

export function OverviewPage() {
  const { options } = useMeta();
  const { filters, update, reset, activeCount } = useReportFilters();
  const query = useMemo(() => queryFromFilters(filters), [filters]);

  const overview = useAsync(() => analyticsApi.overview(query), [JSON.stringify(query)]);
  const charts = useAsync(() => analyticsApi.charts(query), [JSON.stringify(query)]);
  const queue = useAsync(
    () => analyticsApi.priorityQueue(6, filters.include_synthetic ?? true),
    [filters.include_synthetic],
  );
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    overview.reload();
    charts.reload();
    queue.reload();
    window.setTimeout(() => setRefreshing(false), 600);
  };

  const chartByName = (name: string) => charts.data?.charts.find((bundle) => bundle.name === name);
  const resolutionChart = chartByName('Resolution trend');

  return (
    <div>
      <PageHeader
        eyebrow="Operations overview"
        title="Road damage control room"
        description="Every figure on this page is computed from stored reports using the filters below. Demo-generated records are badged DEMO and can be excluded."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refresh} loading={refreshing} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Refresh
            </Button>
            <Link to="/report">
              <Button size="sm" icon={<TriangleAlert className="h-3.5 w-3.5" />}>
                Report damage
              </Button>
            </Link>
          </>
        }
      />

      <FilterBar
        filters={filters}
        onChange={update}
        onReset={reset}
        activeCount={activeCount}
        showSearch={false}
        compact
      />

      {overview.error ? (
        <Card className="mb-4">
          <ErrorState message={overview.error} hints={overview.hints} onRetry={overview.reload} />
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {overview.loading && !overview.data
          ? Array.from({ length: 8 }).map((_, index) => (
              <Card key={index} className="card-pad">
                <Skeleton className="mb-2 h-3 w-24" />
                <Skeleton className="h-7 w-16" />
              </Card>
            ))
          : (overview.data?.kpis ?? []).map((kpi) => {
              const Icon = ICONS[kpi.key] ?? Gauge;
              const display =
                kpi.key === 'avg_resolution_days'
                  ? kpi.value === 0
                    ? '—'
                    : kpi.value.toFixed(1)
                  : kpi.value.toLocaleString();
              return (
                <Card key={kpi.key} className="card-pad">
                  <div className="flex items-start justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                      {kpi.label}
                    </p>
                    <Icon className="h-4 w-4 text-ink-300 dark:text-ink-600" aria-hidden />
                  </div>
                  <p className={`mt-1 text-2xl font-bold tabular-nums ${TONE[kpi.key] ?? ''}`}>
                    {display}
                    {kpi.unit ? <span className="ml-1 text-xs font-medium text-ink-400">{kpi.unit}</span> : null}
                  </p>
                  {kpi.hint ? <p className="mt-0.5 text-[10px] leading-snug text-ink-400 dark:text-ink-500">{kpi.hint}</p> : null}
                </Card>
              );
            })}
      </div>

      {overview.data && overview.data.record_count === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<MapPinned className="h-5 w-5" />}
            title="No reports match these filters"
            description="Clear the filters, or submit a new report. The dashboard never shows placeholder statistics — with no records every KPI is genuinely zero."
            action={
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={reset}>
                  Clear filters
                </Button>
                <Link to="/report">
                  <Button size="sm">Report damage</Button>
                </Link>
              </div>
            }
          />
        </Card>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TimeSeriesChart bundle={chartByName('Reports by date')} loading={charts.loading} />
        </div>
        <DonutChart bundle={chartByName('Reports by status')} loading={charts.loading} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <CategoryBarChart bundle={chartByName('Damage categories')} loading={charts.loading} horizontal />
        <CategoryBarChart bundle={chartByName('Outstanding repairs by age')} loading={charts.loading} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TrendLineChart bundle={resolutionChart} loading={charts.loading} />
        </div>
        <Card>
          <CardHeader
            title="Priority queue"
            description="Verified or in-repair cases ordered by the explainable priority score."
            icon={<Flame className="h-4 w-4" />}
            actions={
              <Link to="/repairs" className="text-[11px] font-semibold text-ember-600 hover:underline dark:text-ember-400">
                Manage
              </Link>
            }
          />
          <div className="p-3">
            {queue.loading ? (
              <Skeleton className="h-40 w-full" />
            ) : queue.error ? (
              <ErrorState message={queue.error} onRetry={queue.reload} />
            ) : queue.data?.items.length ? (
              <ul className="divide-y divide-ink-100 dark:divide-ink-800">
                {queue.data.items.map((item: PriorityQueueItem) => (
                  <li key={item.id} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <Link to={`/reports/${item.id}`} className="text-xs font-semibold text-ink-900 hover:underline dark:text-ink-50">
                        {item.reference}
                      </Link>
                      <PriorityBadge score={item.priority_score} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-ink-500 dark:text-ink-400">
                      {CATEGORY_LABELS[item.damage_category]} · {item.road_name ?? 'road not named'} ·{' '}
                      {item.reviewed_severity ? SEVERITY_LABELS[item.reviewed_severity] : 'unrated'}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <StatusBadge status={item.status} />
                      <span className="text-[10px] text-ink-400">{item.age_days.toFixed(0)} d open</span>
                    </div>
                    <ProgressBar value={item.priority_score} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="Nothing awaiting repair"
                description="Verified reports appear here once a reviewer confirms the damage."
              />
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Demo data status" icon={<BarChart3 className="h-4 w-4" />} />
          <div className="card-pad space-y-2 text-xs text-ink-600 dark:text-ink-300">
            <p>
              Region: <strong>{options?.demo_region_label ?? 'Ahmedabad, Gujarat (demo region)'}</strong>
            </p>
            <p>
              This build ships with a generated dataset for demonstration. Rows created by the generator carry{' '}
              <Badge tone="warning">DEMO</Badge> badges everywhere, including exports, so they can never be mistaken for
              real citizen submissions.
            </p>
            <p>
              Purging the demo set leaves real reports untouched:
              <code className="ml-1 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] dark:bg-ink-800">
                python -m app.services.demo_data --purge
              </code>
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader title="How priority is decided" icon={<Gauge className="h-4 w-4" />} />
          <div className="card-pad space-y-1.5 text-xs text-ink-600 dark:text-ink-300">
            {Object.entries(options?.priority_weights ?? {}).map(([key, weight]) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <span className="capitalize">{key.replace(/_/g, ' ')}</span>
                <span className="tabular-nums text-ink-500">{weight.toFixed(2)}</span>
              </div>
            ))}
            <p className="pt-1 text-[10px] text-ink-400">
              AI confidence is deliberately excluded from severity. A confident detection is not proof of a dangerous
              pothole.
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader title="Shortcuts" icon={<ArrowUpRight className="h-4 w-4" />} />
          <div className="card-pad grid gap-2">
            {[
              { to: '/map', label: 'Open live damage map' },
              { to: '/reports', label: 'Browse every report' },
              { to: '/model', label: 'Inspect model performance' },
              { to: '/exports', label: 'Export CSV / JSON / PDF' },
            ].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-700 transition hover:border-ember-400 hover:text-ember-700 dark:border-ink-700 dark:text-ink-200 dark:hover:border-ember-500"
              >
                {item.label}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
