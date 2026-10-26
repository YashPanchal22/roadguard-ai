import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ReportDamagePage } from '../pages/ReportDamagePage';
import { AuthProvider, MetaProvider, ThemeProvider, ToastProvider } from '../context/AppProviders';
import { detectionApi, metaApi, reportApi } from '../services/endpoints';
import { ApiError } from '../services/api';

const META = {
  statuses: [],
  categories: [
    { value: 'pothole', label: 'Pothole' },
    { value: 'broken_surface', label: 'Broken surface' },
  ],
  severities: [
    { value: 'low', label: 'Low' },
    { value: 'high', label: 'High' },
  ],
  road_importance: [],
  allowed_transitions: {},
  map_defaults: { lat: 23.0225, lng: 72.5714, zoom: 12 },
  priority_weights: { severity: 0.34 },
  demo_region_label: 'Ahmedabad',
  detection_available: true,
} as never;

vi.mock('../components/MapView', () => ({
  MapView: ({ onPick }: { onPick?: (lat: number, lng: number) => void }) => (
    <button type="button" onClick={() => onPick?.(23.03, 72.58)}>
      simulated-map
    </button>
  ),
  MapLegend: () => null,
  markerColor: () => '#000',
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <MetaProvider>
              <ReportDamagePage />
            </MetaProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('Report damage form', () => {
  beforeEach(() => {
    vi.spyOn(metaApi, 'options').mockResolvedValue(META);
  });

  it('blocks submission without coordinates and shows a validation message', async () => {
    const createSpy = vi.spyOn(reportApi, 'create');
    renderPage();
    await screen.findByText(/set a location/i, { exact: false }, { timeout: 3000 }).catch(() => null);

    await userEvent.click(await screen.findByRole('button', { name: /submit report/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Set a location with the GPS button/i).length).toBeGreaterThan(0);
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('submits with a map-picked location and shows the reference id', async () => {
    const createSpy = vi.spyOn(reportApi, 'create').mockResolvedValue({
      id: 'rep-1',
      reference: 'RG-261025-ABCD',
      status: 'submitted',
      damage_category: 'pothole',
      priority_score: 42.5,
    } as never);

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'simulated-map' }));
    await userEvent.click(await screen.findByRole('button', { name: /submit report/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalled());
    const payload = createSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.latitude).toBeCloseTo(23.03);
    expect(payload.longitude).toBeCloseTo(72.58);
    expect(payload.location_source).toBe('manual');

    expect(await screen.findByText('RG-261025-ABCD')).toBeInTheDocument();
  });

  it('surfaces detection errors but still allows submission', async () => {
    vi.spyOn(detectionApi, 'analyze').mockRejectedValue(
      new ApiError(503, {
        code: 'MODEL_UNAVAILABLE',
        message: 'Detection model is not available.',
        hints: ['Place weights at data/models/pothole_yolov8.pt'],
      }),
    );

    renderPage();
    const input = screen.getByLabelText('Road damage photograph');
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'road.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText(/Detection model is not available/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/still submit the report without AI results/i)).toBeInTheDocument();
  });

  it('rejects unsupported file types locally before calling the API', async () => {
    const analyzeSpy = vi.spyOn(detectionApi, 'analyze');
    renderPage();
    const input = screen.getByLabelText('Road damage photograph');
    const file = new File(['plain text'], 'notes.txt', { type: 'text/plain' });
    // user-event honours the accept attribute, so fire the change event directly
    // to exercise the component's own type guard.
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/Please choose a JPG, JPEG, PNG or WEBP/i)).toBeInTheDocument();
    });
    expect(analyzeSpy).not.toHaveBeenCalled();
  });
});
