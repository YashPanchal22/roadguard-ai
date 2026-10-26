import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Layers, ListFilter, MapPin, RefreshCw, Rows3 } from 'lucide-react';
import { useMeta } from '../context/AppProviders';
import { useAsync } from '../hooks/useAsync';
import { useDebounced } from '../hooks/useDebounced';
import { mapApi } from '../services/endpoints';
import type { ReportSummary } from '../types';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Select, Spinner } from '../components/ui';
import { MapLegend, MapView, markerColor } from '../components/MapView';
import { CATEGORY_LABELS, ConfidenceMeter, DemoBadge, PriorityBadge, StatusBadge } from '../components/badges';
import { ReportDetailPanel } from '../components/ReportDetailPanel';
import { FilterBar } from '../components/FilterBar';
import { useReportFilters } from '../hooks/useFilters';

const DEFAULT_BOUNDS = { south: 22.85, west: 72.35, north: 23.25, east: 72.75 };

export function MapPage() {
  const { options } = useMeta();
  const { filters, update, reset, activeCount } = useReportFilters({ page_size: 50 });
  const [bounds, setBounds] = useState(DEFAULT_BOUNDS);
  const [selected, setSelected] = useState<ReportSummary | null>(null);
  const [view, setView] = useState<'split' | 'map'>('split');
  const [onlyDemo, setOnlyDemo] = useState<'all' | 'demo' | 'real'>('all');

  const debouncedBounds = useDebounced(bounds, 400);

  const reports = useAsync(
    () =>
      mapApi.reports(debouncedBounds, {
        status: filters.status,
        category: filters.category,
        severity: filters.severity,
        include_synthetic: onlyDemo !== 'real',
        exclude_duplicates: false,
      }),
    [JSON.stringify(debouncedBounds), JSON.stringify(filters.status), JSON.stringify(filters.category), JSON.stringify(filters.severity), onlyDemo],
  );

  const visible = useMemo(() => {
    const rows = reports.data ?? [];
    if (onlyDemo === 'demo') return rows.filter((row) => row.is_synthetic);
    if (onlyDemo === 'real') return rows.filter((row) => !row.is_synthetic);
    return rows;
  }, [reports.data, onlyDemo]);

  const handleSelect = useCallback((report: ReportSummary) => setSelected(report), []);

  const center = selected && selected.latitude && selected.longitude
    ? { lat: selected.latitude, lng: selected.longitude }
    : { lat: options?.map_defaults.lat ?? 23.0225, lng: options?.map_defaults.lng ?? 72.5714 };

  return (
    <div>
      <PageHeader
        eyebrow="Geospatial"
        title="Live damage map"
        description="Reports with valid coordinates, plotted on OpenStreetMap. Pan or zoom to load reports for the visible area; markers are coloured by reviewed severity."
        actions={
          <>
            <Select value={onlyDemo} onChange={(event) => setOnlyDemo(event.target.value as typeof onlyDemo)} className="w-auto" aria-label="Dataset">
              <option value="all">All records</option>
              <option value="demo">Demo only</option>
              <option value="real">Real submissions only</option>
            </Select>
            <Button variant="outline" size="sm" onClick={reports.reload} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Reload view
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setView(view === 'split' ? 'map' : 'split')}
              icon={view === 'split' ? <Layers className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
            >
              {view === 'split' ? 'Map only' : 'Map + list'}
            </Button>
          </>
        }
      />

      <FilterBar filters={filters} onChange={update} onReset={reset} activeCount={activeCount} showSearch={false} showDates={false} compact />

      <div className={`grid gap-4 ${view === 'split' ? 'xl:grid-cols-3' : ''}`}>
        <div className={view === 'split' ? 'xl:col-span-2' : ''}>
          <Card className="overflow-hidden">
            <CardHeader
              title={`${visible.length} report(s) in view`}
              description={options?.demo_region_label ?? 'Ahmedabad, Gujarat (demo region)'}
              icon={<MapPin className="h-4 w-4" />}
              actions={<MapLegend />}
            />
            <div className="p-2">
              {reports.error ? (
                <ErrorState message={reports.error} hints={reports.hints} onRetry={reports.reload} />
              ) : reports.loading && !reports.data ? (
                <Spinner label="Loading reports for this area" />
              ) : (
                <MapView
                  center={center}
                  zoom={options?.map_defaults.zoom ?? 12}
                  reports={visible}
                  selectedId={selected?.id ?? null}
                  onSelect={handleSelect}
                  onBoundsChange={setBounds}
                  height="clamp(420px, 62vh, 680px)"
                  fitToReports={!selected && visible.length > 1}
                  pin={null}
                />
              )}
            </div>
            <div className="border-t border-ink-100 px-4 py-2 text-[11px] text-ink-500 dark:border-ink-800 dark:text-ink-400">
              Only reports with valid latitude/longitude are plotted. Tiles © OpenStreetMap contributors; bulk scraping
              is not permitted — configure a dedicated tile provider for production.
            </div>
          </Card>
        </div>

        {view === 'split' ? (
          <Card className="flex flex-col">
            <CardHeader
              title="Synchronised list"
              description="Click a row to highlight and open the marker."
              icon={<ListFilter className="h-4 w-4" />}
            />
            <div className="max-h-[640px] divide-y divide-ink-100 overflow-y-auto dark:divide-ink-800">
              {reports.loading && !reports.data ? (
                <Spinner />
              ) : visible.length === 0 ? (
                <EmptyState
                  title="No mapped reports"
                  description="Nothing matches in this map area. Zoom out, clear filters, or check that the records have coordinates."
                  action={
                    <Link to="/report">
                      <Button size="sm">Report damage here</Button>
                    </Link>
                  }
                />
              ) : (
                visible.map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => handleSelect(report)}
                    className={`w-full px-3.5 py-2.5 text-left transition hover:bg-ink-50 dark:hover:bg-ink-800/50 ${
                      selected?.id === report.id ? 'bg-ember-50 dark:bg-ember-950/40' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-900 dark:text-ink-50">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: markerColor(report) }} />
                        {report.reference}
                        <DemoBadge show={report.is_synthetic} />
                      </span>
                      <PriorityBadge score={report.priority_score} />
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-ink-500 dark:text-ink-400">
                      {CATEGORY_LABELS[report.damage_category]} · {report.road_name ?? 'unnamed road'}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <StatusBadge status={report.status} />
                      <ConfidenceMeter value={report.detection_confidence} />
                    </div>
                  </button>
                ))
              )}
            </div>
            <div className="mt-auto border-t border-ink-100 px-3 py-2 dark:border-ink-800">
              <a
                href={`https://www.openstreetmap.org/#map=12/${center.lat}/${center.lng}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-ember-600 hover:underline dark:text-ember-400"
              >
                <ExternalLink className="h-3 w-3" /> Open this area in OpenStreetMap
              </a>
            </div>
          </Card>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-ink-500 dark:text-ink-400">
        <Badge tone="warning">DEMO</Badge> records come from the synthetic generator and are positioned at plausible
        coordinates around the demo region — they are not claims about real damage.
      </div>

      {selected ? (
        <ReportDetailPanel
          reportId={selected.id}
          onClose={() => setSelected(null)}
          onChanged={reports.reload}
        />
      ) : null}
    </div>
  );
}
