import axios from "axios";
import * as cheerio from "cheerio";
import type { FundData, FundHoldings, HoldingStock, NavRecord, BenchmarkRecord, FundListItem, PeriodRiskMetrics, PeriodRiskBreakdown } from "../types/fund.js";

const TIMEOUT = 10_000;
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "http://fund.eastmoney.com/",
};

// 从 pingzhongdata JS 中提取变量值
function extractVar(js: string, varName: string): string | null {
  // 匹配 var varName = "value" 或 var varName = value
  const re = new RegExp(`var\\s+${varName}\\s*=\\s*"?([^";]*)"?\\s*;`);
  const m = js.match(re);
  return m?.[1] ?? null;
}

// 从 pingzhongdata JS 中提取 JSON 变量（数组或对象）
function extractJsonVar<T>(js: string, varName: string): T | null {
  const re = new RegExp(`var\\s+${varName}\\s*=\\s*`);
  const m = re.exec(js);
  if (!m) return null;
  const start = m.index + m[0].length;
  // 找到对应的分号结尾（跳过字符串内的分号）
  let depth = 0;
  let inStr = false;
  let strChar = "";
  let end = start;
  for (let i = start; i < js.length; i++) {
    const c = js[i];
    if (inStr) {
      if (c === "\\" ) { i++; continue; }
      if (c === strChar) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strChar = c; continue; }
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") depth--;
    if (c === ";" && depth === 0) { end = i; break; }
  }
  try {
    return JSON.parse(js.slice(start, end)) as T;
  } catch {
    return null;
  }
}

// Data_netWorthTrend 的元素格式
type NavPoint = { x: number; y: number; equityReturn: number; unitMoney: string };

// 从 NavPoint 数组提取 [timestamp, nav] 二维数组
function toNavArray(data: NavPoint[] | null): number[][] | null {
  if (!data || data.length === 0) return null;
  return data.map((p) => [p.x, p.y]);
}

// 计算最大回撤（从净值数组）
function calcMaxDrawdown(navData: number[][] | null): number {
  if (!navData || navData.length < 2) return 0;
  let peak = navData[0][1];
  let maxDd = 0;
  for (const [, nav] of navData) {
    if (nav > peak) peak = nav;
    const dd = (peak - nav) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return Math.round(maxDd * 10000) / 100; // 百分比，保留两位
}

// 计算波动率（年化，从净值数组）
function calcVolatility(navData: number[][] | null): number {
  if (!navData || navData.length < 10) return 0;
  const returns: number[] = [];
  for (let i = 1; i < navData.length; i++) {
    returns.push((navData[i][1] - navData[i - 1][1]) / navData[i - 1][1]);
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  // 年化：日波动率 * sqrt(252)
  return Math.round(Math.sqrt(variance) * Math.sqrt(252) * 10000) / 100;
}

// 计算夏普比率（从净值数组，年化）
function calcSharpeRatio(navData: number[][] | null): number {
  if (!navData || navData.length < 30) return 0;
  const returns: number[] = [];
  for (let i = 1; i < navData.length; i++) {
    returns.push((navData[i][1] - navData[i - 1][1]) / navData[i - 1][1]);
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  const riskFreeDaily = 0.02 / 252;
  return Math.round(((mean - riskFreeDaily) / stdDev) * Math.sqrt(252) * 100) / 100;
}

// 计算索提诺比率
function calcSortinoRatio(
  navData: number[][] | null,
  returnYear1: number
): number {
  if (!navData || navData.length < 10) return 0;
  const returns: number[] = [];
  for (let i = 1; i < navData.length; i++) {
    returns.push((navData[i][1] - navData[i - 1][1]) / navData[i - 1][1]);
  }
  const riskFreeDaily = 0.02 / 252; // 假设无风险利率2%
  const downsideReturns = returns
    .filter((r) => r < riskFreeDaily)
    .map((r) => (r - riskFreeDaily) ** 2);
  if (downsideReturns.length === 0) return 3; // 没有下行风险
  const downsideDeviation = Math.sqrt(
    downsideReturns.reduce((s, r) => s + r, 0) / downsideReturns.length
  );
  const annualizedDownside = downsideDeviation * Math.sqrt(252);
  if (annualizedDownside === 0) return 3;
  return (
    Math.round(((returnYear1 / 100 - 0.02) / annualizedDownside) * 100) / 100
  );
}

// 按时间窗口截取 navData（navData 格式: [[timestamp_ms, nav], ...]）
function sliceNavData(navData: number[][], windowYears: number): number[][] | null {
  if (navData.length === 0) return null;
  const latestTs = navData[navData.length - 1][0];
  const cutoffTs = latestTs - windowYears * 365.25 * 24 * 3600 * 1000;
  // 找到第一个 >= cutoffTs 的索引
  let startIdx = 0;
  for (let i = 0; i < navData.length; i++) {
    if (navData[i][0] >= cutoffTs) { startIdx = i; break; }
  }
  const sliced = navData.slice(startIdx);
  // 数据不足（实际时间跨度 < 窗口的 80%，认为数据不足）
  const actualSpanMs = sliced[sliced.length - 1][0] - sliced[0][0];
  const requiredSpanMs = windowYears * 365.25 * 24 * 3600 * 1000 * 0.8;
  if (actualSpanMs < requiredSpanMs) return null;
  return sliced;
}

// 计算单时段风险指标
function calcPeriodRiskMetrics(navData: number[][] | null, returnYear1: number): PeriodRiskMetrics | null {
  if (!navData || navData.length < 10) return null;
  return {
    maxDrawdown: calcMaxDrawdown(navData),
    volatility: calcVolatility(navData),
    sharpeRatio: calcSharpeRatio(navData),
    sortinoRatio: calcSortinoRatio(navData, returnYear1),
  };
}

// 一次计算三个时段的风险指标
function calcMultiPeriodRiskMetrics(navData: number[][] | null, returnYear1: number): PeriodRiskBreakdown {
  const allMetrics: PeriodRiskMetrics = {
    maxDrawdown: calcMaxDrawdown(navData),
    volatility: calcVolatility(navData),
    sharpeRatio: calcSharpeRatio(navData),
    sortinoRatio: calcSortinoRatio(navData, returnYear1),
  };

  const nav1y = navData ? sliceNavData(navData, 1) : null;
  const nav3y = navData ? sliceNavData(navData, 3) : null;

  return {
    year1: calcPeriodRiskMetrics(nav1y, returnYear1),
    year3: calcPeriodRiskMetrics(nav3y, returnYear1),
    all: allMetrics,
  };
}

// 从 jdzf API 提取近3年收益率
async function fetchReturnYear3(code: string): Promise<number> {
  const url = `http://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jdzf&code=${code}`;
  const { data } = await axios.get<string>(url, {
    headers: HEADERS,
    timeout: TIMEOUT,
    responseType: "text",
  });
  // 匹配: <li class='title'>近3年</li><li class='tor ... bold'>15.07%</li>
  const m = data.match(/近3年<\/li><li[^>]*>([+-]?[\d.]+)%/);
  return m ? parseFloat(m[1]) || 0 : 0;
}

// 从 Data_currentFundManager 提取经理最大任职年限
function extractManagerYears(js: string): number {
  type Manager = { workTime: string };
  const managers = extractJsonVar<Manager[]>(js, "Data_currentFundManager");
  if (!managers || managers.length === 0) return 0;
  let maxYears = 0;
  for (const mgr of managers) {
    const m = mgr.workTime.match(/(\d+)年/);
    const days = mgr.workTime.match(/(\d+)天/);
    if (m) {
      const years = parseInt(m[1]) + (days ? parseInt(days[1]) / 365 : 0);
      if (years > maxYears) maxYears = years;
    }
  }
  return Math.round(maxYears * 10) / 10;
}

// 从天天基金 JJPJ 接口抓取晨星三年评级
async function fetchMorningstarRating(code: string): Promise<number> {
  try {
    const url = `https://api.fund.eastmoney.com/F10/JJPJ/?callback=jQuery&fundcode=${code}&pageIndex=1&pageSize=1`;
    const { data } = await axios.get<string>(url, {
      headers: {
        ...HEADERS,
        Referer: `https://fundf10.eastmoney.com/jjpj_${code}.html`,
      },
      timeout: TIMEOUT,
      responseType: "text",
    });
    // JSONP: jQuery({"Data":[{"CXPJ3":"4",...}],...})
    const jsonStr = data.replace(/^jQuery\(/, "").replace(/\)$/, "");
    const parsed = JSON.parse(jsonStr);
    const rating = parseInt(parsed?.Data?.[0]?.CXPJ3) || 0;
    return Math.min(5, Math.max(0, rating));
  } catch {
    return 0;
  }
}

// 从 pingzhongdata 提取近1年同类排名百分位
// Data_rateInSimilarPersent 的值表示"超越了多少比例的同类基金"（越大越好）
// 我们转换为"排名百分位"（越小越好，如 10 表示前 10%）
function extractCategoryRankPercent(js: string): number {
  type RankPoint = { x: number; y: number; sc: string };
  const data = extractJsonVar<RankPoint[]>(js, "Data_rateInSimilarType");
  if (!data || data.length === 0) return 0;
  // 取最新一期，计算排名百分位 = rank / total * 100
  const latest = data[data.length - 1];
  const total = parseInt(latest.sc) || 0;
  if (total === 0) return 0;
  return Math.round((latest.y / total) * 10000) / 100; // 如 10.52 表示前 10.52%
}

// 抓取 pingzhongdata（基金核心数据）
async function fetchPingzhongData(code: string) {
  const url = `http://fund.eastmoney.com/pingzhongdata/${code}.js`;
  const { data: js } = await axios.get<string>(url, {
    headers: HEADERS,
    timeout: TIMEOUT,
    responseType: "text",
  });

  const name = extractVar(js, "fS_name") ?? "";
  const fundCode = extractVar(js, "fS_code") ?? code;
  const returnYear1 = parseFloat(extractVar(js, "syl_1n") ?? "0") || 0;

  // 提取净值数据
  // Data_netWorthTrend: 单位净值（分红后会下跌，不适合计算风险指标）
  // Data_ACWorthTrend: 累计净值（已包含分红再投资，真实反映收益曲线）
  // 风险指标（夏普、回撤、波动率）必须用累计净值计算，否则分红型基金指标严重偏差
  const rawNavData = extractJsonVar<NavPoint[]>(js, "Data_netWorthTrend");
  const accNavData = extractJsonVar<number[][]>(js, "Data_ACWorthTrend");
  const navDataForRisk = accNavData && accNavData.length > 0 ? accNavData : toNavArray(rawNavData);
  const riskByPeriod = calcMultiPeriodRiskMetrics(navDataForRisk, returnYear1);
  // 全历史指标（向后兼容）
  const { maxDrawdown, volatility, sharpeRatio, sortinoRatio } = riskByPeriod.all;

  // 从 pingzhongdata 提取经理任职年限
  const managerYears = extractManagerYears(js);

  // 同类排名百分位
  const categoryRankPercent = extractCategoryRankPercent(js);

  return {
    name,
    code: fundCode,
    returnYear1,
    sharpeRatio,
    maxDrawdown,
    volatility,
    sortinoRatio,
    riskByPeriod,
    managerYears,
    categoryRankPercent,
  };
}

// 抓取基金详情页（基金规模、成立日期、类型、费率）
async function fetchFundDetail(code: string) {
  const url = `http://fundf10.eastmoney.com/jbgk_${code}.html`;
  const { data: html } = await axios.get<string>(url, {
    headers: HEADERS,
    timeout: TIMEOUT,
    responseType: "text",
  });

  const $ = cheerio.load(html);
  const info: Record<string, string> = {};

  // 解析表格中的 label-value 对 (table class="info w790")
  $("table.info tr, table.w790 tr").each((_, tr) => {
    const tds = $(tr).find("th, td");
    for (let i = 0; i < tds.length - 1; i += 2) {
      const label = $(tds[i]).text().trim();
      const value = $(tds[i + 1]).text().trim();
      if (label) info[label] = value;
    }
  });

  // 基金类型
  const type = info["基金类型"] ?? "";

  // 成立日期 (from "成立日期/规模" field)
  const establishDate = info["成立日期/规模"]?.match(/\d{4}[-/年]\d{2}[-/月]\d{2}/)?.[0] ?? "";

  // 基金规模（亿）- HTML 中 label 为 "净资产规模"
  let fundSize = 0;
  const sizeText = info["净资产规模"] ?? info["资产规模"] ?? info["基金规模"] ?? "";
  const sizeMatch = sizeText.match(/([\d.]+)\s*亿/);
  if (sizeMatch) fundSize = parseFloat(sizeMatch[1]) || 0;

  // 管理费率 + 托管费率
  let totalFeeRate = 0;
  const mgmtFee = info["管理费率"]?.match(/([\d.]+)%/);
  const custodyFee = info["托管费率"]?.match(/([\d.]+)%/);
  if (mgmtFee) totalFeeRate += parseFloat(mgmtFee[1]);
  if (custodyFee) totalFeeRate += parseFloat(custodyFee[1]);
  totalFeeRate = Math.round(totalFeeRate * 100) / 100;

  return { type, establishDate, fundSize, totalFeeRate };
}

// 从同类排名百分位推算晨星评级（备选方案）
function estimateRatingFromRank(percentile: number): number {
  if (percentile <= 0) return 0;
  if (percentile <= 10) return 5;
  if (percentile <= 32.5) return 4;
  if (percentile <= 67.5) return 3;
  if (percentile <= 90) return 2;
  return 1;
}

// --- 基准 secid 映射 ---

const BENCHMARK_SECID: Record<string, string> = {
  '000300': '1.000300', // 沪深300
  '000905': '1.000905', // 中证500
  '000012': '1.000012', // 国债指数
  '399006': '0.399006', // 创业板指
};

/** 抓取基金持仓数据（前10大重仓股） */
export async function fetchFundHoldings(code: string): Promise<FundHoldings> {
  const url = `http://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=&month=&rt=${Math.random()}`;
  const { data: js } = await axios.get<string>(url, {
    headers: HEADERS,
    timeout: TIMEOUT,
    responseType: "text",
  });

  const topStocks: HoldingStock[] = [];

  // 解析 HTML 表格中的持仓数据
  // 格式: 序号 | 股票代码 | 股票名称 | ... | 占净值比例% | ...
  const rowPattern = /<tr>[\s\S]*?<td[^>]*>(\d+)<\/td>[\s\S]*?<td[^>]*><a[^>]*>(\d{6})<\/a><\/td>[\s\S]*?<td[^>]*><a[^>]*>([^<]+)<\/a><\/td>[\s\S]*?<td[^>]*>([\d.]+)%<\/td>/g;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(js)) !== null) {
    topStocks.push({
      name: match[3],
      code: match[2],
      percent: parseFloat(match[4]) || 0,
    });
    if (topStocks.length >= 10) break; // 只取第一个季度（最新）
  }

  // 提取报告日期 (截止至：2025-12-31)
  const dateMatch = js.match(/截止至[：:].*?(\d{4}-\d{2}-\d{2})/);
  const reportDate = dateMatch?.[1] ?? '';

  return {
    topStocks,
    industries: [], // 行业分布需从 pingzhongdata 的 Data_assetAllocation 获取
    reportDate,
  };
}

/** 从 pingzhongdata 提取完整历史净值序列 */
export async function fetchHistoryNav(code: string): Promise<NavRecord[]> {
  const url = `http://fund.eastmoney.com/pingzhongdata/${code}.js`;
  const { data: js } = await axios.get<string>(url, {
    headers: HEADERS,
    timeout: TIMEOUT,
    responseType: "text",
  });

  const rawNavData = extractJsonVar<NavPoint[]>(js, "Data_netWorthTrend");
  if (!rawNavData || rawNavData.length === 0) return [];

  // 同时提取累计净值
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
    // 用累计净值计算日收益率，避免分红导致的虚假负收益
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

/** 抓取基准指数日K线数据 */
export async function fetchBenchmarkData(
  indexCode: string,
  startDate?: string,
  endDate?: string,
): Promise<BenchmarkRecord[]> {
  const secid = BENCHMARK_SECID[indexCode] ?? `1.${indexCode}`;
  const beg = startDate?.replace(/-/g, '') ?? '20200101';
  const end = endDate?.replace(/-/g, '') ?? '20991231';

  const url = `http://push2his.eastmoney.com/api/qt/stock/kline/get`;
  const { data } = await axios.get(url, {
    params: {
      secid,
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57',
      klt: 101,     // 日K线
      fqt: 0,       // 不复权
      beg,
      end,
      lmt: 5000,
    },
    headers: HEADERS,
    timeout: TIMEOUT,
  });

  const klines: string[] = data?.data?.klines ?? [];
  const records: BenchmarkRecord[] = [];

  for (let i = 0; i < klines.length; i++) {
    // 格式: 日期,开盘,收盘,最高,最低,成交量,成交额
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

/** 抓取基金列表（用于 recommend 功能） */
export async function fetchFundList(fundType?: string): Promise<FundListItem[]> {
  // 使用东方财富基金筛选 API
  // ft: 分类 (gp=股票, hh=混合, zq=债券, zs=指数, qdii=QDII, fof=FOF)
  const ftMap: Record<string, string> = {
    '股票': 'gp',
    '混合': 'hh',
    '债券': 'zq',
    '指数': 'zs',
    'QDII': 'qdii',
    'FOF': 'fof',
  };

  // 从 fundType 提取大类关键字
  let ft = '';
  if (fundType) {
    for (const [key, val] of Object.entries(ftMap)) {
      if (fundType.includes(key)) { ft = val; break; }
    }
  }

  const url = `http://fund.eastmoney.com/data/rankhandler.aspx`;
  const params: Record<string, string | number> = {
    op: 'ph',
    dt: 'kf',     // 开放式基金
    ft: ft || 'all',
    rs: '',
    gs: 0,
    sc: '1nzf',   // 按近1年涨幅排序
    st: 'desc',
    pi: 1,
    pn: 200,       // 前200只
    dx: 1,
  };

  const { data: text } = await axios.get<string>(url, {
    params,
    headers: {
      ...HEADERS,
      Referer: 'http://fund.eastmoney.com/data/fundranking.html',
    },
    timeout: TIMEOUT,
    responseType: 'text',
  });

  // 响应格式: var rankData = {datas:["code,name,...","code,name,..."],allRecords:N,...}
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

/** 抓取基金完整数据 */
export async function fetchFundData(code: string): Promise<FundData> {
  const [pingzhong, detail, returnYear3, morningstarRating] = await Promise.all([
    fetchPingzhongData(code),
    fetchFundDetail(code).catch(() => ({
      type: "",
      establishDate: "",
      fundSize: 0,
      totalFeeRate: 0,
    })),
    fetchReturnYear3(code).catch(() => 0),
    fetchMorningstarRating(code),
  ]);

  // 晨星评级：优先用 JJPJ 接口的真实评级，无数据时从同类排名推算
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
