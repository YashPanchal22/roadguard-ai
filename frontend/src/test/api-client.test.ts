import { describe, expect, it } from 'vitest';
import { ApiError, describeError, apiClient, TOKEN_STORAGE_KEY } from '../services/api';

describe('API client error handling', () => {
  it('turns a structured backend error envelope into an ApiError', async () => {
    const interceptor = apiClient.interceptors.response as unknown as {
      handlers: { rejected: (error: unknown) => unknown }[];
    };
    const handler = interceptor.handlers[0].rejected;

    await expect(
      (async () =>
        handler({
          response: {
            status: 503,
            data: {
              error: {
                code: 'MODEL_UNAVAILABLE',
                message: 'Model weights not found',
                hints: ['Place weights in data/models'],
              },
            },
          },
          message: 'Request failed',
        }))(),
    ).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE', status: 503 });
  });

  it('describes network failures without leaking internals', () => {
    const described = describeError(new ApiError(0, { code: 'NETWORK_ERROR', message: 'Cannot reach the RoadGuard API.' }));
    expect(described.message).toContain('Cannot reach');
    expect(described.code).toBe('NETWORK_ERROR');
    expect(described.hints).toEqual([]);
  });

  it('attaches the stored bearer token to requests', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'token-abc');
    const requestInterceptor = apiClient.interceptors.request as unknown as {
      handlers: { fulfilled: (config: { headers: Record<string, unknown> }) => { headers: Record<string, unknown> } }[];
    };
    const result = requestInterceptor.handlers[0].fulfilled({
      headers: {},
    });
    expect(result.headers.Authorization).toBe('Bearer token-abc');
  });

  it('falls back to a readable message for unknown throwables', () => {
    expect(describeError('weird failure').message).toBe('Something went wrong.');
    expect(describeError(new Error('boom')).message).toBe('boom');
  });
});
