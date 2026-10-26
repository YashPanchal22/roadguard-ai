import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

export const TOKEN_STORAGE_KEY = 'roadguard.token';

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  hints?: string[];
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  hints: string[];

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
    this.hints = payload.hints ?? [];
  }
}

const baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export const apiClient: AxiosInstance = axios.create({
  baseURL,
  timeout: 60_000,
  headers: { Accept: 'application/json' },
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: ApiErrorPayload }>) => {
    if (error.response?.data?.error) {
      const payload = error.response.data.error;
      throw new ApiError(error.response.status, payload);
    }
    if (error.code === 'ECONNABORTED') {
      throw new ApiError(0, {
        code: 'TIMEOUT',
        message: 'The request timed out. The server may still be processing the image.',
      });
    }
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message:
        error.message === 'Network Error'
          ? 'Cannot reach the RoadGuard API. Check that the backend is running.'
          : error.message,
    });
  },
);

/** Turn any thrown value into a readable message for the UI. */
export function describeError(error: unknown): { message: string; code?: string; hints: string[] } {
  if (error instanceof ApiError) {
    return { message: error.message, code: error.code, hints: error.hints };
  }
  if (error instanceof Error) return { message: error.message, hints: [] };
  return { message: 'Something went wrong.', hints: [] };
}
