import { InterAgentMessage } from '../types/sessionTree';

export interface SendMessageOptions {
  senderId: string;
  targetId: string;
  text: string;
  replyToId?: string;
}

export interface MessageBusDelivery {
  message: InterAgentMessage;
  formattedText: string;
}

export class InterAgentMessageBus {
  private messages: InterAgentMessage[] = [];
  private lastSentTime: Map<string, number> = new Map(); // sender->target pair key to timestamp
  private rateLimitMs: number = 10000; // 10s budget per sender->target pair

  constructor(initialMessages: InterAgentMessage[] = []) {
    this.messages = [...initialMessages];
  }

  public getMessages(): InterAgentMessage[] {
    return [...this.messages];
  }

  public setMessages(msgs: InterAgentMessage[]) {
    this.messages = [...msgs];
  }

  private pairKey(senderId: string, targetId: string): string {
    return `${senderId}-->${targetId}`;
  }

  public canSend(senderId: string, targetId: string): { allowed: boolean; retryAfterMs?: number } {
    const key = this.pairKey(senderId, targetId);
    const lastTime = this.lastSentTime.get(key);
    if (!lastTime) return { allowed: true };

    const elapsed = Date.now() - lastTime;
    if (elapsed < this.rateLimitMs) {
      return { allowed: false, retryAfterMs: this.rateLimitMs - elapsed };
    }
    return { allowed: true };
  }

  public queueMessage(opts: SendMessageOptions): { success: boolean; message?: InterAgentMessage; error?: string } {
    const check = this.canSend(opts.senderId, opts.targetId);
    if (!check.allowed) {
      return {
        success: false,
        error: `Rate limited: wait ${Math.ceil((check.retryAfterMs ?? 0) / 1000)}s before messaging this target again`,
      };
    }

    const nonce = Math.random().toString(36).substring(2, 10);
    const message: InterAgentMessage = {
      id: `msg-${Date.now()}-${nonce}`,
      nonce,
      senderId: opts.senderId,
      targetId: opts.targetId,
      text: opts.text,
      createdAt: Date.now(),
      delivered: false,
      replyToId: opts.replyToId,
    };

    this.messages.push(message);
    this.lastSentTime.set(this.pairKey(opts.senderId, opts.targetId), Date.now());

    return { success: true, message };
  }

  /**
   * Evaluates pending messages for an idle target node and marks them delivered.
   */
  public deliverPending(targetNodeId: string, isTargetIdle: boolean): MessageBusDelivery[] {
    if (!isTargetIdle) return [];

    const undelivered = this.messages.filter(
      (m) => m.targetId === targetNodeId && !m.delivered
    );

    const deliveries: MessageBusDelivery[] = [];

    for (const msg of undelivered) {
      msg.delivered = true;
      const formatted = `--- NODETERM MESSAGE ${msg.nonce} ---\nreply-to: ${msg.senderId}\n\n${msg.text}\n--- END MESSAGE ---`;
      deliveries.push({
        message: msg,
        formattedText: formatted,
      });
    }

    return deliveries;
  }
}
