import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowUpDown, FileText, ListChecks, RefreshCw, TriangleAlert } from 'lucide-react';
import { useDebounced } from '../hooks/useDebounced';
import { useReportFilters } from '../hooks/useFilters';
import { useAsync } from '../hooks/useAsync';
import { reportApi } from '../services/endpoints';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../components/ui';
import { FilterBar } from '../components/FilterBar';
import { ReportDetailPanel } from '../components/ReportDetailPanel';
import {
  CATEGORY_LABELS,
  ConfidenceMeter,
  DemoBadge,
  PriorityBadge,
  SeverityBadge,
  StatusBadge,
} from '../components/badges';

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

export function ReportsPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();
  const { filters, update, reset, activeCount } = useReportFilters();
  const [search, setSearch] = useState(filters.q ?? '');
  const debouncedSearch = useDebounced(search, 350);

  // The input is driven by `search` (instant feedback) and only the debounced
  // value is pushed into the shared filters (single source of truth for API
  // calls, exports and pagination).
  useEffect(() => {
    if ((filters.q ?? '') !== debouncedSearch) {
      update({ q: debouncedSearch || undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = useMemo(
    () => ({ ...filters, q: debouncedSearch || undefined }),
    [filters, debouncedSearch],
  );
  const reports = useAsync(() => reportApi.list(query), [JSON.stringify(query)]);

  const items = reports.data?.items ?? [];
  const meta = reports.data?.meta;

  const sortButton = (field: string, label: string) => (
    <button
      type="button"
      onClick={() => update({ sort: field, order: filters.sort === field && filters.order === 'desc' ? 'asc' : 'desc' })}
      className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-ember-600 dark:hover:text-ember-400"
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Register"
        title="All damage reports"
        description="Search, filter and open any report. Reviewers can correct fields, move reports through the lifecycle and link duplicates — every change is audited."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={reports.reload} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Refresh
            </Button>
            <Link to="/report">
              <Button size="sm" icon={<TriangleAlert className="h-3.5 w-3.5" />}>
                New report
              </Button>
            </Link>
          </>
        }
      />

      <FilterBar
        filters={{ ...filters, q: search }}
        onChange={(patch) => {
          if (patch.q !== undefined) {
            setSearch(patch.q ?? '');
            return; // debounced effect pushes it into filters
          }
          update(patch);
        }}
        onReset={() => {
          setSearch('');
          reset();
        }}
        activeCount={activeCount}
        showPriority
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-ember-500" />
            <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
              {meta ? `${meta.total} report(s)` : 'Reports'}
            </h2>
            {meta ? <span className="text-[11px] text-ink-500 dark:text-ink-400">sorted by {meta.sort.replace(/_/g, ' ')}</span> : null}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-ink-500 dark:text-ink-400">
            <Badge tone="warning">DEMO</Badge> = synthetic demo record
          </div>
        </div>

        {reports.error ? (
          <ErrorState message={reports.error} hints={reports.hints} onRetry={reports.reload} />
        ) : reports.loading && !reports.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No reports found"
            description="Nothing matches the current search and filters. Try clearing them, or submit the first report."
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={reset}>
                  Clear filters
                </Button>
                <Link to="/report">
                  <Button size="sm">Report damage</Button>
                </Link>
              </div>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{sortButton('reference', 'Reference')}</th>
                  <th>Category</th>
                  <th>Severity</th>
                  <th>{sortButton('priority_score', 'Priority')}</th>
                  <th>{sortButton('detection_confidence', 'AI conf.')}</th>
                  <th>{sortButton('status', 'Status')}</th>
                  <th>Road</th>
                  <th>{sortButton('reported_at', 'Reported')}</th>
                  <th className="text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {items.map((report) => (
                  <tr key={report.id}>
                    <td>
                      <button
                        type="button"
                        onClick={() => navigate(`/reports/${report.id}`)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-ink-900 hover:text-ember-600 dark:text-ink-50 dark:hover:text-ember-400"
                      >
                        {report.reference}
                        <DemoBadge show={report.is_synthetic} />
                      </button>
                      <p className="mt-0.5 text-[10px] text-ink-400">
                        {report.latitude !== null ? `${report.latitude.toFixed(4)}, ${report.longitude?.toFixed(4)}` : 'no coordinates'}
                      </p>
                    </td>
                    <td className="text-xs">{CATEGORY_LABELS[report.damage_category]}</td>
                    <td>
                      <SeverityBadge severity={report.reviewed_severity} />
                    </td>
                    <td>
                      <PriorityBadge score={report.priority_score} />
                    </td>
                    <td>
                      <ConfidenceMeter value={report.detection_confidence} />
                    </td>
                    <td>
                      <StatusBadge status={report.status} />
                    </td>
                    <td className="max-w-[180px] truncate text-xs text-ink-600 dark:text-ink-300">
                      {report.road_name ?? '—'}
                      {report.ward ? <span className="block text-[10px] text-ink-400">{report.ward}</span> : null}
                    </td>
                    <td className="whitespace-nowrap text-xs">{formatDate(report.reported_at)}</td>
                    <td className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/reports/${report.id}`)}
                        icon={<FileText className="h-3.5 w-3.5" />}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta ? (
          <Pagination
            page={meta.page}
            pageSize={meta.page_size}
            total={meta.total}
            totalPages={meta.total_pages}
            onPage={(page) => update({ page })}
            onPageSize={(page_size) => update({ page_size })}
          />
        ) : null}
      </Card>

      {reportId ? (
        <ReportDetailPanel reportId={reportId} onClose={() => navigate('/reports')} onChanged={reports.reload} />
      ) : null}
    </div>
  );
}
