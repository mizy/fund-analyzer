import { describe, it, expect, vi, afterEach } from 'vitest';
import axios from 'axios';
import { fetchWithRetry } from '../httpClient.js';

vi.mock('axios');
const mockedGet = vi.fn();
(axios as any).get = mockedGet;

// httpClient has module-level rate limiting state, tests need real timers
// but we can make them fast since MIN_INTERVAL_MS is only 300ms

describe('fetchWithRetry', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns data on first successful attempt', async () => {
    mockedGet.mockResolvedValueOnce({ data: 'hello', status: 200 } as any);

    const result = await fetchWithRetry('http://example.com');
    expect(result.data).toBe('hello');
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('merges custom headers with default headers', async () => {
    mockedGet.mockResolvedValueOnce({ data: 'ok', status: 200 } as any);

    await fetchWithRetry('http://example.com', {
      headers: { 'X-Custom': 'test' },
    });

    const callConfig = mockedGet.mock.calls[0][1]!;
    expect(callConfig.headers).toHaveProperty('X-Custom', 'test');
    expect(callConfig.headers).toHaveProperty('User-Agent');
    expect(callConfig.headers).toHaveProperty('Referer');
  });

  it('uses text responseType by default', async () => {
    mockedGet.mockResolvedValueOnce({ data: 'ok', status: 200 } as any);

    await fetchWithRetry('http://example.com');

    const callConfig = mockedGet.mock.calls[0][1]!;
    expect(callConfig.responseType).toBe('text');
  });

  it('sets timeout in config', async () => {
    mockedGet.mockResolvedValueOnce({ data: 'ok', status: 200 } as any);

    await fetchWithRetry('http://example.com');

    const callConfig = mockedGet.mock.calls[0][1]!;
    expect(callConfig.timeout).toBe(10_000);
  });
});
