import axios from "axios";
import * as cheerio from "cheerio";
import type { FundData } from "../types/fund.js";

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

// 从 pingzhongdata JS 中提取数组变量
function extractArrayVar(js: string, varName: string): number[][] | null {
  const re = new RegExp(`var\\s+${varName}\\s*=\\s*(\\[\\[.*?\\]\\])\\s*;`);
  const m = js.match(re);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1]) as number[][];
  } catch {
    return null;
  }
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
  const returnYear3 = parseFloat(extractVar(js, "syl_3n") ?? "0") || 0;
  const sharpeRatio =
    parseFloat(extractVar(js, "Data_sharpeRatio") ?? "0") || 0;

  // 提取净值数据用于计算回撤和波动率
  const navData = extractArrayVar(js, "Data_netWorthTrend");
  const maxDrawdown = calcMaxDrawdown(navData);
  const volatility = calcVolatility(navData);
  const sortinoRatio = calcSortinoRatio(navData, returnYear1);

  return {
    name,
    code: fundCode,
    returnYear1,
    returnYear3,
    sharpeRatio,
    maxDrawdown,
    volatility,
    sortinoRatio,
  };
}

// 抓取基金详情页（基金规模、成立日期、类型、经理年限、费率）
async function fetchFundDetail(code: string) {
  const url = `http://fundf10.eastmoney.com/jbgk_${code}.html`;
  const { data: html } = await axios.get<string>(url, {
    headers: HEADERS,
    timeout: TIMEOUT,
    responseType: "text",
  });

  const $ = cheerio.load(html);
  const info: Record<string, string> = {};

  // 解析表格中的 label-value 对
  $("table.info tr").each((_, tr) => {
    const tds = $(tr).find("th, td");
    for (let i = 0; i < tds.length - 1; i += 2) {
      const label = $(tds[i]).text().trim();
      const value = $(tds[i + 1]).text().trim();
      if (label) info[label] = value;
    }
  });

  // 基金类型
  const type = info["基金类型"] ?? "";

  // 成立日期
  const establishDate = info["成立日期/规模"]?.match(/\d{4}[-/年]\d{2}[-/月]\d{2}/)?.[0] ?? "";

  // 基金规模（亿）
  let fundSize = 0;
  const sizeText = info["资产规模"] ?? info["基金规模"] ?? "";
  const sizeMatch = sizeText.match(/([\d.]+)\s*亿/);
  if (sizeMatch) fundSize = parseFloat(sizeMatch[1]) || 0;

  // 基金经理任职年限
  let managerYears = 0;
  const managerText = info["现任基金经理及任职时间"] ?? info["基金经理人"] ?? "";
  const yearsMatch = managerText.match(/(\d+)年又?(\d+)?天?/);
  if (yearsMatch) {
    managerYears = parseInt(yearsMatch[1]) + (parseInt(yearsMatch[2] || "0") / 365);
    managerYears = Math.round(managerYears * 10) / 10;
  }

  // 管理费率 + 托管费率
  let totalFeeRate = 0;
  const mgmtFee = info["管理费率"]?.match(/([\d.]+)%/);
  const custodyFee = info["托管费率"]?.match(/([\d.]+)%/);
  if (mgmtFee) totalFeeRate += parseFloat(mgmtFee[1]);
  if (custodyFee) totalFeeRate += parseFloat(custodyFee[1]);
  totalFeeRate = Math.round(totalFeeRate * 100) / 100;

  return { type, establishDate, fundSize, managerYears, totalFeeRate };
}

/** 抓取基金完整数据 */
export async function fetchFundData(code: string): Promise<FundData> {
  const [pingzhong, detail] = await Promise.all([
    fetchPingzhongData(code),
    fetchFundDetail(code).catch(() => ({
      type: "",
      establishDate: "",
      fundSize: 0,
      managerYears: 0,
      totalFeeRate: 0,
    })),
  ]);

  return {
    basic: {
      code: pingzhong.code,
      name: pingzhong.name,
      type: detail.type,
      establishDate: detail.establishDate,
    },
    performance: {
      returnYear1: pingzhong.returnYear1,
      returnYear3: pingzhong.returnYear3,
      sharpeRatio: pingzhong.sharpeRatio,
      maxDrawdown: pingzhong.maxDrawdown,
      sortinoRatio: pingzhong.sortinoRatio,
      volatility: pingzhong.volatility,
    },
    meta: {
      morningstarRating: 0, // 天天基金不提供晨星评级，后续可扩展
      fundSize: detail.fundSize,
      managerYears: detail.managerYears,
      totalFeeRate: detail.totalFeeRate,
    },
  };
}
