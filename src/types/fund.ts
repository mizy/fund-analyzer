export interface FundBasicInfo {
  code: string;
  name: string;
  type: string;
  establishDate: string;
}

export interface FundPerformance {
  returnYear1: number;
  returnYear3: number;
  sharpeRatio: number;
  maxDrawdown: number;
  sortinoRatio: number;
  volatility: number;
}

export interface FundMeta {
  morningstarRating: number; // 1-5
  fundSize: number; // 亿
  managerYears: number;
  totalFeeRate: number; // %
}

export interface FundData {
  basic: FundBasicInfo;
  performance: FundPerformance;
  meta: FundMeta;
}

export interface FundScore {
  returnScore: number; // 满40
  riskScore: number; // 满30
  overallScore: number; // 满30
  totalScore: number; // 满100
  details: { item: string; score: number; maxScore: number }[];
}

export interface FundAnalysis {
  data: FundData;
  score: FundScore;
}
