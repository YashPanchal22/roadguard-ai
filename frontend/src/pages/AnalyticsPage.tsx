import { useMemo, useState } from 'react';
import { BarChart3, Download, RefreshCw, Table2 } from 'lucide-react';
import { useAsync } from '../hooks/useAsync';
import { useReportFilters } from '../hooks/useFilters';
import { analyticsApi, exportUrl } from '../services/endpoints';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Select } from '../components/ui';
import { CategoryBarChart, DonutChart, TimeSeriesChart, TrendLineChart } from '../components/charts';
import { FilterBar } from '../components/FilterBar';

export function AnalyticsPage() {
  const { filters, update, reset, activeCount } = useReportFilters();
  const [days, setDays] = useState(30);

  const query = useMemo(
    () => ({
      q: filters.q,
      status: filters.status,
      category: filters.category,
      severity: filters.severity,
      date_from: filters.date_from,
      date_to: filters.date_to,
      include_synthetic: filters.include_synthetic ?? true,
      only_synthetic: filters.only_synthetic ?? false,
      days,
    }),
    [filters, days],
  );

  const charts = useAsync(() => analyticsApi.charts(query), [JSON.stringify(query)]);
  const regions = useAsync(() => analyticsApi.regions(), []);
  const byName = (name: string) => charts.data?.charts.find((bundle) => bundle.name === name);

  const regionRows = (regions.data ?? []) as { ward: string; reports: number; unresolved: number; avg_priority: number }[];

  return (
    <div>
      <PageHeader
        eyebrow="Data science"
        title="Damage analytics"
        description="Aggregations computed from stored records with the same filters used across the app. Empty filters and empty datasets produce genuine zeroes and empty states."
        actions={
          <>
            <Select value={days} onChange={(event) => setDays(Number(event.target.value))} className="w-auto" aria-label="Time window">
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
            </Select>
            <Button variant="outline" size="sm" onClick={charts.reload} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Refresh
            </Button>
            <a href={exportUrl('csv', filters)} download>
              <Button size="sm" icon={<Download className="h-3.5 w-3.5" />}>
                Export CSV
              </Button>
            </a>
          </>
        }
      />

      <FilterBar filters={filters} onChange={update} onReset={reset} activeCount={activeCount} showSearch={false} showPriority compact />

      {charts.error ? (
        <Card>
          <ErrorState message={charts.error} hints={charts.hints} onRetry={charts.reload} />
        </Card>
      ) : null}

      {charts.data && charts.data.record_count === 0 ? (
        <Card>
          <EmptyState
            icon={<BarChart3 className="h-5 w-5" />}
            title="No records in scope"
            description="No reports match the current filters, so there is nothing to aggregate. Charts stay empty rather than showing invented values."
            action={
              <Button size="sm" variant="outline" onClick={reset}>
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TimeSeriesChart bundle={byName('Reports by date')} loading={charts.loading} />
        </div>
        <DonutChart bundle={byName('Reports by status')} loading={charts.loading} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <CategoryBarChart bundle={byName('Damage categories')} loading={charts.loading} horizontal />
        <CategoryBarChart bundle={byName('Severity distribution')} loading={charts.loading} />
        <CategoryBarChart bundle={byName('Outstanding repairs by age')} loading={charts.loading} />
        <CategoryBarChart bundle={byName('AI confidence distribution')} loading={charts.loading} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <TrendLineChart bundle={byName('Resolution trend')} loading={charts.loading} />
        <CategoryBarChart bundle={byName('Damage by region')} loading={charts.loading} horizontal />
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Regional breakdown"
          description="Reports per ward where location data exists. Wards absent from the data are not listed — nothing is imputed."
          icon={<Table2 className="h-4 w-4" />}
        />
        {regions.error ? (
          <ErrorState message={regions.error} onRetry={regions.reload} />
        ) : regionRows.length === 0 ? (
          <EmptyState title="No regional data" description="Reports without a ward cannot be grouped by region." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Ward / region</th>
                  <th className="text-right">Reports</th>
                  <th className="text-right">Unresolved</th>
                  <th className="text-right">Avg priority</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {regionRows.map((row) => {
                  const total = regionRows.reduce((sum, item) => sum + item.reports, 0) || 1;
                  const share = (row.reports / total) * 100;
                  return (
                    <tr key={row.ward}>
                      <td className="text-xs font-medium">{row.ward}</td>
                      <td className="text-right text-xs tabular-nums">{row.reports}</td>
                      <td className="text-right text-xs tabular-nums">{row.unresolved}</td>
                      <td className="text-right text-xs tabular-nums">{row.avg_priority.toFixed(1)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
                            <div className="h-full rounded-full bg-ember-500" style={{ width: `${share}%` }} />
                          </div>
                          <span className="text-[10px] text-ink-500 dark:text-ink-400">{share.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-ink-500 dark:text-ink-400">
        <Badge tone="neutral">{charts.data?.record_count ?? 0} records in scope</Badge>
        <span>Generated {charts.data ? new Date(charts.data.generated_at).toLocaleString() : '—'}</span>
        <span>· Confidence charts describe the model, never the danger of a defect.</span>
      </div>
    </div>
  );
}
