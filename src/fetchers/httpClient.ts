import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";

const TIMEOUT = 10_000;
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "http://fund.eastmoney.com/",
};

// --- Rate limiting ---

let lastRequestTime = 0;
const MIN_INTERVAL_MS = 300;

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

// --- Retry with exponential backoff ---

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

export async function fetchWithRetry<T = string>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> {
  await waitForRateLimit();

  const mergedConfig: AxiosRequestConfig = {
    timeout: TIMEOUT,
    responseType: "text",
    ...config,
    headers: { ...HEADERS, ...config?.headers },
  };

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await axios.get<T>(url, mergedConfig);
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
        await waitForRateLimit();
      }
    }
  }
  throw lastError;
}
