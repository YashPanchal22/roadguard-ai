import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ReportDetailPanel } from '../components/ReportDetailPanel';
import { AuthProvider, MetaProvider, ThemeProvider, ToastProvider } from '../context/AppProviders';
import { reportApi } from '../services/endpoints';
import { TOKEN_STORAGE_KEY } from '../services/api';

const REPORT = {
  id: 'rep-1',
  reference: 'RG-261025-AAAA',
  description: 'Deep pothole near the bus stop',
  damage_category: 'pothole',
  ai_suggested_category: 'pothole',
  detection_confidence: 0.61,
  reviewed_severity: 'high',
  road_importance: 'arterial',
  priority_score: 63.4,
  latitude: 23.0225,
  longitude: 72.5714,
  location_source: 'manual',
  road_name: 'Ashram Road',
  ward: 'Navrangpura',
  status: 'under_review',
  is_verified: false,
  is_synthetic: false,
  duplicate_of_id: null,
  reporter_label: 'Resident',
  reported_at: new Date().toISOString(),
  resolved_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  detection_count: 1,
  thumbnail_url: null,
  resolution_age_days: 1.2,
  priority_breakdown: [
    { key: 'severity', label: 'Reviewed severity', available: true, normalised: 0.78, weight: 0.34, contribution: 26.5, detail: "Reviewer severity is 'high'." },
    { key: 'category', label: 'Damage category', available: true, normalised: 0.85, weight: 0.16, contribution: 13.6, detail: "Category 'pothole'." },
    { key: 'road_importance', label: 'Road importance', available: true, normalised: 0.8, weight: 0.14, contribution: 11.2, detail: 'Arterial road.' },
    { key: 'damage_size', label: 'Detected damage size', available: false, normalised: 0, weight: 0.12, contribution: 0, detail: 'No detection geometry available.' },
    { key: 'report_age', label: 'Age of unresolved report', available: true, normalised: 0.04, weight: 0.12, contribution: 0.5, detail: 'Unresolved for 1.2 days.' },
    { key: 'repeat_reports', label: 'Nearby verified reports', available: true, normalised: 0.25, weight: 0.12, contribution: 3.1, detail: '1 verified report within 250 m.' },
  ],
  images: [],
  detections: [
    {
      id: 'det-1',
      class_label: 'Pothole',
      class_id: 3,
      confidence: 0.61,
      bbox_x1: 10,
      bbox_y1: 20,
      bbox_x2: 120,
      bbox_y2: 140,
      area_ratio: 0.04,
      model_version: 'pothole-yolov8s-community-v1',
      is_synthetic: false,
    },
  ],
  repair_updates: [
    {
      id: 'upd-1',
      previous_status: 'submitted',
      new_status: 'under_review',
      notes: 'Photo reviewed',
      actor_label: 'Priya Shah',
      created_at: new Date().toISOString(),
    },
  ],
  audit_trail: [
    {
      id: 'aud-1',
      action: 'report.created',
      changes: null,
      actor_label: 'Resident',
      created_at: new Date().toISOString(),
      is_synthetic: false,
    },
  ],
};

function renderPanel() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <MetaProvider>
              <ReportDetailPanel reportId="rep-1" embedded />
            </MetaProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('ReportDetailPanel', () => {
  it('renders explainable priority factors and the detection table', async () => {
    vi.spyOn(reportApi, 'get').mockResolvedValue(REPORT as never);
    vi.spyOn(reportApi, 'duplicates').mockResolvedValue({
      report_id: 'rep-1',
      candidates: [],
      linked: [],
      method: 'proximity',
    } as never);

    renderPanel();

    expect(await screen.findByText('RG-261025-AAAA')).toBeInTheDocument();
    expect(screen.getAllByText('Reviewed severity').length).toBeGreaterThan(0);
    expect(screen.getByText('No detection geometry available.')).toBeInTheDocument();
    expect(screen.getAllByText('Pothole').length).toBeGreaterThan(0);
    expect(screen.getByText(/Photo reviewed/)).toBeInTheDocument();
  });

  it('prompts anonymous visitors to sign in instead of showing review controls', async () => {
    vi.spyOn(reportApi, 'get').mockResolvedValue(REPORT as never);
    vi.spyOn(reportApi, 'duplicates').mockResolvedValue({
      report_id: 'rep-1',
      candidates: [],
      linked: [],
      method: 'proximity',
    } as never);

    renderPanel();
    expect(await screen.findByText(/Reviewer access required/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Next status')).not.toBeInTheDocument();
  });

  it('lets a reviewer transition status and reports the result', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'reviewer-token');
    vi.spyOn(reportApi, 'get').mockResolvedValue(REPORT as never);
    vi.spyOn(reportApi, 'duplicates').mockResolvedValue({
      report_id: 'rep-1',
      candidates: [],
      linked: [],
      method: 'proximity',
    } as never);
    const changeSpy = vi.spyOn(reportApi, 'changeStatus').mockResolvedValue({
      ...REPORT,
      status: 'verified',
      is_verified: true,
    } as never);

    // AuthProvider verifies the token on mount; make that resolve to a reviewer.
    const authModule = await import('../services/endpoints');
    vi.spyOn(authModule.authApi, 'me').mockResolvedValue({
      id: 'u1',
      name: 'Priya Shah',
      email: 'reviewer@roadguard.demo',
      role: 'reviewer',
      created_at: new Date().toISOString(),
    } as never);

    renderPanel();

    const select = await screen.findByLabelText('Next status', {}, { timeout: 3000 });
    await userEvent.selectOptions(select, 'verified');
    await userEvent.click(screen.getByRole('button', { name: /apply transition/i }));

    await waitFor(() => expect(changeSpy).toHaveBeenCalledWith('rep-1', 'verified', undefined));
    expect(await screen.findByText(/Status updated/i)).toBeInTheDocument();
  });
});
