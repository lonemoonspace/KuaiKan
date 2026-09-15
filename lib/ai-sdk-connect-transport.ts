import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { browser } from 'wxt/browser';
import {
  AI_SDK_CONNECT_BRIDGE_PORT,
  type AiSdkConnectBridgeClientMessage,
  type AiSdkConnectBridgeServerMessage,
} from '@/lib/ai-sdk-connect-bridge';
import { markTiming, mergeBackgroundTiming } from '@/lib/summary-timing';

type AiSdkConnectTransportOptions = {
  getModelConfigId?: () => string | null;
  getSystemMessage?: () => string | null;
};

function createRequestId(): string {
  // crypto.randomUUID is only exposed in secure contexts; on http:// pages a
  // content script's `crypto.randomUUID` may be undefined, so fall back to a
  // UUID built from crypto.getRandomValues (available everywhere).
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class AiSdkConnectTransport implements ChatTransport<UIMessage> {
  constructor(private readonly options: AiSdkConnectTransportOptions = {}) {}

  async sendMessages({
    abortSignal,
    chatId,
    messages,
    trigger,
    messageId,
  }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    const requestId = createRequestId();
    const port = browser.runtime.connect({
      name: AI_SDK_CONNECT_BRIDGE_PORT,
    });

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        let closed = false;
        let aborted = false;

        const closePort = () => {
          port.onMessage.removeListener(onMessage);
          port.onDisconnect.removeListener(onDisconnect);
          abortSignal?.removeEventListener('abort', onAbort);

          try {
            port.disconnect();
          } catch {
            // The background side may have already closed the port.
          }
        };

        const closeStream = () => {
          if (closed) return;

          closed = true;
          closePort();
          controller.close();
        };

        const errorStream = (frame: {
          message: string;
          code?: string;
          status?: number;
          retryable?: boolean;
        }) => {
          if (closed) return;

          closed = true;
          closePort();
          const err = new Error(frame.message) as Error & {
            code?: string;
            status?: number;
            retryable?: boolean;
          };
          if (frame.code) err.code = frame.code;
          if (typeof frame.status === 'number') err.status = frame.status;
          if (typeof frame.retryable === 'boolean') {
            err.retryable = frame.retryable;
          }
          controller.error(err);
        };

        const onMessage = (message: unknown) => {
          const frame = message as AiSdkConnectBridgeServerMessage;

          if (frame.type === 'chunk') {
            markTiming('前台收到首个数据帧');
            if (frame.chunk.type === 'reasoning-delta') markTiming('前台收到首个推理片段');
            if (frame.chunk.type === 'text-delta') markTiming('前台收到首个正文片段');
            controller.enqueue(frame.chunk);
            return;
          }

          if (frame.type === 'timing') {
            mergeBackgroundTiming(frame.marks, frame.final);
            return;
          }

          if (frame.type === 'done') {
            closeStream();
            return;
          }

          if (frame.type === 'error') {
            errorStream({
              message: frame.message,
              code: frame.code,
              status: frame.status,
              retryable: frame.retryable,
            });
          }
        };

        const onDisconnect = () => {
          if (aborted || closed) return;

          errorStream({
            message: 'AI SDK connect bridge disconnected before completion.',
          });
        };

        const onAbort = () => {
          aborted = true;

          try {
            port.postMessage({
              type: 'abort',
            } satisfies AiSdkConnectBridgeClientMessage);
          } catch {
            // Ignore errors if port is already closed.
          }
          closeStream();
        };

        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(onDisconnect);
        abortSignal?.addEventListener('abort', onAbort, { once: true });

        if (abortSignal?.aborted) {
          onAbort();
          return;
        }

        port.postMessage({
          type: 'send-messages',
          requestId,
          chatId,
          messageId,
          messages,
          modelConfigId: this.options.getModelConfigId?.() ?? null,
          system: this.options.getSystemMessage?.() ?? undefined,
          trigger,
        } satisfies AiSdkConnectBridgeClientMessage);
        markTiming('前台请求已发往后台');
      },
      cancel() {
        try {
          port.postMessage({
            type: 'abort',
          } satisfies AiSdkConnectBridgeClientMessage);
        } catch {
          // ignore
        } finally {
          port.disconnect();
        }
      },
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
