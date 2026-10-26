import type {
  AnalyzeResponse,
  AnalyticsResponse,
  AuthResponse,
  DuplicateResponse,
  EvaluationResponse,
  HealthResponse,
  MapConfig,
  MetaOptions,
  ModelInfo,
  OverviewResponse,
  Paginated,
  PriorityQueueItem,
  PrioritySettings,
  ReportDetail,
  ReportFilters,
  ReportSummary,
  ReportStatus,
  Severity,
  User,
} from '../types';
import { apiClient } from './api';

/** Build query params, dropping empty values and expanding arrays. */
function params(filters: Record<string, unknown>): URLSearchParams {
  const search = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((item) => search.append(key, String(item)));
    } else {
      search.append(key, String(value));
    }
  });
  return search;
}

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<AuthResponse>('/auth/login', { email, password }).then((r) => r.data),
  register: (name: string, email: string, password: string) =>
    apiClient.post<AuthResponse>('/auth/register', { name, email, password }).then((r) => r.data),
  me: () => apiClient.get<User>('/auth/me').then((r) => r.data),
};

export const detectionApi = {
  analyze: (file: File, options?: { conf?: number; iou?: number }) => {
    const form = new FormData();
    form.append('file', file);
    if (options?.conf !== undefined) form.append('conf', String(options.conf));
    if (options?.iou !== undefined) form.append('iou', String(options.iou));
    return apiClient
      .post<AnalyzeResponse>('/detection/analyze', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      })
      .then((r) => r.data);
  },
};

export const reportApi = {
  list: (filters: ReportFilters) =>
    apiClient
      .get<Paginated<ReportSummary>>(`/reports?${params(filters as Record<string, unknown>)}`)
      .then((r) => r.data),
  get: (id: string) => apiClient.get<ReportDetail>(`/reports/${id}`).then((r) => r.data),
  create: (payload: Record<string, unknown>) =>
    apiClient.post<ReportDetail>('/reports', payload).then((r) => r.data),
  update: (id: string, payload: Record<string, unknown>) =>
    apiClient.patch<ReportDetail>(`/reports/${id}`, payload).then((r) => r.data),
  changeStatus: (id: string, newStatus: ReportStatus, notes?: string) =>
    apiClient
      .post<ReportDetail>(`/reports/${id}/status`, { new_status: newStatus, notes })
      .then((r) => r.data),
  history: (id: string) => apiClient.get(`/reports/${id}/history`).then((r) => r.data),
  duplicates: (id: string) =>
    apiClient.get<DuplicateResponse>(`/reports/${id}/duplicates`).then((r) => r.data),
  linkDuplicate: (id: string, duplicateReportId: string, reason?: string) =>
    apiClient
      .post(`/reports/${id}/duplicates/link`, { duplicate_report_id: duplicateReportId, reason })
      .then((r) => r.data),
  priority: (id: string) => apiClient.get(`/reports/${id}/priority`).then((r) => r.data),
  remove: (id: string) => apiClient.delete(`/reports/${id}`).then((r) => r.data),
};

export const mapApi = {
  config: () => apiClient.get<MapConfig>('/map/config').then((r) => r.data),
  reports: (bounds: { south: number; west: number; north: number; east: number }, filters: {
    status?: ReportStatus[];
    category?: string[];
    severity?: Severity[];
    include_synthetic?: boolean;
    exclude_duplicates?: boolean;
  }) =>
    apiClient
      .get<ReportSummary[]>(
        `/map/reports?${params({ ...bounds, ...(filters as Record<string, unknown>) })}`,
      )
      .then((r) => r.data),
};

export const analyticsApi = {
  overview: (filters: Record<string, unknown> = {}) =>
    apiClient.get<OverviewResponse>(`/analytics/overview?${params(filters)}`).then((r) => r.data),
  charts: (filters: Record<string, unknown> = {}) =>
    apiClient.get<AnalyticsResponse>(`/analytics/charts?${params(filters)}`).then((r) => r.data),
  priorityQueue: (limit = 10, includeSynthetic = true) =>
    apiClient
      .get<{ items: PriorityQueueItem[]; weights: Record<string, number>; explanation: string }>(
        `/analytics/priority-queue?limit=${limit}&include_synthetic=${includeSynthetic}`,
      )
      .then((r) => r.data),
  regions: () => apiClient.get('/analytics/regions').then((r) => r.data),
};

export const modelApi = {
  info: () => apiClient.get<ModelInfo>('/model/info').then((r) => r.data),
  evaluation: () => apiClient.get<EvaluationResponse>('/model/evaluation').then((r) => r.data),
  reload: () => apiClient.post<ModelInfo>('/model/reload').then((r) => r.data),
};

export const settingsApi = {
  priority: () => apiClient.get<PrioritySettings>('/settings/priority').then((r) => r.data),
  updatePriority: (payload: Record<string, unknown>) =>
    apiClient.put<PrioritySettings>('/settings/priority', payload).then((r) => r.data),
};

export const metaApi = {
  options: () => apiClient.get<MetaOptions>('/meta/options').then((r) => r.data),
  health: () => apiClient.get<HealthResponse>('/health').then((r) => r.data),
};

export function exportUrl(kind: 'csv' | 'json' | 'pdf', filters: ReportFilters = {}): string {
  const clean: Record<string, unknown> = {
    q: filters.q,
    status: filters.status,
    category: filters.category,
    severity: filters.severity,
    date_from: filters.date_from,
    date_to: filters.date_to,
    include_synthetic: filters.include_synthetic,
    only_synthetic: filters.only_synthetic,
  };
  const path =
    kind === 'csv' ? '/exports/reports.csv' : kind === 'json' ? '/exports/reports.json' : '/exports/summary.pdf';
  const query = params(clean).toString();
  return `${apiClient.defaults.baseURL}${path}${query ? `?${query}` : ''}`;
}
