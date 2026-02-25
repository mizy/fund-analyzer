/** @entry fetcher - 天天基金数据抓取 */
import type { FundData, FundHoldings, HoldingStock, FundListItem } from "../types/fund.js";
import { fetchWithRetry } from "./httpClient.js";
import { extractVar, extractJsonVar, toNavArray, type NavPoint } from "./parseUtils.js";
import { calcMultiPeriodRiskMetrics } from "../analyzers/calcRiskMetrics.js";
import { fetchFundDetail, fetchReturnYear3, fetchMorningstarRating, estimateRatingFromRank } from "./fetchFundDetail.js";

// --- Internal helpers for pingzhongdata ---

/** Extract manager max tenure years from Data_currentFundManager */
function extractManagerYears(js: string): number {
  type Manager = { workTime: string };
  const managers = extractJsonVar<Manager[]>(js, "Data_currentFundManager");
  if (!managers || managers.length === 0) return 0;
  let maxYears = 0;
  for (const mgr of managers) {
    const m = mgr.workTime?.match(/(\d+)年/);
    const days = mgr.workTime?.match(/(\d+)天/);
    if (m) {
      const years = parseInt(m[1]) + (days ? parseInt(days[1]) / 365 : 0);
      if (years > maxYears) maxYears = years;
    }
  }
  return Math.round(maxYears * 10) / 10;
}

/** Extract category rank percentile from Data_rateInSimilarType */
function extractCategoryRankPercent(js: string): number {
  type RankPoint = { x: number; y: number; sc: string };
  const data = extractJsonVar<RankPoint[]>(js, "Data_rateInSimilarType");
  if (!data || data.length === 0) return 0;
  const latest = data[data.length - 1];
  const total = parseInt(latest.sc) || 0;
  if (total === 0) return 0;
  return Math.round((latest.y / total) * 10000) / 100;
}

/** Fetch core data from pingzhongdata JS */
async function fetchPingzhongData(code: string) {
  const url = `http://fund.eastmoney.com/pingzhongdata/${code}.js`;
  const { data: js } = await fetchWithRetry<string>(url);

  const name = extractVar(js, "fS_name") ?? "";
  const fundCode = extractVar(js, "fS_code") ?? code;
  const returnYear1 = parseFloat(extractVar(js, "syl_1n") ?? "0") || 0;

  // Risk metrics: use accumulated NAV (includes reinvested dividends)
  const rawNavData = extractJsonVar<NavPoint[]>(js, "Data_netWorthTrend");
  const accNavData = extractJsonVar<number[][]>(js, "Data_ACWorthTrend");
  const navDataForRisk = accNavData && accNavData.length > 0 ? accNavData : toNavArray(rawNavData);
  const riskByPeriod = calcMultiPeriodRiskMetrics(navDataForRisk, returnYear1);
  const { maxDrawdown, volatility, sharpeRatio, sortinoRatio } = riskByPeriod.all;

  const managerYears = extractManagerYears(js);
  const categoryRankPercent = extractCategoryRankPercent(js);

  return {
    name, code: fundCode, returnYear1,
    sharpeRatio, maxDrawdown, volatility, sortinoRatio,
    riskByPeriod, managerYears, categoryRankPercent,
  };
}

/** Fetch complete fund data (assembles pingzhong + detail + rating) */
export async function fetchFundData(code: string): Promise<FundData> {
  const [pingzhong, detail, returnYear3, morningstarRating] = await Promise.all([
    fetchPingzhongData(code),
    fetchFundDetail(code).catch(() => ({
      type: "", establishDate: "", fundSize: 0, totalFeeRate: 0,
    })),
    fetchReturnYear3(code).catch(() => 0),
    fetchMorningstarRating(code),
  ]);

  const rating = morningstarRating > 0
    ? morningstarRating
    : estimateRatingFromRank(pingzhong.categoryRankPercent);

  return {
    basic: {
      code: pingzhong.code,
      name: pingzhong.name,
      type: detail.type,
      establishDate: detail.establishDate,
    },
    performance: {
      returnYear1: pingzhong.returnYear1,
      returnYear3,
      sharpeRatio: pingzhong.sharpeRatio,
      maxDrawdown: pingzhong.maxDrawdown,
      sortinoRatio: pingzhong.sortinoRatio,
      volatility: pingzhong.volatility,
      riskByPeriod: pingzhong.riskByPeriod,
    },
    meta: {
      morningstarRating: rating,
      categoryRankPercent: pingzhong.categoryRankPercent,
      fundSize: detail.fundSize,
      managerYears: pingzhong.managerYears,
      totalFeeRate: detail.totalFeeRate,
    },
  };
}

/** Fetch fund holdings (top 10 stocks) */
export async function fetchFundHoldings(code: string): Promise<FundHoldings> {
  const url = `http://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=&month=&rt=${Math.random()}`;
  const { data: js } = await fetchWithRetry<string>(url);

  const topStocks: HoldingStock[] = [];
  const rowPattern = /<tr>[\s\S]*?<td[^>]*>(\d+)<\/td>[\s\S]*?<td[^>]*><a[^>]*>(\d{6})<\/a><\/td>[\s\S]*?<td[^>]*><a[^>]*>([^<]+)<\/a><\/td>[\s\S]*?<td[^>]*>([\d.]+)%<\/td>/g;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(js)) !== null) {
    topStocks.push({
      name: match[3],
      code: match[2],
      percent: parseFloat(match[4]) || 0,
    });
    if (topStocks.length >= 10) break;
  }

  const dateMatch = js.match(/截止至[：:].*?(\d{4}-\d{2}-\d{2})/);
  const reportDate = dateMatch?.[1] ?? '';

  return {
    topStocks,
    industries: [],
    reportDate,
  };
}

/** Fetch fund list (for recommend feature) */
export async function fetchFundList(fundType?: string): Promise<FundListItem[]> {
  const ftMap: Record<string, string> = {
    '股票': 'gp', '混合': 'hh', '债券': 'zq',
    '指数': 'zs', 'QDII': 'qdii', 'FOF': 'fof',
  };

  let ft = '';
  if (fundType) {
    for (const [key, val] of Object.entries(ftMap)) {
      if (fundType.includes(key)) { ft = val; break; }
    }
  }

  const url = `http://fund.eastmoney.com/data/rankhandler.aspx`;
  const { data: text } = await fetchWithRetry<string>(url, {
    params: {
      op: 'ph', dt: 'kf', ft: ft || 'all',
      rs: '', gs: 0, sc: '1nzf', st: 'desc',
      pi: 1, pn: 200, dx: 1,
    },
    headers: {
      Referer: 'http://fund.eastmoney.com/data/fundranking.html',
    },
  });

  const datasMatch = text.match(/datas:\[([\s\S]*?)\]/);
  if (!datasMatch) return [];

  const items: FundListItem[] = [];
  const entryPattern = /"([^"]+)"/g;
  let entry: RegExpExecArray | null;
  while ((entry = entryPattern.exec(datasMatch[1])) !== null) {
    const fields = entry[1].split(',');
    if (fields.length < 3) continue;
    items.push({
      code: fields[0],
      name: fields[1],
      type: fields[2] || '',
    });
  }

  return items;
}
