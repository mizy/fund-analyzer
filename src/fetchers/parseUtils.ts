// JS variable extraction from eastmoney's pingzhongdata scripts

/** Extract a simple string/number variable: var name = "value"; or var name = value; */
export function extractVar(js: string, varName: string): string | null {
  const re = new RegExp(`var\\s+${varName}\\s*=\\s*"?([^";]*)"?\\s*;`);
  const m = js.match(re);
  return m?.[1] ?? null;
}

/** Extract a JSON variable (array or object): var name = [...]; */
export function extractJsonVar<T>(js: string, varName: string): T | null {
  const re = new RegExp(`var\\s+${varName}\\s*=\\s*`);
  const m = re.exec(js);
  if (!m) return null;
  const start = m.index + m[0].length;

  // Find matching semicolon (skip strings)
  let depth = 0;
  let inStr = false;
  let strChar = "";
  let end = start;
  for (let i = start; i < js.length; i++) {
    const c = js[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
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

// Data_netWorthTrend element format
export type NavPoint = { x: number; y: number; equityReturn: number; unitMoney: string };

/** Convert NavPoint[] to [timestamp, nav][] */
export function toNavArray(data: NavPoint[] | null): number[][] | null {
  if (!data || data.length === 0) return null;
  return data.map((p) => [p.x, p.y]);
}
