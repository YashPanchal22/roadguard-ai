import { useEffect, useMemo, useRef } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ExternalLink } from 'lucide-react';
import type { ReportSummary } from '../types';
import { CATEGORY_LABELS, STATUS_LABELS } from './badges';

export const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#10b981',
  none: '#64748b',
};

export function markerColor(report: ReportSummary): string {
  if (report.status === 'resolved') return '#0ea5e9';
  if (report.status === 'rejected') return '#94a3b8';
  return SEVERITY_COLORS[report.reviewed_severity ?? 'none'] ?? SEVERITY_COLORS.none;
}

function BoundsWatcher({ onChange }: { onChange: (bounds: { south: number; west: number; north: number; east: number }) => void }) {
  useMapEvents({
    moveend: (event) => {
      const bounds = event.target.getBounds();
      onChange({
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
      });
    },
  });
  return null;
}

function ClickPicker({ onPick }: { onPick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (event) => {
      onPick?.(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

function Recenter({ lat, lng, zoom }: { lat: number; lng: number; zoom?: number }) {
  const map = useMap();
  const previous = useRef<string>('');
  useEffect(() => {
    const key = `${lat.toFixed(6)}:${lng.toFixed(6)}`;
    if (previous.current === key) return;
    previous.current = key;
    map.flyTo([lat, lng], zoom ?? map.getZoom(), { duration: 0.6 });
  }, [lat, lng, zoom, map]);
  return null;
}

function FitReports({ reports }: { reports: ReportSummary[] }) {
  const map = useMap();
  const previousCount = useRef(0);
  useEffect(() => {
    const located = reports.filter((report) => report.latitude !== null && report.longitude !== null);
    if (located.length < 2 || located.length === previousCount.current) {
      previousCount.current = located.length;
      return;
    }
    const bounds = located.map((report) => [report.latitude as number, report.longitude as number]) as [
      number,
      number,
    ][];
    map.fitBounds(bounds as LatLngBoundsExpression, { padding: [36, 36], maxZoom: 15 });
    previousCount.current = located.length;
  }, [reports, map]);
  return null;
}

export interface MapViewProps {
  center: { lat: number; lng: number };
  zoom?: number;
  reports?: ReportSummary[];
  selectedId?: string | null;
  onSelect?: (report: ReportSummary) => void;
  onBoundsChange?: (bounds: { south: number; west: number; north: number; east: number }) => void;
  onPick?: (lat: number, lng: number) => void;
  pin?: { lat: number; lng: number } | null;
  fitToReports?: boolean;
  height?: string;
  interactive?: boolean;
}

export function MapView({
  center,
  zoom = 12,
  reports = [],
  selectedId,
  onSelect,
  onBoundsChange,
  onPick,
  pin,
  fitToReports = false,
  height = '520px',
  interactive = true,
}: MapViewProps) {
  const located = useMemo(
    () => reports.filter((report) => report.latitude !== null && report.longitude !== null),
    [reports],
  );

  return (
    <div className="overflow-hidden rounded-xl" style={{ height }}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        scrollWheelZoom={interactive}
        dragging={interactive}
        style={{ height: '100%', width: '100%' }}
        className="z-0"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {onBoundsChange ? <BoundsWatcher onChange={onBoundsChange} /> : null}
        {onPick ? <ClickPicker onPick={onPick} /> : null}
        <Recenter lat={center.lat} lng={center.lng} zoom={zoom} />
        {fitToReports ? <FitReports reports={located} /> : null}

        {located.map((report) => (
          <CircleMarker
            key={report.id}
            center={[report.latitude as number, report.longitude as number]}
            radius={selectedId === report.id ? 11 : 7}
            pathOptions={{
              color: '#ffffff',
              weight: selectedId === report.id ? 3 : 1.5,
              fillColor: markerColor(report),
              fillOpacity: 0.92,
            }}
            eventHandlers={{ click: () => onSelect?.(report) }}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={1}>
              <span className="text-[11px] font-semibold">{report.reference}</span>
            </Tooltip>
            <Popup>
              <div className="min-w-[190px] space-y-1">
                <p className="text-[13px] font-bold text-ink-900">{report.reference}</p>
                <p className="text-[11px] text-ink-600">
                  {CATEGORY_LABELS[report.damage_category]} · {STATUS_LABELS[report.status]}
                </p>
                <p className="text-[11px] text-ink-600">
                  Severity: <strong>{report.reviewed_severity ?? 'not rated'}</strong> · Priority{' '}
                  <strong>{report.priority_score.toFixed(0)}</strong>
                </p>
                <p className="text-[11px] text-ink-600">
                  AI confidence:{' '}
                  <strong>
                    {report.detection_confidence !== null ? `${Math.round(report.detection_confidence * 100)}%` : '—'}
                  </strong>
                </p>
                <p className="text-[11px] text-ink-600">
                  {report.road_name ?? 'Road name not provided'} ·{' '}
                  {new Date(report.reported_at).toLocaleDateString()}
                </p>
                {report.is_synthetic ? (
                  <p className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                    Demo record
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onSelect?.(report)}
                    className="rounded bg-ink-900 px-2 py-1 text-[11px] font-semibold text-white"
                  >
                    Open details
                  </button>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${report.latitude}&mlon=${report.longitude}#map=18/${report.latitude}/${report.longitude}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 rounded border border-ink-300 px-2 py-1 text-[11px] font-semibold text-ink-800"
                  >
                    <ExternalLink className="h-3 w-3" /> OSM
                  </a>
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {pin ? (
          <CircleMarker
            center={[pin.lat, pin.lng]}
            radius={10}
            pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#f97316', fillOpacity: 1 }}
          >
            <Tooltip permanent direction="top" offset={[0, -10]}>
              Selected location
            </Tooltip>
          </CircleMarker>
        ) : null}
      </MapContainer>
    </div>
  );
}

export function MapLegend({ className = '' }: { className?: string }) {
  const items = [
    { label: 'Critical', color: SEVERITY_COLORS.critical },
    { label: 'High', color: SEVERITY_COLORS.high },
    { label: 'Medium', color: SEVERITY_COLORS.medium },
    { label: 'Low', color: SEVERITY_COLORS.low },
    { label: 'Unrated', color: SEVERITY_COLORS.none },
    { label: 'Resolved', color: '#0ea5e9' },
  ];
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-600 dark:text-ink-300 ${className}`}>
      <span className="font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">Severity</span>
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border border-white" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
