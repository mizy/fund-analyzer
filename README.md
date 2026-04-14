# fund-analyzer

基金量化分析 CLI 工具。从天天基金抓取数据，通过多维评分模型对基金进行量化评分和评级。

## 安装

```bash
pnpm install
pnpm build
```

构建后可通过 `node dist/index.js` 运行，或 `npm link` 后直接使用 `fund-analyzer` 命令。

## 命令

### analyze - 单只基金评分

```bash
fund-analyzer analyze <基金代码>
fund-analyzer analyze 110011              # 终端彩色输出
fund-analyzer analyze 110011 --json       # JSON 格式输出
fund-analyzer analyze 110011 --lark       # 发送到飞书（读取 LARK_WEBHOOK_URL）
fund-analyzer analyze 110011 --lark <url> # 指定飞书 Webhook
```

### batch - 批量分析

```bash
fund-analyzer batch <代码1>,<代码2>,...
fund-analyzer batch 110011,000001,519694               # 默认按评分排序
fund-analyzer batch 110011,000001 --sort return        # 按收益排序
fund-analyzer batch 110011,000001 --sort risk          # 按风险排序
fund-analyzer batch 110011,000001 --json
fund-analyzer batch 110011,000001 --lark
```

### compare - 对比两只基金

```bash
fund-analyzer compare <代码1> <代码2>
fund-analyzer compare 110011 000001
```

### detail - 深度量化报告

包含基础评分 + 深度评分 + 量化指标（Alpha/Beta/VaR/CVaR/IR/CAGR/月度胜率）+ 持仓分析 + 回测。

```bash
fund-analyzer detail <基金代码>
fund-analyzer detail 110011
```

### backtest - 回测分析

模拟定投、持有期分布、回撤买入策略。

```bash
fund-analyzer backtest <基金代码>
fund-analyzer backtest 110011                          # 默认：1000元/月，回撤阈值20%
fund-analyzer backtest 110011 --monthly-amount 2000    # 自定义定投金额
fund-analyzer backtest 110011 --drawdown 15            # 自定义回撤阈值
```

### holdings - 持仓分析

重仓股、行业分布、HHI 集中度。

```bash
fund-analyzer holdings <基金代码>
fund-analyzer holdings 110011
```

### analyze-index - 指数择时分析

基于 PE/PB 分位数 + 技术面信号（MA/RSI）分析指数买卖时机。

```bash
fund-analyzer analyze-index <指数代码>
fund-analyzer analyze-index 000300          # 沪深300
fund-analyzer analyze-index 000905          # 中证500
fund-analyzer analyze-index 000852          # 中证1000
fund-analyzer analyze-index 399006          # 创业板指
fund-analyzer analyze-index 000016          # 上证50
fund-analyzer analyze-index 399673          # 创业板50
fund-analyzer analyze-index 000688          # 科创50
fund-analyzer analyze-index 000300 --json   # JSON 输出
```

### daily-report - 持仓客观数据快照

输出持仓基金的实时估值、收益、回撤和评分等客观事实，适合给 AI 二次整理成日报。

```bash
fund-analyzer daily-report 001235,010011,160323,018094,020602
fund-analyzer daily-report 001235,010011 --json
fund-analyzer daily-report 001235,010011 --lark
```

### scoring-backtest - 评分预测回测

验证评分模型对未来收益的预测力（Pearson/Spearman 相关性 + 五分位收益分析）。

```bash
fund-analyzer scoring-backtest <代码1>,<代码2>,...
fund-analyzer scoring-backtest 110011,000001 --start 2020-01-01 --end 2024-01-01
fund-analyzer scoring-backtest 110011,000001 --step 3 --forward 1,2
fund-analyzer scoring-backtest 110011,000001 --json
fund-analyzer scoring-backtest 110011,000001 --html report.html
```

### notify-test - 测试飞书通知

```bash
fund-analyzer notify-test                  # 读取 LARK_WEBHOOK_URL
fund-analyzer notify-test --url <url>
```

## 评分模型

### 基础评分（analyze/batch，100分制）

同时展示**同类评分**和**全市场评分**两个维度，以及近1年/近3年/全历史分时段风险指标。

#### 收益能力（35 分）

| 评分项 | 满分 | 说明 |
|--------|------|------|
| 夏普比率 | 12 | 按基金类型自适应基准 |
| 索提诺比率 | 5 | 下行风险调整收益 |
| 近 1 年收益 | 8 | 类型自适应：债券≥8%/混合≥20%/股票≥30% 满分 |
| 近 3 年收益 | 10 | 类型自适应：债券≥20%/混合≥50%/股票≥80% 满分 |

#### 风险控制（35 分）

| 评分项 | 满分 | 说明 |
|--------|------|------|
| 卡玛比率 | 10 | 回撤调整收益 |
| 最大回撤 | 18 | 类型自适应：债券≤3%/混合≤10%/股票≤15% 满分 |
| 波动率 | 7 | 类型自适应 |

#### 综合评价（30 分）

| 评分项 | 满分 | 说明 |
|--------|------|------|
| 晨星评级 | 8 | 来自天天基金 JJPJ API |
| 基金规模 | 8 | 2-100亿满分 |
| 经理年限 | 8 | ≥7年满分 |
| 费率 | 6 | ≤0.8%满分 |

### 深度评分（detail，100分制）

纳入量化指标和持仓分析，五大维度：

#### 收益能力（30 分）

| 评分项 | 满分 | 说明 |
|--------|------|------|
| 近1年收益 | 8 | 类型自适应 |
| 近3年收益 | 7 | 类型自适应 |
| Alpha超额收益 | 10 | 相对基准指数的超额收益 |
| 月度胜率 | 5 | 月度正收益比例 |

#### 风险控制（30 分）

| 评分项 | 满分 | 说明 |
|--------|------|------|
| 夏普比率 | 10 | 加权（近1年40%+近3年30%+全历史30%） |
| 最大回撤 | 8 | 加权多时段 |
| Beta系数 | 5 | 0.6-0.9最优 |
| VaR(95%) | 4 | 日度在险价值 |
| 波动率 | 3 | 加权多时段 |

#### 持仓质量（15 分）

| 评分项 | 满分 | 说明 |
|--------|------|------|
| 行业集中度HHI | 8 | 0.05-0.15最优 |
| 重仓占比 | 7 | 20-50%最优 |

#### 稳定性（10 分）

| 评分项 | 满分 | 说明 |
|--------|------|------|
| 信息比率IR | 5 | 主动管理能力 |
| 收益一致性 | 5 | 滚动收益正比例 |

#### 综合因素（15 分）

| 评分项 | 满分 | 说明 |
|--------|------|------|
| 基金规模 | 5 | 2-100亿满分 |
| 经理年限 | 5 | ≥7年满分 |
| 晨星评级 | 5 | 评级×1分 |

### 评级标准

| 总分 | 评级 |
|------|------|
| ≥85 | 优秀 |
| ≥70 | 良好 |
| ≥55 | 中等 |
| ≥40 | 较差 |
| <40 | 差 |

## 数据来源

数据来自[天天基金网](https://fund.eastmoney.com/)，包括：

- 基金基本信息（名称、类型、成立日期）
- 业绩数据（近 1 年/3 年收益率、夏普比率）
- 净值数据（用于计算最大回撤、波动率、索提诺比率、Alpha、Beta、VaR 等）
- 基金详情（规模、基金经理任职年限、管理费率、托管费率）
- 持仓数据（重仓股、行业分布）
- 指数估值数据（PE/PB 分位数，来自蛋卷基金）

## 环境变量

| 变量 | 说明 |
|------|------|
| `LARK_WEBHOOK_URL` | 飞书机器人 Webhook URL，用于 `--lark` 参数 |

## 免责声明

本工具仅供学习和参考使用，不构成任何投资建议。基金投资有风险，投资需谨慎。评分模型为简化模型，不能完全反映基金的实际表现和未来走势。
