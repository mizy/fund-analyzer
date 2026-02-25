import type { NavRecord, BenchmarkRecord } from "../types/fund.js";
import { fetchWithRetry } from "./httpClient.js";
import { extractJsonVar, type NavPoint } from "./parseUtils.js";

/** Fetch full historical NAV series from pingzhongdata */
export async function fetchHistoryNav(code: string): Promise<NavRecord[]> {
  const url = `http://fund.eastmoney.com/pingzhongdata/${code}.js`;
  const { data: js } = await fetchWithRetry<string>(url);

  const rawNavData = extractJsonVar<NavPoint[]>(js, "Data_netWorthTrend");
  if (!rawNavData || rawNavData.length === 0) return [];

  const accNavData = extractJsonVar<number[][]>(js, "Data_ACWorthTrend");
  const accNavMap = new Map<number, number>();
  if (accNavData) {
    for (const [ts, nav] of accNavData) {
      accNavMap.set(ts, nav);
    }
  }

  const records: NavRecord[] = [];
  for (let i = 0; i < rawNavData.length; i++) {
    const p = rawNavData[i];
    const date = new Date(p.x).toISOString().slice(0, 10);
    const accNav = accNavMap.get(p.x) ?? p.y;
    const prevAccNav = i > 0 ? (accNavMap.get(rawNavData[i - 1].x) ?? rawNavData[i - 1].y) : accNav;
    const dailyReturn = i > 0 && prevAccNav > 0
      ? ((accNav - prevAccNav) / prevAccNav) * 100
      : 0;
    records.push({
      date,
      nav: p.y,
      accNav,
      dailyReturn: Math.round(dailyReturn * 10000) / 10000,
    });
  }

  return records;
}

// --- Benchmark index data ---

const BENCHMARK_SECID: Record<string, string> = {
  '000300': '1.000300', // 沪深300
  '000905': '1.000905', // 中证500
  '000012': '1.000012', // 国债指数
  '399006': '0.399006', // 创业板指
};

/** Fetch benchmark index daily K-line data */
export async function fetchBenchmarkData(
  indexCode: string,
  startDate?: string,
  endDate?: string,
): Promise<BenchmarkRecord[]> {
  const secid = BENCHMARK_SECID[indexCode] ?? `1.${indexCode}`;
  const beg = startDate?.replace(/-/g, '') ?? '20200101';
  const end = endDate?.replace(/-/g, '') ?? '20991231';

  const url = `http://push2his.eastmoney.com/api/qt/stock/kline/get`;
  const { data } = await fetchWithRetry(url, {
    params: {
      secid,
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57',
      klt: 101,
      fqt: 0,
      beg,
      end,
      lmt: 5000,
    },
  });

  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  const klines: string[] = parsed?.data?.klines ?? [];
  const records: BenchmarkRecord[] = [];

  for (let i = 0; i < klines.length; i++) {
    const parts = klines[i].split(',');
    const close = parseFloat(parts[2]);
    const dailyReturn = i > 0
      ? ((close - records[i - 1].close) / records[i - 1].close) * 100
      : 0;
    records.push({
      date: parts[0],
      close,
      dailyReturn: Math.round(dailyReturn * 10000) / 10000,
    });
  }

  return records;
}
