import { convertToModelMessages, streamText, type UIMessageChunk } from 'ai';
import { browser } from 'wxt/browser';
import {
  AI_SDK_CONNECT_BRIDGE_PORT,
  type AiSdkConnectBridgeClientMessage,
  type AiSdkConnectBridgeRequest,
  type AiSdkConnectBridgeServerMessage,
} from '@/lib/ai-sdk-connect-bridge';
import { createLanguageModelFromConfig } from '@/lib/model-provider';
import { getModelConfigById } from '@/lib/model-settings-storage';
import { classifySummaryError } from '@/lib/error-taxonomy';

import { createLogger } from '@/lib/logger';
import { SUMMARY_TIMING_ENABLED, timingNow } from '@/lib/summary-timing';
import { serviceWorkerStartedAt, tokenizerLoadedAt } from './timing-bg';

const logger = createLogger('background:ai-sdk-connect-bridge');

// Bridges AI SDK UI's custom transport to AI SDK Core inside the background
// worker through the browser extension runtime.onConnect port API.
export function registerAiSdkConnectBridge() {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== AI_SDK_CONNECT_BRIDGE_PORT) {
      return;
    }

    logger.debug(`[AI SDK Bridge] Port connected: ${port.name}`);

    let requestId = 'pending';
    const abortController = new AbortController();
    let started = false;
    let finished = false;

    const postMessage = (message: AiSdkConnectBridgeServerMessage) => {
      if (finished) return;

      try {
        logger.debug(`[AI SDK Bridge] Post message (requestId: ${requestId}):`, message.type);
        port.postMessage(message);
      } catch (e) {
        logger.error(`[AI SDK Bridge] Error posting message (requestId: ${requestId}):`, e);
        abortController.abort();
        finish();
      }
    };

    const finish = () => {
      if (finished) return;

      logger.debug(`[AI SDK Bridge] Finishing connection (requestId: ${requestId})`);
      finished = true;
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      port.disconnect();
    };

    const onDisconnect = () => {
      logger.debug(`[AI SDK Bridge] Port disconnected (requestId: ${requestId})`);
      abortController.abort();
      finish();
    };

    const onMessage = (message: unknown) => {
      const frame = message as AiSdkConnectBridgeClientMessage;
      logger.debug(`[AI SDK Bridge] Received message from client:`, frame.type);

      if (frame.type === 'abort') {
        logger.debug(`[AI SDK Bridge] Aborting (requestId: ${requestId})`);
        abortController.abort();
        finish();
        return;
      }

      if (frame.type !== 'send-messages' || started) {
        return;
      }

      started = true;
      const timingMarks: Record<string, number> = { '后台收到请求': timingNow() };
      requestId = frame.requestId;
      logger.debug(`[AI SDK Bridge] Starting stream (requestId: ${requestId})`);
      void streamMessages(frame, abortController.signal, postMessage, timingMarks).finally(
        () => {
          logger.debug(`[AI SDK Bridge] Stream finished (requestId: ${requestId})`);
          finish();
        }
      );
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
  });
}

async function streamMessages(
  request: AiSdkConnectBridgeRequest,
  abortSignal: AbortSignal,
  postMessage: (message: AiSdkConnectBridgeServerMessage) => void,
  timingMarks: Record<string, number>,
) {
  // Development-build timing instrumentation, see lib/summary-timing.ts.
  const mark = (name: string) => {
    timingMarks[name] ??= timingNow();
  };
  let firstSent = false;
  let finalSent = false;
  const sendTiming = (final: boolean) => {
    if (!SUMMARY_TIMING_ENABLED) return;
    if (final ? finalSent : firstSent || finalSent) return;
    if (final) finalSent = true;
    else firstSent = true;
    const marks: Record<string, number> = { ...timingMarks, '后台 Service Worker 启动': serviceWorkerStartedAt };
    if (tokenizerLoadedAt !== null) marks['后台分词器加载完成'] = tokenizerLoadedAt;
    postMessage({ type: 'timing', marks, final });
  };

  let streamFailed = false;
  try {
    logger.debug(`[AI SDK Bridge streamMessages] Fetching model config for id: ${request.modelConfigId}`);
    const modelConfig = await getModelConfigById(request.modelConfigId);
    mark('后台读取模型配置完成');

    if (!modelConfig) {
      logger.error(`[AI SDK Bridge streamMessages] Model config not found for id: ${request.modelConfigId}`);
      throw new Error('No model config is available.');
    }

    logger.debug(`[AI SDK Bridge streamMessages] Model config fetched:`, modelConfig.providerId, modelConfig.modelId);
    logger.debug(`[AI SDK Bridge streamMessages] Converting messages to model messages...`);
    const messages = await convertToModelMessages(request.messages);
    mark('后台消息转换完成');
    logger.debug(`[AI SDK Bridge streamMessages] Messages converted. Ready to streamText. Messages count: ${messages.length}`);

    logger.debug(`[AI SDK Bridge streamMessages] Calling streamText...`);
    const result = streamText({
      abortSignal,
      messages: messages,
      allowSystemInMessages: true,
      model: createLanguageModelFromConfig(modelConfig),
      system: request.system,
      onError({ error: streamError }) {
        // streamText catches errors that occur mid-stream and routes them here
        // instead of throwing. The outer try/catch never sees them.
        // Forward explicitly so the frontend actually receives the error.
        if (abortSignal.aborted) {
          logger.debug('[AI SDK Bridge] streamText error ignored after abort.');
          return;
        }
        logger.error('[AI SDK Bridge] streamText onError:', streamError);
        postErrorFrame(streamError, postMessage);
        // Only mark the stream as failed once the frame went out, so an
        // unexpected throw here can still be retried by the outer catch.
        streamFailed = true;
      },
    });
    mark('后台发起模型请求');
    logger.debug(`[AI SDK Bridge streamMessages] streamText called, beginning iteration...`);

    let chunkCount = 0;
    for await (const chunk of result.toUIMessageStream({
      sendReasoning: true,
      messageMetadata: ({ part }) => {
        if (part.type === 'finish') {
          return {
            usage: part.totalUsage ?? null,
          };
        }
        return undefined;
      },
      onError: (streamError) => {
        // Errors surfaced only through the UI stream layer (e.g. empty or
        // unparseable provider output) are delivered as an error chunk below;
        // make sure the chunk carries a real message instead of the SDK's
        // generic "An error occurred.".
        logger.error('[AI SDK Bridge] toUIMessageStream error:', streamError);
        return getErrorMessage(streamError);
      },
    })) {
      chunkCount++;
      if (chunkCount === 1) {
        logger.debug(`[AI SDK Bridge streamMessages] Received first chunk`);
      }

      let processedChunk = chunk as UIMessageChunk;
      if (processedChunk.type === 'error') {
        const anyChunk = processedChunk as any;
        const rawError: unknown = anyChunk.error ?? anyChunk.errorText;
        logger.error('[AI SDK Bridge] Error chunk from UI stream:', rawError);
        // The UI stream has already terminated: deliver one classified error
        // frame (keeping status/code when the original error object is
        // available) instead of forwarding the raw UI error chunk.
        const errorObject =
          rawError instanceof Error
            ? rawError
            : new Error(String(rawError ?? 'No output was generated by the model.'));
        streamFailed = true;
        postErrorFrame(errorObject, postMessage);
        break;
      }

      // `start-step` is emitted once the provider's HTTP response has begun,
      // so it approximates time-to-response-headers.
      if (processedChunk.type === 'start-step') mark('后台模型开始响应 (start-step)');
      if (processedChunk.type === 'reasoning-delta') mark('后台收到首个推理片段');
      if (processedChunk.type === 'text-delta') mark('后台收到首个正文片段');

      postMessage({
        type: 'chunk',
        chunk: processedChunk,
      });

      if (processedChunk.type === 'text-delta') sendTiming(false);
    }
    sendTiming(true);

    logger.debug(`[AI SDK Bridge streamMessages] Finished iterating stream. Total chunks: ${chunkCount}`);
    if (!streamFailed && chunkCount === 0) {
      // A provider stream that ends without emitting anything must not
      // complete silently as if it succeeded.
      logger.error('[AI SDK Bridge] Stream finished without any output chunk.');
      streamFailed = true;
      if (!abortSignal.aborted) {
        postErrorFrame(new Error('No output was generated by the model.'), postMessage);
      }
    } else if (!streamFailed) {
      postMessage({ type: 'done' });
    }
  } catch (error) {
    if (streamFailed) {
      logger.debug('[AI SDK Bridge streamMessages] Error already forwarded via onError; skipping duplicate.');
      return;
    }

    logger.error(`[AI SDK Bridge streamMessages] Error occurred:`, error);
    if (abortSignal.aborted) {
      logger.debug(`[AI SDK Bridge streamMessages] Aborted, ignoring error.`);
      return;
    }

    postErrorFrame(error, postMessage);
  }
}

function postErrorFrame(
  error: unknown,
  postMessage: (message: AiSdkConnectBridgeServerMessage) => void,
) {
  const e = error as Error & {
    statusCode?: number;
    status?: number;
    name?: string;
  };
  const message = getErrorMessage(error);
  const classification = classifySummaryError({
    message,
    name: e?.name ?? (error instanceof Error ? error.name : undefined),
    status: e?.statusCode ?? e?.status,
  });

  postMessage({
    type: 'error',
    message,
    code: classification.code,
    status: classification.status,
    retryable: classification.retryable,
  });
}

/**
 * Extract a concise, human-readable error message from whatever the AI SDK throws.
 *
 * AI SDK structured errors (APICallError) carry `statusCode` and `responseBody`.
 * `responseBody` can be a JSON API error or a raw HTML page (e.g. Cloudflare
 * error pages). We parse JSON to pull the actual API message; HTML bodies are
 * intentionally skipped — they're noise, not signal.
 */
function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const e = error as any;
  const status: number | undefined = e.statusCode ?? e.status;
  const rawBody: string | undefined = e.responseBody ?? e.body;

  if (status !== undefined) {
    // Try to extract a short message from a JSON response body.
    if (rawBody && !rawBody.trimStart().startsWith('<')) {
      try {
        const parsed = JSON.parse(rawBody);
        // Different providers nest the message differently.
        const apiMsg: unknown =
          parsed?.error?.message ??
          parsed?.error?.msg ??
          parsed?.message ??
          (typeof parsed?.error === 'string' ? parsed.error : undefined);
        if (typeof apiMsg === 'string' && apiMsg.length > 0) {
          return `[HTTP ${status}] ${apiMsg}`;
        }
      } catch {
        // Body is not valid JSON — fall through.
      }
    }

    // HTML or unparseable body — truncate to avoid flooding the error display.
    if (rawBody) {
      const truncated = rawBody.length > 300 ? rawBody.slice(0, 300) + '…' : rawBody;
      return `[HTTP ${status}] ${truncated}`;
    }
    return `[HTTP ${status}] ${error.message || 'Request failed'}`;
  }

  return error.message;
}
