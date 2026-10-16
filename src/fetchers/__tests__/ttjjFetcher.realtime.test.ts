import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }));

vi.mock('../httpClient.js', () => ({ fetchWithRetry: mockFetchWithRetry }));

import { fetchFundRealtimeValuation } from '../ttjjFetcher.js';

/**
 * 三种状态：
 * - 可用态：fundgz 返回合法 JSONP → source=fundgz，changePercent 为当日盘中估算
 * - 回落态：fundgz 返回 404 HTML → 回落到 lsjz 上一交易日确认净值，source=nav-fallback
 * - 异常态：两个源都不可用 → 抛错（由调用方决定是否降级为 null）
 */

const FUNDGZ_URL = 'https://fundgz.1234567.com.cn/js/020602.js';
const LSJZ_URL = 'https://api.fund.eastmoney.com/f10/lsjz';

/** 模拟东财真实返回的 404 HTML（HTTP 200，内含 CSS 花括号，会让 JSON 解析失败） */
const NOT_FOUND_HTML = `<!doctype html><html><head><style>body { margin: 0; }</style>
<title>页面未找到 - 东方财富网</title></head><body>.errbox { width: 546px; }</body></html>`;

const LSJZ_OK = 'jQuery({"Data":{"LSJZList":[{"FSRQ":"2026-10-15","DWJZ":"1.0992","LJJZ":"1.1982","JZZZL":"-1.19"}]},"ErrCode":0})';

describe('fetchFundRealtimeValuation', () => {
  beforeEach(() => {
    mockFetchWithRetry.mockReset();
  });

  it('可用态：fundgz 命中时标注 source=fundgz / isRealtime=true', async () => {
    mockFetchWithRetry.mockImplementation((target: string) => {
      if (target.startsWith(FUNDGZ_URL)) {
        return Promise.resolve({
          data: 'jsonpgz({"fundcode":"020602","jzrq":"2026-10-15","dwjz":"1.0992","gsz":"1.1010","gszzl":"0.16","gztime":"2026-10-16 13:30"});',
        });
      }
      return Promise.reject(new Error(`unexpected url: ${target}`));
    });

    const rt = await fetchFundRealtimeValuation('020602');

    expect(rt.source).toBe('fundgz');
    expect(rt.isRealtime).toBe(true);
    expect(rt.estimatedNav).toBeCloseTo(1.101, 4);
    expect(rt.changePercent).toBeCloseTo(0.16, 4);
    expect(rt.navDate).toBe('2026-10-15');
    expect(rt.updateTime).toBe('2026-10-16 13:30');
  });

  it('回落态：fundgz 返回 404 HTML 时回落到上一交易日确认净值并显式标注', async () => {
    mockFetchWithRetry.mockImplementation((target: string) => {
      if (target.startsWith(FUNDGZ_URL)) return Promise.resolve({ data: NOT_FOUND_HTML });
      if (target.startsWith(LSJZ_URL)) return Promise.resolve({ data: LSJZ_OK });
      return Promise.reject(new Error(`unexpected url: ${target}`));
    });

    const rt = await fetchFundRealtimeValuation('020602');

    expect(rt.source).toBe('nav-fallback');
    expect(rt.isRealtime).toBe(false);
    expect(rt.estimatedNav).toBe(0); // 回落态无盘中估算
    expect(rt.changePercent).toBeCloseTo(-1.19, 4); // 上一交易日已确认涨跌幅
    expect(rt.navDate).toBe('2026-10-15');
    expect(rt.updateTime).toBe('2026-10-15 15:00');
  });

  it('回落态：fundgz 网络异常时同样回落', async () => {
    mockFetchWithRetry.mockImplementation((target: string) => {
      if (target.startsWith(FUNDGZ_URL)) return Promise.reject(new Error('ECONNRESET'));
      if (target.startsWith(LSJZ_URL)) return Promise.resolve({ data: LSJZ_OK });
      return Promise.reject(new Error(`unexpected url: ${target}`));
    });

    const rt = await fetchFundRealtimeValuation('020602');

    expect(rt.source).toBe('nav-fallback');
    expect(rt.isRealtime).toBe(false);
  });

  it('异常态：两个源都不可用时抛错', async () => {
    mockFetchWithRetry.mockImplementation((target: string) => {
      if (target.startsWith(FUNDGZ_URL)) return Promise.reject(new Error('ECONNRESET'));
      if (target.startsWith(LSJZ_URL)) return Promise.resolve({ data: 'not-a-jsonp-payload' });
      return Promise.reject(new Error(`unexpected url: ${target}`));
    });

    await expect(fetchFundRealtimeValuation('020602')).rejects.toThrow();
  });

  it('回落态：lsjz 返回空列表时抛错（不静默产出假数据）', async () => {
    mockFetchWithRetry.mockImplementation((target: string) => {
      if (target.startsWith(FUNDGZ_URL)) return Promise.resolve({ data: NOT_FOUND_HTML });
      if (target.startsWith(LSJZ_URL)) return Promise.resolve({ data: 'jQuery({"Data":{"LSJZList":[]},"ErrCode":0})' });
      return Promise.reject(new Error(`unexpected url: ${target}`));
    });

    await expect(fetchFundRealtimeValuation('020602')).rejects.toThrow(/empty data/);
  });
});
