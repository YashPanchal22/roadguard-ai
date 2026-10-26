import { useMemo, useState } from 'react';
import { Download, FileJson, FileSpreadsheet, FileText, Info } from 'lucide-react';
import { useAuth } from '../context/AppProviders';
import { useAsync } from '../hooks/useAsync';
import { useReportFilters } from '../hooks/useFilters';
import { analyticsApi, exportUrl, reportApi } from '../services/endpoints';
import { Badge, Button, Card, CardHeader, InlineNotice, KeyValue, PageHeader } from '../components/ui';
import { FilterBar } from '../components/FilterBar';

export function ExportsPage() {
  const { user } = useAuth();
  const { filters, update, reset, activeCount } = useReportFilters();
  const [previewKey, setPreviewKey] = useState(0);

  const total = useAsync(
    () => reportApi.list({ ...filters, page_size: 1 }),
    [JSON.stringify(filters), previewKey],
  );
  const overview = useAsync(
    () =>
      analyticsApi.overview({
        q: filters.q,
        status: filters.status,
        category: filters.category,
        severity: filters.severity,
        date_from: filters.date_from,
        date_to: filters.date_to,
        include_synthetic: filters.include_synthetic ?? true,
        only_synthetic: filters.only_synthetic ?? false,
      }),
    [JSON.stringify(filters), previewKey],
  );

  const recordCount = total.data?.meta.total ?? 0;
  const generatedAt = useMemo(() => new Date().toLocaleString(), []);

  const cards = [
    {
      kind: 'csv' as const,
      title: 'CSV register',
      description: 'One row per report with status, category, severity, priority, coordinates, confidence and resolution time. Opens in Excel or pandas.',
      icon: FileSpreadsheet,
      media: 'text/csv',
    },
    {
      kind: 'json' as const,
      title: 'JSON bundle',
      description: 'Full structured export including detections with bounding boxes and the repair history for each report. Suitable for integration or analysis.',
      icon: FileJson,
      media: 'application/json',
    },
    {
      kind: 'pdf' as const,
      title: 'PDF summary',
      description: 'Print-ready briefing with KPI table, distribution charts and a report register, stamped with the generation time.',
      icon: FileText,
      media: 'application/pdf',
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Reporting"
        title="Reports & exports"
        description="Every export is built from the same filtered database query the app uses — the record count below shows exactly what will be included."
      />

      <FilterBar
        filters={filters}
        onChange={(patch) => {
          update(patch);
          setPreviewKey((value) => value + 1);
        }}
        onReset={() => {
          reset();
          setPreviewKey((value) => value + 1);
        }}
        activeCount={activeCount}
        showPriority
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          const href = exportUrl(card.kind, filters);
          return (
            <Card key={card.kind} className="flex flex-col">
              <CardHeader title={card.title} description={card.description} icon={<Icon className="h-4 w-4" />} />
              <div className="mt-auto flex items-center justify-between gap-2 border-t border-ink-100 p-3 dark:border-ink-800">
                <div className="flex items-center gap-1.5">
                  <Badge tone="neutral">{recordCount} rows</Badge>
                  <Badge tone="neutral">{card.media}</Badge>
                </div>
                <a href={href} download>
                  <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} disabled={recordCount === 0}>
                    Download
                  </Button>
                </a>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Export scope" icon={<Info className="h-4 w-4" />} />
          <div className="card-pad">
            {overview.error ? (
              <InlineNotice tone="danger">{overview.error}</InlineNotice>
            ) : (
              <dl className="grid grid-cols-2 gap-3">
                <KeyValue label="Records in scope" value={recordCount} />
                <KeyValue label="Generated at" value={generatedAt} />
                <KeyValue label="Demo records" value={filters.only_synthetic ? 'Only demo' : filters.include_synthetic === false ? 'Excluded' : 'Included'} />
                <KeyValue label="Reporter identity" value={user?.role === 'admin' ? 'Included (admin)' : 'Excluded'} />
                <KeyValue
                  label="Statuses"
                  value={filters.status?.length ? filters.status.join(', ').replace(/_/g, ' ') : 'All'}
                />
                <KeyValue
                  label="Categories"
                  value={filters.category?.length ? filters.category.join(', ').replace(/_/g, ' ') : 'All'}
                />
              </dl>
            )}
            <div className="mt-3 space-y-2">
              <InlineNotice tone="info" title="Privacy handling">
                <p>
                  Reporter names are omitted for non-administrators. Filesystem paths are never included. Images remain
                  stored as files and are referenced by API URL only.
                </p>
              </InlineNotice>
              <InlineNotice tone="warning" title="Demo disclosure">
                Exports include an <code>is_synthetic</code> column and a notice in the JSON payload so demonstration data
                is never mixed silently with real submissions.
              </InlineNotice>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Quick actions" />
          <div className="card-pad space-y-2">
            <a href={exportUrl('csv', { status: ['verified'], include_synthetic: true })} download>
              <Button variant="outline" size="sm" className="w-full justify-between" icon={<FileSpreadsheet className="h-3.5 w-3.5" />}>
                Verified reports (CSV) <Download className="h-3.5 w-3.5" />
              </Button>
            </a>
            <a href={exportUrl('csv', { status: ['resolved'], include_synthetic: true })} download>
              <Button variant="outline" size="sm" className="w-full justify-between" icon={<FileSpreadsheet className="h-3.5 w-3.5" />}>
                Resolved reports (CSV) <Download className="h-3.5 w-3.5" />
              </Button>
            </a>
            <a href={exportUrl('json', { only_synthetic: true })} download>
              <Button variant="outline" size="sm" className="w-full justify-between" icon={<FileJson className="h-3.5 w-3.5" />}>
                Demo dataset only (JSON) <Download className="h-3.5 w-3.5" />
              </Button>
            </a>
            <a href={exportUrl('pdf', { include_synthetic: false })} download>
              <Button variant="outline" size="sm" className="w-full justify-between" icon={<FileText className="h-3.5 w-3.5" />}>
                Real submissions only (PDF) <Download className="h-3.5 w-3.5" />
              </Button>
            </a>
            <p className="pt-1 text-[11px] text-ink-500 dark:text-ink-400">
              Exports are generated on the server at request time, so they always reflect the current database state.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
