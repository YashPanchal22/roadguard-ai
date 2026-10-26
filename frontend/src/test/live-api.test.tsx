/**
 * Live integration checks against a running FastAPI backend.
 *
 * These render the real page components (with Leaflet mocked, because jsdom has
 * no layout engine) and talk to the real API through axios/XHR.
 *
 * Run with the backend on :8000:
 *   RUN_LIVE_TESTS=1 npx vitest run src/test/live-api.test.tsx
 *
 * Skipped by default so `npm test` works without a server.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OverviewPage } from '../pages/OverviewPage';
import { ReportsPage } from '../pages/ReportsPage';
import { ModelPage } from '../pages/ModelPage';
import { AnalyticsPage } from '../pages/AnalyticsPage';
import { ReportDamagePage } from '../pages/ReportDamagePage';
import { AuthProvider, MetaProvider, ThemeProvider, ToastProvider } from '../context/AppProviders';

vi.mock('../components/MapView', () => ({
  MapView: ({ onPick }: { onPick?: (lat: number, lng: number) => void }) => (
    <button type="button" onClick={() => onPick?.(23.0271, 72.5801)}>
      simulated-map
    </button>
  ),
  MapLegend: () => null,
  markerColor: () => '#f97316',
}));

const live = process.env.RUN_LIVE_TESTS === '1';
const describeLive = live ? describe : describe.skip;

function wrap(ui: React.ReactNode) {
  return (
    <MemoryRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <MetaProvider>{ui}</MetaProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describeLive('live backend integration', () => {
  it(
    'overview renders KPIs computed by the API',
    async () => {
      render(wrap(<OverviewPage />));
      await waitFor(
        () => {
          const cards = document.querySelectorAll('.card p.text-2xl');
          expect(cards.length).toBeGreaterThanOrEqual(8);
        },
        { timeout: 20000 },
      );
      const values = Array.from(document.querySelectorAll('.card p.text-2xl')).map(
        (node) => node.textContent ?? '',
      );
      // "Total Reports" must be a real integer coming from the database.
      const total = Number(values[0].replace(/[^\d.]/g, ''));
      expect(Number.isFinite(total)).toBe(true);
      expect(total).toBeGreaterThan(0);
      expect(screen.getByText('Total Reports')).toBeInTheDocument();
    },
    30000,
  );

  it(
    'reports table lists persisted reports with references',
    async () => {
      render(wrap(<ReportsPage />));
      await waitFor(() => expect(document.querySelectorAll('table tbody tr').length).toBeGreaterThan(0), {
        timeout: 20000,
      });
      const firstRow = document.querySelector('table tbody tr') as HTMLElement;
      expect(within(firstRow).getByText(/RG-/)).toBeInTheDocument();
    },
    30000,
  );

  it(
    'analytics charts receive real aggregates',
    async () => {
      render(wrap(<AnalyticsPage />));
      // Recharts needs layout dimensions that jsdom cannot provide, so the
      // meaningful live assertion is that the API delivered chart bundles and
      // the frames rendered their real titles/descriptions.
      // The "Generated <timestamp>" footer only renders once the API answered.
      await waitFor(() => expect(document.body.textContent).toMatch(/Generated \d/), { timeout: 20000 });
      expect(screen.getAllByText('Reports by date').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Damage categories').length).toBeGreaterThan(0);
      // Regional table is plain HTML, so it proves live aggregates reached the DOM.
      await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0), { timeout: 20000 });
      const scopeText = screen.getByText(/records in scope/).textContent ?? '';
      expect(scopeText).toMatch(/records in scope/);
      expect(Number(scopeText.replace(/[^\d]/g, ''))).toBeGreaterThan(0);
    },
    30000,
  );

  it(
    'model page reflects the loaded weights and an honest evaluation state',
    async () => {
      render(wrap(<ModelPage />));
      await waitFor(() => expect(screen.getByText(/Loaded and ready/)).toBeInTheDocument(), { timeout: 20000 });
      expect(screen.getAllByText(/Pothole/).length).toBeGreaterThan(0);
      expect(
        screen.getByText(/Evaluation not yet available/i) || screen.getByText(/Local evaluation/i),
      ).toBeInTheDocument();
    },
    30000,
  );

  it(
    'end-to-end: pick a location, submit, and receive a persisted reference id',
    async () => {
      render(wrap(<ReportDamagePage />));
      await userEvent.click(await screen.findByRole('button', { name: 'simulated-map' }));
      await userEvent.type(screen.getByLabelText(/Road name or landmark/i), 'Live integration test road');
      await userEvent.click(screen.getByRole('button', { name: /Submit report/i }));

      await waitFor(() => expect(screen.getByText(/Report submitted successfully/i)).toBeInTheDocument(), {
        timeout: 20000,
      });
      const reference = document.querySelector('span.font-mono')?.textContent ?? '';
      expect(reference).toMatch(/^RG-\d{6}-[0-9A-F]{4}$/);
    },
    40000,
  );
});
