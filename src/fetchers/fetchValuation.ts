/** 获取指数估值数据（PE/PB 及历史分位数） */

import { fetchWithRetry } from "./httpClient.js";
import type { IndexValuation } from "../types/indexFund.js";

/** 指数代码 → 蛋卷基金 index_code 映射 */
const INDEX_CODE_MAP: Record<string, string> = {
  "000300": "SH000300", // 沪深300
  "000905": "SH000905", // 中证500
  "000852": "SH000852", // 中证1000
  "399006": "SZ399006", // 创业板指
  "000016": "SH000016", // 上证50
  "399673": "SZ399673", // 创业板50
  "000688": "SH000688", // 科创50
};

/** 蛋卷基金列表 API 中单条记录 */
interface DanjuanItem {
  index_code: string;
  name: string;
  pe: number;
  pb: number;
  pe_percentile: number; // 0-1
  pb_percentile: number; // 0-1
  date: string; // MM-DD
}

interface DanjuanListResp {
  data?: { items?: DanjuanItem[] };
  result_code: number;
}

/**
 * 从蛋卷基金获取指数估值数据
 * @param indexCode 指数代码，如 000300、000905
 */
export async function fetchIndexValuation(
  indexCode: string,
): Promise<IndexValuation> {
  const djCode = INDEX_CODE_MAP[indexCode];
  if (!djCode) {
    throw new Error(
      `不支持的指数代码: ${indexCode}，支持: ${Object.keys(INDEX_CODE_MAP).join(", ")}`,
    );
  }

  const url = "https://danjuanfunds.com/djapi/index_eva/dj";
  const resp = await fetchWithRetry<string>(url, {
    headers: {
      Referer: "https://danjuanfunds.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  let parsed: DanjuanListResp;
  try {
    parsed = typeof resp.data === "string" ? JSON.parse(resp.data) : resp.data;
  } catch {
    throw new Error(`解析蛋卷基金估值数据失败: ${indexCode}`);
  }

  const items = parsed.data?.items;
  if (!items || items.length === 0) {
    throw new Error(`蛋卷基金估值列表为空`);
  }

  const item = items.find((i) => i.index_code === djCode);
  if (!item) {
    throw new Error(`未找到指数 ${indexCode} 的估值数据`);
  }

  // 蛋卷返回 date 为 "MM-DD" 格式，补全年份
  const year = new Date().getFullYear();
  const fullDate = `${year}-${item.date}`;

  return {
    pe: item.pe,
    pb: item.pb,
    pePercentile: item.pe_percentile * 100, // 转为 0-100
    pbPercentile: item.pb_percentile * 100,
    date: fullDate,
  };
}

/** 支持的指数列表 */
export const SUPPORTED_INDEXES = Object.keys(INDEX_CODE_MAP);
