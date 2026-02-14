import axios from 'axios';

export interface LarkMessage {
  msg_type: 'interactive';
  card: LarkCard;
}

export interface LarkCard {
  header: { title: { tag: string; content: string }; template?: string };
  elements: LarkCardElement[];
}

type LarkCardElement =
  | { tag: 'div'; text: { tag: string; content: string } }
  | { tag: 'hr' }
  | { tag: 'note'; elements: { tag: string; content: string }[] };

/** @entry 发送飞书 Webhook 通知 */
export async function sendLarkNotification(
  webhookUrl: string,
  message: LarkMessage,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await axios.post(webhookUrl, message, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10_000,
    });

    if (res.data?.code === 0 || res.data?.StatusCode === 0) {
      return { success: true };
    }

    return { success: false, error: res.data?.msg || JSON.stringify(res.data) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    return { success: false, error: msg };
  }
}

/** 获取飞书 Webhook URL，优先从参数传入，其次从环境变量 */
export function getLarkWebhookUrl(url?: string): string | null {
  return url || process.env.LARK_WEBHOOK_URL || null;
}
