import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from '../components/FilterBar';
import { MetaProvider, ThemeProvider, ToastProvider } from '../context/AppProviders';
import { metaApi } from '../services/endpoints';
import type { ReportFilters } from '../types';

const META = {
  statuses: [
    { value: 'submitted', label: 'Submitted', description: '' },
    { value: 'verified', label: 'Verified', description: '' },
    { value: 'resolved', label: 'Resolved', description: '' },
  ],
  categories: [
    { value: 'pothole', label: 'Pothole' },
    { value: 'alligator_crack', label: 'Alligator crack' },
  ],
  severities: [
    { value: 'low', label: 'Low' },
    { value: 'critical', label: 'Critical' },
  ],
  road_importance: [{ value: 'arterial', label: 'Arterial' }],
  allowed_transitions: {},
  map_defaults: { lat: 23.0225, lng: 72.5714, zoom: 12 },
  priority_weights: {},
  demo_region_label: 'Ahmedabad, Gujarat (demo region)',
  detection_available: true,
} as never;

function wrap(ui: React.ReactNode) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <MetaProvider>{ui}</MetaProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

describe('FilterBar', () => {
  it('emits status toggles and clearing requests', async () => {
    vi.spyOn(metaApi, 'options').mockResolvedValue(META);
    const onChange = vi.fn();
    const onReset = vi.fn();
    const filters: ReportFilters = { status: [], category: [], severity: [], include_synthetic: true };

    render(wrap(<FilterBar filters={filters} onChange={onChange} onReset={onReset} activeCount={1} />));

    const submitted = await screen.findByRole('button', { name: 'Submitted' });
    await userEvent.click(submitted);
    expect(onChange).toHaveBeenCalledWith({ status: ['submitted'] });

    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onReset).toHaveBeenCalled();
  });

  it('reflects active statuses through aria-pressed and passes search input', async () => {
    vi.spyOn(metaApi, 'options').mockResolvedValue(META);
    const onChange = vi.fn();
    render(
      wrap(
        <FilterBar
          filters={{ status: ['verified'], category: [], severity: [], include_synthetic: true }}
          onChange={onChange}
          onReset={vi.fn()}
          activeCount={1}
        />,
      ),
    );

    const verified = await screen.findByRole('button', { name: 'Verified' });
    expect(verified).toHaveAttribute('aria-pressed', 'true');

    await userEvent.type(screen.getByLabelText('Search reports'), 'pothole');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ q: 'p' }));
  });

  it('sends a demo-data toggle', async () => {
    vi.spyOn(metaApi, 'options').mockResolvedValue(META);
    const onChange = vi.fn();
    render(
      wrap(
        <FilterBar
          filters={{ status: [], category: [], severity: [], include_synthetic: true }}
          onChange={onChange}
          onReset={vi.fn()}
          activeCount={0}
        />,
      ),
    );
    await userEvent.click(await screen.findByLabelText(/Include demo records/i));
    expect(onChange).toHaveBeenCalledWith({ include_synthetic: false });
  });
});
