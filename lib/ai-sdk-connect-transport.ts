import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { browser } from 'wxt/browser';
import {
  AI_SDK_CONNECT_BRIDGE_PORT,
  type AiSdkConnectBridgeClientMessage,
  type AiSdkConnectBridgeServerMessage,
} from '@/lib/ai-sdk-connect-bridge';
import { markTiming, mergeBackgroundTiming } from '@/lib/summary-timing';
import { createLogger } from '@/lib/logger';

const logger = createLogger('content:ai-sdk-transport');

/**
 * Both messages below reach the user verbatim: `classifySummaryError` has no
 * code for "the bridge itself is gone", so it falls through to `unknown` and
 * the panel toasts the raw text. That is why they are worded for the user, in
 * the UI language, instead of being an English developer note.
 */
const BRIDGE_DISCONNECTED_MESSAGE = '与后台服务的连接已断开，请重试。';
const BRIDGE_UNREACHABLE_MESSAGE = '无法连接后台服务，请重试。';

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

    // The listeners are registered inside `start`, but `cancel` is a sibling
    // property of the underlying source object — it cannot see anything
    // declared in `start`'s scope. Keeping the teardown state out here is what
    // lets both exits remove the listeners; `cancel` used to call
    // `port.disconnect()` alone and rely on Chrome re-dispatching
    // `onDisconnect` to the *same* port object, which is not guaranteed.
    let closed = false;
    let removeListeners: () => void = () => {};

    const closePort = () => {
      removeListeners();

      try {
        port.disconnect();
      } catch {
        // The background side may have already closed the port.
      }
    };

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        let aborted = false;

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
          // A frame that is not an object (or has no string discriminator) is
          // not ours; reading `.type` off null/undefined would throw inside the
          // port listener and leave the stream hanging with no error event.
          if (typeof message !== 'object' || message === null) return;
          const frame = message as AiSdkConnectBridgeServerMessage;
          if (typeof frame.type !== 'string') return;

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
            return;
          }

          // A frame type this build does not know about (background and content
          // script from different versions, or a frame added later) would
          // otherwise be dropped without a trace and be undebuggable from here.
          logger.warn('[AiSdkConnectTransport] Ignoring unknown bridge frame:', frame);
        };

        const onDisconnect = () => {
          if (aborted || closed) return;

          errorStream({
            message: BRIDGE_DISCONNECTED_MESSAGE,
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

        removeListeners = () => {
          port.onMessage.removeListener(onMessage);
          port.onDisconnect.removeListener(onDisconnect);
          abortSignal?.removeEventListener('abort', onAbort);
        };

        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(onDisconnect);
        abortSignal?.addEventListener('abort', onAbort, { once: true });

        if (abortSignal?.aborted) {
          onAbort();
          return;
        }

        try {
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
        } catch (error) {
          // `port.postMessage` throws when the other end is already gone (the
          // service worker was evicted, or the extension reloaded under an open
          // page). Letting it escape would error the stream through the
          // ReadableStream constructor *without* running any teardown, leaving
          // the listeners registered on a dead port.
          logger.warn('[AiSdkConnectTransport] Failed to send the request frame:', error);
          errorStream({ message: BRIDGE_UNREACHABLE_MESSAGE });
          return;
        }
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
          // Tear down through the same path as every other exit: a bare
          // `port.disconnect()` left `onMessage`/`onDisconnect`/the abort
          // listener registered (only the mock happens to re-fire
          // onDisconnect on disconnect) and never marked the stream closed.
          closed = true;
          closePort();
        }
      },
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
