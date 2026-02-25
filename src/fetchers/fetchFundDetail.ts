import * as cheerio from "cheerio";
import { fetchWithRetry } from "./httpClient.js";

/** Fetch fund detail page (size, establish date, type, fee rate) */
export async function fetchFundDetail(code: string) {
  const url = `http://fundf10.eastmoney.com/jbgk_${code}.html`;
  const { data: html } = await fetchWithRetry<string>(url);

  const $ = cheerio.load(html);
  const info: Record<string, string> = {};

  $("table.info tr, table.w790 tr").each((_, tr) => {
    const tds = $(tr).find("th, td");
    for (let i = 0; i < tds.length - 1; i += 2) {
      const label = $(tds[i]).text().trim();
      const value = $(tds[i + 1]).text().trim();
      if (label) info[label] = value;
    }
  });

  const type = info["基金类型"] ?? "";
  const establishDate = info["成立日期/规模"]?.match(/\d{4}[-/年]\d{2}[-/月]\d{2}/)?.[0] ?? "";

  let fundSize = 0;
  const sizeText = info["净资产规模"] ?? info["资产规模"] ?? info["基金规模"] ?? "";
  const sizeMatch = sizeText.match(/([\d.]+)\s*亿/);
  if (sizeMatch) fundSize = parseFloat(sizeMatch[1]) || 0;

  let totalFeeRate = 0;
  const mgmtFee = info["管理费率"]?.match(/([\d.]+)%/);
  const custodyFee = info["托管费率"]?.match(/([\d.]+)%/);
  if (mgmtFee) totalFeeRate += parseFloat(mgmtFee[1]);
  if (custodyFee) totalFeeRate += parseFloat(custodyFee[1]);
  totalFeeRate = Math.round(totalFeeRate * 100) / 100;

  return { type, establishDate, fundSize, totalFeeRate };
}

/** Fetch 3-year return from jdzf API */
export async function fetchReturnYear3(code: string): Promise<number> {
  const url = `http://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jdzf&code=${code}`;
  const { data } = await fetchWithRetry<string>(url);
  const m = data.match(/近3年<\/li><li[^>]*>([+-]?[\d.]+)%/);
  return m ? parseFloat(m[1]) || 0 : 0;
}

/** Fetch Morningstar 3-year rating from JJPJ API */
export async function fetchMorningstarRating(code: string): Promise<number> {
  try {
    const url = `https://api.fund.eastmoney.com/F10/JJPJ/?callback=jQuery&fundcode=${code}&pageIndex=1&pageSize=1`;
    const { data } = await fetchWithRetry<string>(url, {
      headers: {
        Referer: `https://fundf10.eastmoney.com/jjpj_${code}.html`,
      },
    });
    const jsonStr = data.replace(/^jQuery\(/, "").replace(/\)$/, "");
    const parsed = JSON.parse(jsonStr);
    const rating = parseInt(parsed?.Data?.[0]?.CXPJ3) || 0;
    return Math.min(5, Math.max(0, rating));
  } catch {
    return 0;
  }
}

/** Estimate Morningstar rating from category rank percentile (fallback) */
export function estimateRatingFromRank(percentile: number): number {
  if (percentile <= 0) return 0;
  if (percentile <= 10) return 5;
  if (percentile <= 32.5) return 4;
  if (percentile <= 67.5) return 3;
  if (percentile <= 90) return 2;
  return 1;
}
