import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ClipboardCheck, RefreshCw, Wrench } from 'lucide-react';
import { useAuth } from '../context/AppProviders';
import { useAsync } from '../hooks/useAsync';
import { reportApi } from '../services/endpoints';
import type { ReportStatus, ReportSummary } from '../types';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, InlineNotice, PageHeader, Skeleton } from '../components/ui';
import { CATEGORY_LABELS, DemoBadge, PriorityBadge, SeverityBadge, StatusBadge, STATUS_LABELS } from '../components/badges';
import { ReportDetailPanel } from '../components/ReportDetailPanel';

const COLUMNS: { status: ReportStatus; hint: string }[] = [
  { status: 'under_review', hint: 'Triage in progress' },
  { status: 'verified', hint: 'Confirmed, awaiting assignment' },
  { status: 'assigned_for_repair', hint: 'Work order raised' },
  { status: 'in_progress', hint: 'Crew on site' },
  { status: 'resolved', hint: 'Repair complete' },
];

export function RepairsPage() {
  const { canReview } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const byStatus = useAsync(
    () => reportApi.list({ status: COLUMNS.map((column) => column.status), page_size: 200, sort: 'priority_score', order: 'desc' }),
    [reloadKey],
  );
  const verifiedQueue = useAsync(
    () => reportApi.list({ status: ['verified'], page_size: 5, sort: 'priority_score', order: 'desc' }),
    [reloadKey],
  );

  const grouped = useMemo(() => {
    const map = new Map<ReportStatus, ReportSummary[]>();
    COLUMNS.forEach((column) => map.set(column.status, []));
    (byStatus.data?.items ?? []).forEach((report) => {
      const bucket = map.get(report.status);
      if (bucket) bucket.push(report);
    });
    return map;
  }, [byStatus.data]);

  const priorityList = verifiedQueue.data?.items ?? [];

  const refresh = () => {
    byStatus.reload();
    verifiedQueue.reload();
    setReloadKey((value) => value + 1);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Repair management"
        description="Move verified damage through assignment and repair. Each transition stores a timestamp, a note and the reviewer who made the change."
        actions={
          <Button variant="outline" size="sm" onClick={refresh} icon={<RefreshCw className="h-3.5 w-3.5" />}>
            Refresh board
          </Button>
        }
      />

      {!canReview ? (
        <InlineNotice tone="info" title="Read-only view">
          You are browsing as a public/citizen user. Sign in with a reviewer or administrator account to change statuses.
          <Link to="/login" className="link ml-1">
            Sign in
          </Link>
        </InlineNotice>
      ) : null}

      <Card className="mt-3">
        <CardHeader
          title="Verified cases by priority"
          description="Priority ordering is explainable — open a case to see each factor's contribution."
          icon={<ClipboardCheck className="h-4 w-4" />}
        />
        <div className="card-pad">
          {verifiedQueue.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : priorityList.length === 0 ? (
            <EmptyState
              title="No verified reports waiting"
              description="Verified reports appear here. Move an under-review report to Verified from the report panel."
            />
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {priorityList.map((report) => (
                <li key={report.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelectedId(report.id)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-ink-900 hover:text-ember-600 dark:text-ink-50"
                    >
                      {report.reference}
                      <DemoBadge show={report.is_synthetic} />
                    </button>
                    <p className="text-[11px] text-ink-500 dark:text-ink-400">
                      {CATEGORY_LABELS[report.damage_category]} · {report.road_name ?? 'unnamed road'} ·{' '}
                      {report.ward ?? 'no ward'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={report.reviewed_severity} />
                    <PriorityBadge score={report.priority_score} />
                    <Button size="sm" variant="outline" onClick={() => setSelectedId(report.id)} icon={<ArrowRight className="h-3 w-3" />}>
                      Manage
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {byStatus.error ? (
        <Card className="mt-3">
          <ErrorState message={byStatus.error} hints={byStatus.hints} onRetry={byStatus.reload} />
        </Card>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-5">
        {COLUMNS.map((column) => {
          const reports = grouped.get(column.status) ?? [];
          return (
            <div key={column.status} className="flex flex-col rounded-xl border border-ink-200 bg-ink-100/50 dark:border-ink-800 dark:bg-ink-900/40">
              <div className="flex items-center justify-between gap-1 border-b border-ink-200 px-2.5 py-2 dark:border-ink-800">
                <div className="flex items-center gap-1.5">
                  {column.status === 'resolved' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Wrench className="h-3.5 w-3.5 text-ember-500" />}
                  <p className="text-[11px] font-bold uppercase tracking-wide text-ink-700 dark:text-ink-200">
                    {STATUS_LABELS[column.status]}
                  </p>
                </div>
                <Badge tone="neutral">{reports.length}</Badge>
              </div>
              <p className="px-2.5 pt-1.5 text-[10px] text-ink-500 dark:text-ink-400">{column.hint}</p>
              <div className="flex-1 space-y-1.5 p-2">
                {byStatus.loading && !byStatus.data ? (
                  <Skeleton className="h-16 w-full" />
                ) : reports.length === 0 ? (
                  <p className="px-1 py-4 text-center text-[11px] text-ink-400">Empty</p>
                ) : (
                  reports.slice(0, 12).map((report) => (
                    <button
                      key={report.id}
                      type="button"
                      onClick={() => setSelectedId(report.id)}
                      className="w-full rounded-lg border border-ink-200 bg-white p-2 text-left shadow-sm transition hover:border-ember-400 dark:border-ink-700 dark:bg-ink-900"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-semibold text-ink-900 dark:text-ink-50">{report.reference}</span>
                        <PriorityBadge score={report.priority_score} />
                      </div>
                      <p className="mt-0.5 truncate text-[10px] text-ink-500 dark:text-ink-400">
                        {CATEGORY_LABELS[report.damage_category]}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <StatusBadge status={report.status} />
                        <DemoBadge show={report.is_synthetic} />
                      </div>
                    </button>
                  ))
                )}
                {reports.length > 12 ? (
                  <p className="px-1 pt-1 text-[10px] text-ink-400">+{reports.length - 12} more in register</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] text-ink-500 dark:text-ink-400">
        Lifecycle rule: submitted → under review → verified → assigned for repair → in progress → resolved. A resolved
        report keeps its full transition history and cannot be reopened; create a new report for recurring damage at the
        same location.
      </p>

      {selectedId ? (
        <ReportDetailPanel
          reportId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
        />
      ) : null}
    </div>
  );
}
