import chalk from 'chalk';
import { sendLarkNotification, getLarkWebhookUrl } from '../notifiers/sendLarkNotification.js';
import type { formatLarkFundAnalysis } from '../notifiers/larkFormatter.js';

export function handleError(err: unknown, code: string): void {
  if (err instanceof Error) {
    if (err.message.includes('timeout') || err.message.includes('ECONNREFUSED')) {
      console.log(chalk.red(`网络请求超时，请检查网络连接后重试`));
    } else if (err.message.includes('404') || err.message.includes('Request failed')) {
      console.log(chalk.red(`基金代码 ${code} 无效或未找到`));
    } else {
      console.log(chalk.red(`错误: ${err.message}`));
    }
  } else {
    console.log(chalk.red(`未知错误`));
  }
  process.exitCode = 1;
}

export async function sendToLark(larkOpt: string | true, message: ReturnType<typeof formatLarkFundAnalysis>): Promise<void> {
  const url = getLarkWebhookUrl(typeof larkOpt === 'string' ? larkOpt : undefined);
  if (!url) {
    console.log(chalk.yellow('未配置飞书 Webhook URL，跳过通知'));
    return;
  }
  console.log(chalk.gray('正在发送飞书通知 ...'));
  const result = await sendLarkNotification(url, message);
  if (result.success) {
    console.log(chalk.green('✓ 飞书通知已发送'));
  } else {
    console.log(chalk.red(`✗ 飞书通知失败: ${result.error}`));
  }
}
