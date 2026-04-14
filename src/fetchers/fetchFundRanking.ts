import type { FundCategory, FundRankingItem } from "../types/fund.js";
import { fetchWithRetry } from "./httpClient.js";

const CATEGORY_MAP: Record<FundCategory, string> = {
  bond: "zq",
  balanced: "hh",
  equity: "gp",
};

export async function fetchFundRanking(
  type: FundCategory,
  limit: number,
): Promise<FundRankingItem[]> {
  const ft = CATEGORY_MAP[type];
  const url =
    `https://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=${ft}` +
    `&rs=&gs=0&sc=1nzf&st=desc&pi=1&pn=${limit}&dx=1`;

  const resp = await fetchWithRetry(url, {
    headers: { Referer: "http://fund.eastmoney.com/data/fundranking.html" },
  });

  const text = resp.data as string;

  // 响应格式: var rankData = {datas:["...","...",...], ...};
  const match = text.match(/datas:\[([\s\S]*?)\]/);
  if (!match) return [];

  const rawItems = match[1].match(/"([^"]+)"/g);
  if (!rawItems) return [];

  return rawItems.map((raw) => {
    const fields = raw.replace(/"/g, "").split(",");
    return { code: fields[0], name: fields[1] };
  });
}
