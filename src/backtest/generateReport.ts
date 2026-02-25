/**
 * 回测HTML报告生成器
 * 生成包含散点图、分组箱线图的可视化HTML报告
 */
import type { ScoringBacktestReport } from './types.js';

/** 生成评分预测回测HTML报告 */
export function generateBacktestHTML(report: ScoringBacktestReport): string {
  const { results, correlation, scoreQuintileReturns, summary } = report;

  // 准备散点图数据：评分 vs 各前瞻期收益
  const periods = Object.keys(correlation);
  const scatterDatasets = periods.map(period => {
    const points = results
      .map(r => {
        const fwd = r.forwardReturns.find(f => f.period === period);
        return fwd && !isNaN(fwd.return)
          ? { x: r.score, y: fwd.return, label: `${r.fundName}(${r.evalDate})` }
          : null;
      })
      .filter((p): p is { x: number; y: number; label: string } => p !== null);
    return { period, points };
  });

  // 准备各维度评分数据（从 scoreDetails）
  const dimensionNames = results.length > 0
    ? results[0].scoreDetails.map(d => d.item)
    : [];

  const dimensionScatterData = periods.map(period => {
    return dimensionNames.map(dim => {
      const points = results
        .map(r => {
          const detail = r.scoreDetails.find(d => d.item === dim);
          const fwd = r.forwardReturns.find(f => f.period === period);
          if (!detail || !fwd || isNaN(fwd.return)) return null;
          return { x: detail.score, y: fwd.return };
        })
        .filter((p): p is { x: number; y: number } => p !== null);
      return { dimension: dim, points };
    });
  });

  // 准备五分位箱线图数据
  const quintileData = scoreQuintileReturns.map(sq => ({
    period: sq.period,
    labels: sq.quintiles.map(q => q.label),
    avgReturns: sq.quintiles.map(q => q.avgReturn),
    avgScores: sq.quintiles.map(q => q.avgScore),
    counts: sq.quintiles.map(q => q.count),
  }));

  // 生成各基金时间序列数据
  const fundCodes = [...new Set(results.map(r => r.fundCode))];
  const timeSeriesData = fundCodes.map(code => {
    const fundResults = results.filter(r => r.fundCode === code).sort((a, b) => a.evalDate.localeCompare(b.evalDate));
    return {
      fundCode: code,
      fundName: fundResults[0]?.fundName ?? code,
      dates: fundResults.map(r => r.evalDate),
      scores: fundResults.map(r => r.score),
    };
  });

  const colors = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>评分预测回测报告</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 20px; }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { text-align: center; margin-bottom: 8px; color: #1a1a1a; }
  .subtitle { text-align: center; color: #666; margin-bottom: 24px; }
  .card { background: #fff; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .card h2 { color: #1a1a1a; margin-bottom: 16px; font-size: 18px; border-bottom: 2px solid #4e79a7; padding-bottom: 8px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .stat { background: #f8f9fa; padding: 12px; border-radius: 6px; text-align: center; }
  .stat .value { font-size: 24px; font-weight: bold; color: #4e79a7; }
  .stat .label { font-size: 12px; color: #666; margin-top: 4px; }
  .corr-table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  .corr-table th, .corr-table td { padding: 8px 12px; border: 1px solid #e0e0e0; text-align: center; }
  .corr-table th { background: #f0f0f0; font-weight: 600; }
  .corr-positive { color: #2e7d32; font-weight: bold; }
  .corr-negative { color: #c62828; font-weight: bold; }
  .corr-weak { color: #999; }
  .chart-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 20px; }
  .chart-box { position: relative; height: 350px; }
  .detail-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .detail-table th, .detail-table td { padding: 6px 8px; border: 1px solid #e0e0e0; text-align: center; }
  .detail-table th { background: #f0f0f0; font-weight: 600; position: sticky; top: 0; }
  .detail-table tr:nth-child(even) { background: #fafafa; }
  .ret-pos { color: #2e7d32; }
  .ret-neg { color: #c62828; }
  .scrollable { max-height: 500px; overflow-y: auto; }
</style>
</head>
<body>
<div class="container">
  <h1>评分预测回测报告</h1>
  <p class="subtitle">评估日期范围: ${summary.dateRange} | 基金数: ${summary.fundCount} | 样本数: ${summary.totalSamples}</p>

  <!-- 统计概览 -->
  <div class="card">
    <h2>统计概览</h2>
    <div class="stats">
      <div class="stat"><div class="value">${summary.totalSamples}</div><div class="label">总样本数</div></div>
      <div class="stat"><div class="value">${summary.fundCount}</div><div class="label">基金数量</div></div>
      <div class="stat"><div class="value">${periods.map(p => p).join(', ')}</div><div class="label">前瞻期</div></div>
    </div>

    <table class="corr-table">
      <tr><th>前瞻期</th><th>Pearson</th><th>Spearman</th><th>样本量</th></tr>
      ${periods.map(p => {
        const c = correlation[p];
        const pClass = Math.abs(c.pearson) >= 0.3 ? 'corr-positive' : Math.abs(c.pearson) >= 0.1 ? '' : 'corr-weak';
        const sClass = Math.abs(c.spearman) >= 0.3 ? 'corr-positive' : Math.abs(c.spearman) >= 0.1 ? '' : 'corr-weak';
        return `<tr><td>${p}</td><td class="${pClass}">${c.pearson.toFixed(4)}</td><td class="${sClass}">${c.spearman.toFixed(4)}</td><td>${c.sampleSize}</td></tr>`;
      }).join('\n      ')}
    </table>
  </div>

  <!-- 评分 vs 收益散点图 -->
  <div class="card">
    <h2>评分 vs 实际收益散点图</h2>
    <div class="chart-row">
      ${scatterDatasets.map((ds, i) => `
      <div class="chart-box">
        <canvas id="scatter-${i}"></canvas>
      </div>`).join('')}
    </div>
  </div>

  <!-- 各维度评分 vs 收益 -->
  ${periods.map((period, pi) => `
  <div class="card">
    <h2>各维度评分 vs 收益 (前瞻${period})</h2>
    <div class="chart-row">
      ${dimensionScatterData[pi].map((ds, di) => `
      <div class="chart-box">
        <canvas id="dim-${pi}-${di}"></canvas>
      </div>`).join('')}
    </div>
  </div>`).join('')}

  <!-- 五分位收益分析 -->
  <div class="card">
    <h2>评分分组收益分析</h2>
    <div class="chart-row">
      ${quintileData.map((qd, i) => `
      <div class="chart-box">
        <canvas id="quintile-${i}"></canvas>
      </div>`).join('')}
    </div>
  </div>

  <!-- 评分时间序列 -->
  ${timeSeriesData.length > 0 ? `
  <div class="card">
    <h2>评分时间序列</h2>
    <div class="chart-box">
      <canvas id="timeseries"></canvas>
    </div>
  </div>` : ''}

  <!-- 详细数据表 -->
  <div class="card">
    <h2>各时点评分详情</h2>
    <div class="scrollable">
      <table class="detail-table">
        <tr>
          <th>日期</th><th>基金</th><th>评分</th>
          ${dimensionNames.map(d => `<th>${d}</th>`).join('')}
          ${periods.map(p => `<th>前瞻${p}</th>`).join('')}
        </tr>
        ${results.map(r => {
          const fwdCells = periods.map(p => {
            const fwd = r.forwardReturns.find(f => f.period === p);
            if (!fwd || isNaN(fwd.return)) return '<td>—</td>';
            const cls = fwd.return >= 0 ? 'ret-pos' : 'ret-neg';
            return `<td class="${cls}">${fwd.return >= 0 ? '+' : ''}${fwd.return.toFixed(2)}%</td>`;
          }).join('');
          const dimCells = dimensionNames.map(dim => {
            const d = r.scoreDetails.find(dd => dd.item === dim);
            return d ? `<td>${d.score}/${d.maxScore}</td>` : '<td>—</td>';
          }).join('');
          return `<tr><td>${r.evalDate}</td><td>${r.fundName}(${r.fundCode})</td><td><b>${r.score.toFixed(1)}</b></td>${dimCells}${fwdCells}</tr>`;
        }).join('\n        ')}
      </table>
    </div>
  </div>
</div>

<script>
// 散点图数据
const scatterDatasets = ${JSON.stringify(scatterDatasets)};
const colors = ${JSON.stringify(colors)};

scatterDatasets.forEach((ds, i) => {
  const ctx = document.getElementById('scatter-' + i);
  if (!ctx) return;
  new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [{
        label: '评分 vs 收益(' + ds.period + ')',
        data: ds.points.map(p => ({ x: p.x, y: p.y })),
        backgroundColor: 'rgba(78, 121, 167, 0.5)',
        borderColor: '#4e79a7',
        pointRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: '评分 vs 前瞻' + ds.period + '收益' },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const p = ds.points[ctx.dataIndex];
              return p ? p.label + ' 评分:' + p.x.toFixed(1) + ' 收益:' + p.y.toFixed(2) + '%' : '';
            }
          }
        }
      },
      scales: {
        x: { title: { display: true, text: '评分' } },
        y: { title: { display: true, text: '收益(%)' } },
      }
    }
  });
});

// 维度散点图
const dimData = ${JSON.stringify(dimensionScatterData)};
dimData.forEach((periodDims, pi) => {
  periodDims.forEach((ds, di) => {
    const ctx = document.getElementById('dim-' + pi + '-' + di);
    if (!ctx || ds.points.length === 0) return;
    new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [{
          label: ds.dimension,
          data: ds.points,
          backgroundColor: colors[di % colors.length] + '80',
          borderColor: colors[di % colors.length],
          pointRadius: 3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { title: { display: true, text: ds.dimension + ' vs 收益' } },
        scales: {
          x: { title: { display: true, text: ds.dimension + '得分' } },
          y: { title: { display: true, text: '收益(%)' } },
        }
      }
    });
  });
});

// 五分位柱状图
const quintileData = ${JSON.stringify(quintileData)};
quintileData.forEach((qd, i) => {
  const ctx = document.getElementById('quintile-' + i);
  if (!ctx || qd.labels.length === 0) return;
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: qd.labels,
      datasets: [{
        label: '平均收益(%)',
        data: qd.avgReturns,
        backgroundColor: qd.avgReturns.map(r => r >= 0 ? 'rgba(46, 125, 50, 0.6)' : 'rgba(198, 40, 40, 0.6)'),
        borderColor: qd.avgReturns.map(r => r >= 0 ? '#2e7d32' : '#c62828'),
        borderWidth: 1,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: '五分位平均收益 (前瞻' + qd.period + ')' },
        tooltip: {
          callbacks: {
            afterLabel: (ctx) => '平均评分: ' + qd.avgScores[ctx.dataIndex].toFixed(1) + ' | 样本: ' + qd.counts[ctx.dataIndex]
          }
        }
      },
      scales: {
        y: { title: { display: true, text: '平均收益(%)' } }
      }
    }
  });
});

// 时间序列
const tsData = ${JSON.stringify(timeSeriesData)};
const tsCtx = document.getElementById('timeseries');
if (tsCtx && tsData.length > 0) {
  new Chart(tsCtx, {
    type: 'line',
    data: {
      datasets: tsData.map((fund, i) => ({
        label: fund.fundName,
        data: fund.dates.map((d, j) => ({ x: d, y: fund.scores[j] })),
        borderColor: colors[i % colors.length],
        backgroundColor: colors[i % colors.length] + '20',
        fill: false,
        tension: 0.3,
        pointRadius: 3,
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { title: { display: true, text: '各基金评分走势' } },
      scales: {
        x: { type: 'category', title: { display: true, text: '日期' } },
        y: { title: { display: true, text: '评分' }, min: 0, max: 100 },
      }
    }
  });
}
</script>
</body>
</html>`;
}
