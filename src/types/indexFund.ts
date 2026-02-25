/** 指数基金时机分析相关类型 */

/** 指数估值数据 */
export interface IndexValuation {
  pe: number;
  pb: number;
  pePercentile: number; // PE 历史分位数 0-100
  pbPercentile: number; // PB 历史分位数 0-100
  date: string; // YYYY-MM-DD
}

/** 技术面信号 */
export interface TechnicalSignal {
  ma5: number;
  ma20: number;
  ma60: number;
  rsi: number; // RSI14
  direction: "bullish" | "bearish" | "neutral";
}

/** 综合评级 */
export type TimingRating = "buy" | "hold" | "sell";

/** 各维度评分详情 */
export interface TimingDimensionDetail {
  name: string;
  score: number;
  maxScore: number;
  reason: string;
}

/** 指数时机分析结果 */
export interface IndexTimingResult {
  indexCode: string;
  indexName: string;
  valuationScore: number; // 估值评分 0-50
  technicalScore: number; // 技术面评分 0-50
  totalScore: number; // 综合评分 0-100
  rating: TimingRating;
  valuation: IndexValuation;
  technical: TechnicalSignal;
  details: TimingDimensionDetail[];
}
