#!/usr/bin/env node
/** @entry CLI - 基金分析工具命令行入口 */
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { registerAnalyzeCommand, registerBatchCommand } from './commands/analyzeCommand.js';
import { registerCompareCommand } from './commands/compareCommand.js';
import { registerDetailCommand, registerBacktestCommand, registerHoldingsCommand } from './commands/detailCommand.js';
import { registerNotifyTestCommand, registerScoringBacktestCommand } from './commands/scoringBacktestCommand.js';
import { registerAnalyzeIndexCommand } from './commands/analyzeIndexCommand.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as { version: string };

const program = new Command();

program
  .name('fund-analyzer')
  .description('基金分析工具 - 评分、对比、批量分析')
  .version(pkg.version);

registerAnalyzeCommand(program);
registerBatchCommand(program);
registerCompareCommand(program);
registerDetailCommand(program);
registerBacktestCommand(program);
registerHoldingsCommand(program);
registerNotifyTestCommand(program);
registerScoringBacktestCommand(program);
registerAnalyzeIndexCommand(program);

program.parse();
