export type FundCategory = 'bond' | 'balanced' | 'equity';

// 风险层级分类
export enum RiskTier {
  VERY_LOW = 'very_low',       // 货币基金、超短债
  LOW = 'low',                 // 纯债、短债、一级债基
  MEDIUM = 'medium',           // 二级债基、偏债混合、FOF
  MEDIUM_HIGH = 'medium_high', // 偏股混合、股债平衡
  HIGH = 'high',               // 股票型、指数型、行业主题
}

export interface TierBenchmark {
  sharpeBenchmark: number;     // 夏普满分基准
  returnBenchmark: number;     // 收益满分基准（年化）
  drawdownBenchmark: number;   // 回撤满分基准
}

export interface FundBasicInfo {
  code: string;
  name: string;
  type: string;
  establishDate: string;
}

// 单时段风险指标
export interface PeriodRiskMetrics {
  sharpeRatio: number;
  maxDrawdown: number;    // %
  volatility: number;     // % 年化
  sortinoRatio: number;
  calmarRatio: number;    // 年化收益 / |最大回撤|
}

export type TimeWindow = '1y' | '3y' | 'all';

// 分时段风险指标
export interface PeriodRiskBreakdown {
  year1: PeriodRiskMetrics | null;  // 数据不足1年时为 null
  year3: PeriodRiskMetrics | null;  // 数据不足3年时为 null
  all: PeriodRiskMetrics;
}

export interface FundPerformance {
  returnYear1: number;
  returnYear3: number;
  // 全历史风险指标（向后兼容）
  sharpeRatio: number;
  maxDrawdown: number;
  sortinoRatio: number;
  volatility: number;
  // 分时段风险指标
  riskByPeriod: PeriodRiskBreakdown;
}

export interface FundMeta {
  morningstarRating: number; // 晨星评级 1-5，优先取 JJPJ 真实评级，无数据时从同类排名推算
  categoryRankPercent: number; // 同类排名百分位（越小越好），如 10.5 表示前 10.5%，0=无数据
  fundSize: number; // 亿
  managerYears: number;
  totalFeeRate: number; // %
}

export interface FundData {
  basic: FundBasicInfo;
  performance: FundPerformance;
  meta: FundMeta;
}

export interface FundScoreDetail {
  item: string;
  score: number;
  maxScore: number;
}

export interface FundScore {
  returnScore: number; // 收益能力35
  riskScore: number; // 风险控制35
  overallScore: number; // 综合评价30
  totalScore: number; // 满100（= marketScore），动量惩罚后可能低于维度之和
  momentumPenalty: number; // 动量反转惩罚扣分（近1年涨幅过高时）
  details: FundScoreDetail[];
  // 分层评分
  riskTier: RiskTier;
  tierScore: number; // 同类评分（使用分层基准）
  marketScore: number; // 全市场评分（= totalScore）
  tierRank?: string; // 如 "前5%"
  tierDetails: FundScoreDetail[]; // 同类评分详情
}

export interface DeepFundScore {
  returnScore: number;    // 满30
  riskScore: number;      // 满30
  holdingScore: number;   // 满15
  stabilityScore: number; // 满10
  overallScore: number;   // 满15
  totalScore: number;     // 满100
  details: FundScoreDetail[];
}

export interface FundAnalysis {
  data: FundData;
  score: FundScore;
  deepScore?: DeepFundScore;
  quant?: QuantMetrics;
  backtest?: BacktestResult;
  holdings?: FundHoldings;
}

// --- 持仓数据 ---

export interface HoldingStock {
  name: string;       // 股票名称
  code: string;       // 股票代码
  percent: number;    // 占净值比例 %
}

export interface IndustryAllocation {
  industry: string;   // 行业名称
  percent: number;    // 占比 %
}

export interface FundHoldings {
  topStocks: HoldingStock[];       // 前10大重仓
  industries: IndustryAllocation[]; // 行业分布（来自资产配置）
  reportDate: string;               // 报告期
}

// --- 历史净值 ---

export interface NavRecord {
  date: string;        // 日期 YYYY-MM-DD
  nav: number;         // 单位净值
  accNav: number;      // 累计净值
  dailyReturn: number; // 日收益率 %
}

// --- 基准指数数据 ---

export interface BenchmarkRecord {
  date: string;
  close: number;
  dailyReturn: number;
}

// --- 量化分析结果 ---

export interface QuantMetrics {
  alpha: number;
  beta: number;
  informationRatio: number;
  treynorRatio: number;
  var95: number;
  cvar95: number;
  monthlyWinRate: number;
  downsideCaptureRatio: number;
  cagr: number;
  hhi: number;
  topHoldingsRatio: number;
}

// --- 回测结果 ---

export interface BacktestResult {
  sipReturns: {
    totalInvested: number;
    finalValue: number;
    totalReturn: number;    // 总收益率 %
    annualizedReturn: number; // 年化收益率 %
  };
  holdingPeriodDist: {
    period: string;          // 如 "1年", "3年"
    positiveRatio: number;   // 正收益概率 %
    avgReturn: number;       // 平均收益率 %
    medianReturn: number;    // 中位数收益率 %
    minReturn: number;
    maxReturn: number;
  }[];
}

// --- 基金列表项（用于 recommend）---

export interface FundListItem {
  code: string;
  name: string;
  type: string;
}
