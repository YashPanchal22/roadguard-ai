/**
 * Smoke-render every screen with mocked API payloads.
 *
 * Purpose: catch runtime crashes (undefined access, bad hooks, unhandled
 * promise shapes) on pages that the focused tests do not cover.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, MetaProvider, ThemeProvider, ToastProvider } from '../context/AppProviders';
import { OverviewPage } from '../pages/OverviewPage';
import { DetectionPage } from '../pages/DetectionPage';
import { MapPage } from '../pages/MapPage';
import { ReportsPage } from '../pages/ReportsPage';
import { RepairsPage } from '../pages/RepairsPage';
import { AnalyticsPage } from '../pages/AnalyticsPage';
import { ModelPage } from '../pages/ModelPage';
import { ExportsPage } from '../pages/ExportsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { LoginPage } from '../pages/LoginPage';
import { analyticsApi, mapApi, metaApi, modelApi, reportApi, settingsApi } from '../services/endpoints';

vi.mock('../components/MapView', () => ({
  MapView: () => <div data-testid="map-stub" />,
  MapLegend: () => <div />,
  markerColor: () => '#f97316',
}));

const META = {
  statuses: [{ value: 'submitted', label: 'Submitted', description: '' }],
  categories: [{ value: 'pothole', label: 'Pothole' }],
  severities: [{ value: 'high', label: 'High' }],
  road_importance: [{ value: 'arterial', label: 'Arterial' }],
  allowed_transitions: { submitted: ['under_review'] },
  map_defaults: { lat: 23.0225, lng: 72.5714, zoom: 12 },
  priority_weights: { severity: 0.34, category: 0.16 },
  demo_region_label: 'Ahmedabad, Gujarat (demo region)',
  detection_available: true,
} as never;

const KPI = [
  { key: 'total_reports', label: 'Total Reports', value: 12, hint: null },
  { key: 'reports_this_month', label: 'Submitted This Month', value: 3, hint: null },
  { key: 'verified_reports', label: 'Verified Damage', value: 5, hint: null },
  { key: 'unresolved_reports', label: 'Unresolved', value: 7, hint: null },
  { key: 'under_repair', label: 'Under Repair', value: 2, hint: null },
  { key: 'resolved_reports', label: 'Resolved', value: 3, hint: null },
  { key: 'avg_resolution_days', label: 'Avg Resolution Time', value: 0, unit: 'days', hint: 'No resolved reports yet' },
  { key: 'high_priority_verified', label: 'High-Priority Verified', value: 1, hint: null },
];

const CHARTS = {
  charts: [
    {
      name: 'Reports by date',
      description: 'Daily',
      series: [
        { name: 'Submitted', data: [{ label: '2026-10-01', value: 2 }] },
        { name: 'Resolved', data: [{ label: '2026-10-01', value: 1 }] },
      ],
    },
    { name: 'Damage categories', description: 'x', series: [{ name: 'Reports', data: [{ label: 'Pothole', value: 4 }] }] },
    { name: 'Reports by status', description: 'x', series: [{ name: 'Reports', data: [{ label: 'Submitted', value: 4 }] }] },
    { name: 'Severity distribution', description: 'x', series: [{ name: 'Reports', data: [{ label: 'High', value: 2 }] }] },
    { name: 'Outstanding repairs by age', description: 'x', series: [{ name: 'Open reports', data: [{ label: '0-7 days', value: 2 }] }] },
    {
      name: 'Resolution trend',
      description: 'x',
      series: [
        { name: 'Submitted', data: [{ label: '2026-10', value: 3 }] },
        { name: 'Resolved', data: [{ label: '2026-10', value: 2 }] },
      ],
    },
    { name: 'AI confidence distribution', description: 'x', series: [{ name: 'Reports', data: [{ label: '40-60%', value: 1 }] }] },
    { name: 'Damage by region', description: 'x', series: [{ name: 'Reports', data: [{ label: 'Navrangpura', value: 5 }] }] },
  ],
  generated_at: new Date().toISOString(),
  record_count: 12,
} as never;

const REPORT = {
  id: 'rep-1',
  reference: 'RG-261025-AAAA',
  description: 'test',
  damage_category: 'pothole',
  ai_suggested_category: 'pothole',
  detection_confidence: 0.5,
  reviewed_severity: 'high',
  road_importance: 'arterial',
  priority_score: 51,
  latitude: 23.02,
  longitude: 72.57,
  location_source: 'manual',
  road_name: 'Ashram Road',
  ward: 'Navrangpura',
  status: 'verified',
  is_verified: true,
  is_synthetic: true,
  duplicate_of_id: null,
  reporter_label: null,
  reported_at: new Date().toISOString(),
  resolved_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  detection_count: 0,
  thumbnail_url: null,
};

function mockAll() {
  vi.spyOn(metaApi, 'options').mockResolvedValue(META);
  vi.spyOn(metaApi, 'health').mockResolvedValue({
    status: 'ok',
    database: { ok: true, error: null },
    detector: { available: true, model_version: 'v1', weights_present: true },
    reports: { total: 12, synthetic: 10, real: 2 },
    environment: 'test',
  } as never);
  vi.spyOn(analyticsApi, 'overview').mockResolvedValue({
    kpis: KPI,
    generated_at: new Date().toISOString(),
    filters_applied: {},
    record_count: 12,
    synthetic_included: true,
  } as never);
  vi.spyOn(analyticsApi, 'charts').mockResolvedValue(CHARTS);
  vi.spyOn(analyticsApi, 'priorityQueue').mockResolvedValue({
    items: [
      {
        reference: 'RG-261025-AAAA',
        id: 'rep-1',
        priority_score: 61,
        reviewed_severity: 'high',
        damage_category: 'pothole',
        status: 'verified',
        road_name: 'Ashram Road',
        age_days: 4,
        factors: [],
      },
    ],
    weights: { severity: 0.34 },
    explanation: 'weighted sum',
  } as never);
  vi.spyOn(analyticsApi, 'regions').mockResolvedValue([
    { ward: 'Navrangpura', reports: 5, unresolved: 2, avg_priority: 44.2 },
  ] as never);
  vi.spyOn(reportApi, 'list').mockResolvedValue({
    items: [REPORT],
    meta: { page: 1, page_size: 25, total: 1, total_pages: 1, sort: 'reported_at', order: 'desc' },
  } as never);
  vi.spyOn(reportApi, 'get').mockResolvedValue({
    ...REPORT,
    priority_breakdown: [],
    images: [],
    detections: [],
    repair_updates: [],
    audit_trail: [],
    resolution_age_days: 1,
  } as never);
  vi.spyOn(reportApi, 'duplicates').mockResolvedValue({ candidates: [], linked: [], method: '' } as never);
  vi.spyOn(mapApi, 'reports').mockResolvedValue([REPORT] as never);
  vi.spyOn(modelApi, 'info').mockResolvedValue({
    available: true,
    model_name: 'YOLOv8s',
    model_version: 'v1',
    model_path: 'pothole_yolov8.pt',
    weights_present: true,
    weights_size_mb: 64,
    class_labels: { 3: 'Pothole', 0: 'Longitudinal Crack' },
    class_count: 2,
    conf_threshold: 0.35,
    iou_threshold: 0.45,
    max_detections: 100,
    device: 'cpu',
    load_time_ms: 1900,
    error: null,
    class_match_warning: null,
    hints: [],
    training_config: { architecture: 'YOLOv8s' },
    dataset_note: 'Community weights',
  } as never);
  vi.spyOn(modelApi, 'evaluation').mockResolvedValue({
    available: false,
    evaluation: null,
    message: 'Evaluation not yet available',
    instructions: ['Run the evaluation script'],
    restrictions: ['Never fabricate metrics'],
  } as never);
  vi.spyOn(settingsApi, 'priority').mockResolvedValue({
    weights: { severity: 0.34, category: 0.16 },
    age_full_days: 30,
    repeat_radius_m: 250,
    repeat_window_days: 60,
    duplicate_radius_m: 120,
    duplicate_window_days: 14,
  } as never);
}

function renderWithProviders(ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <MetaProvider>{ui}</MetaProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('page smoke renders', () => {
  beforeEach(() => {
    localStorage.clear();
    mockAll();
  });

  const cases: [string, React.ReactNode, RegExp][] = [
    ['overview', <OverviewPage />, /Road damage control room/i],
    ['detection', <DetectionPage />, /AI road damage detection/i],
    ['map', <MapPage />, /Live damage map/i],
    ['reports', <ReportsPage />, /All damage reports/i],
    ['repairs', <RepairsPage />, /Repair management/i],
    ['analytics', <AnalyticsPage />, /Damage analytics/i],
    ['model', <ModelPage />, /Model performance/i],
    ['exports', <ExportsPage />, /Reports & exports/i],
    ['settings', <SettingsPage />, /Settings/i],
    ['login', <LoginPage />, /RoadGuard AI/],
  ];

  it.each(cases)('%s page renders without crashing', async (_name, element, matcher) => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
    renderWithProviders(element);
    await waitFor(() => expect(screen.getAllByText(matcher).length).toBeGreaterThan(0));
    spy.mockRestore();
    const reactErrors = errors.filter((entry) => String(entry).includes('Warning:') === false);
    expect(reactErrors).toHaveLength(0);
  });
});

describe('reports page search behaviour', () => {
  beforeEach(() => {
    localStorage.clear();
    mockAll();
  });

  it('keeps typed characters visible and debounces them into the API query', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const listSpy = vi.spyOn(reportApi, 'list');
    renderWithProviders(<ReportsPage />);

    const input = await screen.findByLabelText('Search reports');
    await userEvent.type(input, 'RG-261');

    // The controlled input must reflect what the user typed (regression guard).
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('RG-261'));

    // After the debounce window the query reaches the API.
    await waitFor(
      () => {
        const lastCall = listSpy.mock.calls.at(-1)?.[0];
        expect(lastCall?.q).toBe('RG-261');
      },
      { timeout: 3000 },
    );
  });
});
