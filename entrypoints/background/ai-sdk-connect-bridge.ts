import { convertToModelMessages, streamText, type UIMessageChunk } from 'ai';
import { browser } from 'wxt/browser';
import {
  AI_SDK_CONNECT_BRIDGE_PORT,
  type AiSdkConnectBridgeClientMessage,
  type AiSdkConnectBridgeRequest,
  type AiSdkConnectBridgeServerMessage,
} from '@/lib/ai-sdk-connect-bridge';
import { createLanguageModelFromConfig } from '@/lib/model-provider';
import { isTrustedSender } from '@/lib/background-trust';
import { getModelConfigById } from '@/lib/model-settings-storage';
import { classifySummaryError } from '@/lib/error-taxonomy';

import { createLogger } from '@/lib/logger';
import { SUMMARY_TIMING_ENABLED, timingNow } from '@/lib/summary-timing';
import {
  PROVIDER_IDLE_TIMEOUT_MS,
  createIdleWatchdog,
} from '@/lib/idle-timeout';
import { serviceWorkerStartedAt, tokenizerLoadedAt } from './timing-bg';

const logger = createLogger('background:ai-sdk-connect-bridge');

// Bridges AI SDK UI's custom transport to AI SDK Core inside the background
// worker through the browser extension runtime.onConnect port API.
export function registerAiSdkConnectBridge() {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== AI_SDK_CONNECT_BRIDGE_PORT) {
      return;
    }

    // The port runs an LLM request with the user's key and a caller-supplied
    // system prompt, so it accepts connections only from this extension.
    if (!isTrustedSender(port.sender)) {
      logger.warn('[AI SDK Bridge] Rejected a connection from an untrusted sender');
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
      void streamMessages(frame, abortController, postMessage, timingMarks).finally(
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
  controller: AbortController,
  postMessage: (message: AiSdkConnectBridgeServerMessage) => void,
  timingMarks: Record<string, number>,
) {
  const abortSignal = controller.signal;
  // Development-build timing instrumentation, see lib/summary-timing.ts.
  const mark = (name: string) => {
    timingMarks[name] ??= timingNow();
  };
  let firstSent = false;
  let finalSent = false;
  let streamFailed = false;

  // A provider that accepts the connection and then goes quiet (wedged proxy,
  // saturated local model, silently dropped packets) produces no error, no
  // chunk and no disconnect: the panel would spin forever and the error
  // taxonomy's timeout copy would be unreachable. The watchdog aborts the
  // stream and reports a message the classifier maps to `timeout`.
  const watchdog = createIdleWatchdog(PROVIDER_IDLE_TIMEOUT_MS, () => {
    if (streamFailed || abortSignal.aborted) return;
    streamFailed = true;
    controller.abort();
    postErrorFrame(
      new Error(
        `Request timed out: no response from the provider for ${Math.round(PROVIDER_IDLE_TIMEOUT_MS / 1000)}s.`,
      ),
      postMessage,
    );
  });
  const send = (message: AiSdkConnectBridgeServerMessage) => {
    watchdog.reset();
    postMessage(message);
  };

  const sendTiming = (final: boolean) => {
    if (!SUMMARY_TIMING_ENABLED) return;
    if (final ? finalSent : firstSent || finalSent) return;
    if (final) finalSent = true;
    else firstSent = true;
    const marks: Record<string, number> = { ...timingMarks, '后台 Service Worker 启动': serviceWorkerStartedAt };
    if (tokenizerLoadedAt !== null) marks['后台分词器加载完成'] = tokenizerLoadedAt;
    send({ type: 'timing', marks, final });
  };

  watchdog.reset();
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
        logger.error('[AI SDK Bridge] streamText onError:', errorForLog(streamError));
        postErrorFrame(streamError, send);
        // Only mark the stream as failed once the frame went out, so an
        // unexpected throw here can still be retried by the outer catch.
        streamFailed = true;
      },
    });
    mark('后台发起模型请求');
    logger.debug(`[AI SDK Bridge streamMessages] streamText called, beginning iteration...`);

    let chunkCount = 0;
    // The UI stream always emits `start` / `finish` bookkeeping frames, so a
    // frame count can never distinguish "the model answered" from "the model
    // returned nothing". Only real content counts.
    let sawContent = false;
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
        logger.error('[AI SDK Bridge] Error chunk from UI stream:', errorForLog(rawError));
        // The UI stream has already terminated: deliver one classified error
        // frame (keeping status/code when the original error object is
        // available) instead of forwarding the raw UI error chunk.
        const errorObject =
          rawError instanceof Error
            ? rawError
            : new Error(String(rawError ?? 'No output was generated by the model.'));
        streamFailed = true;
        postErrorFrame(errorObject, send);
        break;
      }

      // `start-step` is emitted once the provider's HTTP response has begun,
      // so it approximates time-to-response-headers.
      if (processedChunk.type === 'start-step') mark('后台模型开始响应 (start-step)');
      if (processedChunk.type === 'reasoning-delta') mark('后台收到首个推理片段');
      if (processedChunk.type === 'text-delta') mark('后台收到首个正文片段');

      if (
        (processedChunk.type === 'text-delta' && processedChunk.delta) ||
        (processedChunk.type === 'reasoning-delta' && processedChunk.delta)
      ) {
        sawContent = true;
      }

      send({
        type: 'chunk',
        chunk: processedChunk,
      });

      if (processedChunk.type === 'text-delta') sendTiming(false);
    }
    sendTiming(true);

    logger.debug(`[AI SDK Bridge streamMessages] Finished iterating stream. Total chunks: ${chunkCount}`);
    if (!streamFailed && !sawContent) {
      // A stream that produced neither text nor reasoning -- only the start /
      // finish bookkeeping frames -- must not be reported as a successful
      // summary: the panel would flip to "already summarized" with an empty
      // message, hide the summarize button, and persist that empty message.
      logger.error('[AI SDK Bridge] Stream finished without any content chunk.');
      streamFailed = true;
      if (!abortSignal.aborted) {
        postErrorFrame(new Error('No output was generated by the model.'), send);
      }
    } else if (!streamFailed) {
      send({ type: 'done' });
    }
  } catch (error) {
    if (streamFailed) {
      logger.debug('[AI SDK Bridge streamMessages] Error already forwarded via onError; skipping duplicate.');
      return;
    }

    logger.error(`[AI SDK Bridge streamMessages] Error occurred:`, errorForLog(error));
    if (abortSignal.aborted) {
      logger.debug(`[AI SDK Bridge streamMessages] Aborted, ignoring error.`);
      return;
    }

    postErrorFrame(error, send);
  } finally {
    watchdog.dispose();
  }
}

/**
 * Console-safe projection of whatever a provider threw.
 *
 * `APICallError` carries the whole request body (the rendered prompt, i.e. the
 * page text) in `requestBodyValues` and the provider's raw response in
 * `responseBody`; logging the error object would drop both into the service
 * worker console. Only the identifying fields are kept.
 */
function errorForLog(error: unknown) {
  const e = error as {
    name?: string;
    statusCode?: number;
    status?: number;
    message?: string;
  };

  return {
    name: typeof e?.name === 'string' ? e.name : typeof error,
    status: e?.statusCode ?? e?.status,
    message:
      typeof e?.message === 'string'
        ? e.message.slice(0, 300)
        : String(error).slice(0, 300),
  };
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

    // Plain-text bodies (unparseable JSON) can still carry the provider's own
    // wording, so a short slice is kept. HTML is skipped as the file comment
    // promises: a Cloudflare/nginx error page is noise in the panel, and this
    // message is the only path by which provider response bytes reach the
    // content script.
    if (rawBody && !rawBody.trimStart().startsWith('<')) {
      const truncated = rawBody.length > 300 ? rawBody.slice(0, 300) + '…' : rawBody;
      return `[HTTP ${status}] ${truncated}`;
    }
    return `[HTTP ${status}] ${error.message || 'Request failed'}`;
  }

  return error.message;
}
