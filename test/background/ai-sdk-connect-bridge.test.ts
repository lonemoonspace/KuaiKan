import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AI_SDK_CONNECT_BRIDGE_PORT } from '@/lib/ai-sdk-connect-bridge';
import { PROVIDER_IDLE_TIMEOUT_MS } from '@/lib/idle-timeout';
import { MockPort, __emitConnect, __resetMockRuntime } from '../mocks/wxt-browser';

const { streamTextMock, getModelConfigByIdMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  getModelConfigByIdMock: vi.fn(),
}));

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
  convertToModelMessages: async (messages: unknown) => messages,
}));

vi.mock('@/lib/model-provider', () => ({
  createLanguageModelFromConfig: vi.fn(() => ({ modelId: 'mock-model' })),
}));

vi.mock('@/lib/model-settings-storage', () => ({
  getModelConfigById: (...args: unknown[]) => getModelConfigByIdMock(...args),
}));

import { registerAiSdkConnectBridge } from '@/entrypoints/background/ai-sdk-connect-bridge';

type StreamOptions = { onError?: (error: unknown) => string };

/** A streamText result whose UI stream yields the given chunks. */
function makeStream(chunks: unknown[], before?: () => void) {
  return {
    toUIMessageStream: (_options: StreamOptions = {}) =>
      (async function* generate() {
        before?.();
        for (const chunk of chunks) yield chunk;
      })(),
  };
}

/** A streamText result that never yields until the request is aborted. */
function makeHangingStream(getSignal: () => AbortSignal) {
  return {
    toUIMessageStream: (_options: StreamOptions = {}) =>
      (async function* generate() {
        await new Promise<void>((resolve) => {
          const signal = getSignal();
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      })(),
  };
}

function makePort(name = AI_SDK_CONNECT_BRIDGE_PORT, sender: unknown = { id: 'kuai-kan-test-extension' }) {
  const port = new MockPort();
  port.name = name;
  port.sender = sender;
  return port;
}

function framesOf<T extends string>(port: MockPort, type: T) {
  return port.posted.filter(
    (frame): frame is Record<string, unknown> & { type: T } =>
      typeof frame === 'object' && frame !== null && (frame as { type?: unknown }).type === type,
  );
}

const drain = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const sendMessages = (port: MockPort, requestId = 'req-1') => {
  port.emitMessage({
    type: 'send-messages',
    requestId,
    chatId: 'chat-1',
    messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    modelConfigId: 'cfg-1',
    system: 'You summarize pages.',
  });
};

describe('registerAiSdkConnectBridge', () => {
  beforeEach(() => {
    __resetMockRuntime();
    getModelConfigByIdMock.mockResolvedValue({
      id: 'cfg-1',
      providerId: 'openai',
      modelId: 'gpt-4.1-mini',
    });
    registerAiSdkConnectBridge();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('ignores ports opened under a different name', () => {
    const port = makePort('some-other-port');

    __emitConnect(port);

    expect(port.listenerCount).toBe(0);
    expect(port.disconnected).toBe(false);
  });

  it('closes a port whose sender is not this extension', () => {
    const port = makePort(AI_SDK_CONNECT_BRIDGE_PORT, { id: 'some-website' });

    __emitConnect(port);

    // A rejected sender must not keep a live channel (or its listeners) around.
    expect(port.disconnected).toBe(true);
    expect(port.listenerCount).toBe(0);
    expect(port.posted).toEqual([]);
  });

  it('streams content chunks, sends done, then releases the port', async () => {
    streamTextMock.mockReturnValue(
      makeStream([
        { type: 'start' },
        { type: 'text-delta', delta: 'Hello' },
        { type: 'finish' },
      ]),
    );
    const port = makePort();
    __emitConnect(port);

    sendMessages(port);
    await drain();

    const chunks = framesOf(port, 'chunk').map((frame) => frame.chunk);
    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'text-delta', delta: 'Hello' },
      { type: 'finish' },
    ]);
    expect(framesOf(port, 'done')).toHaveLength(1);
    expect(framesOf(port, 'error')).toHaveLength(0);
    expect(port.disconnected).toBe(true);
    expect(port.listenerCount).toBe(0);
  });

  it('only starts one stream per port even if the client sends two requests', async () => {
    streamTextMock.mockReturnValue(makeStream([{ type: 'text-delta', delta: 'once' }]));
    const port = makePort();
    __emitConnect(port);

    sendMessages(port, 'req-1');
    sendMessages(port, 'req-2');
    await drain();

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(getModelConfigByIdMock).toHaveBeenCalledTimes(1);
  });

  it('reports a stream that produced only bookkeeping frames as an error, never as done', async () => {
    streamTextMock.mockReturnValue(makeStream([{ type: 'start' }, { type: 'finish' }]));
    const port = makePort();
    __emitConnect(port);

    sendMessages(port);
    await drain();

    const errors = framesOf(port, 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('No output was generated by the model.');
    expect(framesOf(port, 'done')).toHaveLength(0);
  });

  it("posts the error chunk's own text, classified, when the UI stream fails", async () => {
    streamTextMock.mockReturnValue(
      makeStream([{ type: 'start' }, { type: 'error', errorText: '429 Too Many Requests' }]),
    );
    const port = makePort();
    __emitConnect(port);

    sendMessages(port);
    await drain();

    const errors = framesOf(port, 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('429 Too Many Requests');
    expect(errors[0].code).toBe('rate-limit');
    expect(errors[0].retryable).toBe(true);
    expect(framesOf(port, 'done')).toHaveLength(0);
  });

  it('does not post a second error frame when streamText.onError already forwarded the failure', async () => {
    let forwarded = false;
    streamTextMock.mockImplementation((args: { onError?: (input: { error: unknown }) => void }) => ({
      toUIMessageStream: () =>
        (async function* generate() {
          // A mid-stream provider failure reaches the bridge through
          // streamText's onError...
          forwarded = true;
          args.onError?.({ error: Object.assign(new Error('rate limited'), { statusCode: 429 }) });
          // ...and then again as an error chunk on the UI stream.
          yield { type: 'error', errorText: 'rate limited' };
        })(),
    }));
    const port = makePort();
    __emitConnect(port);

    sendMessages(port);
    await drain();

    expect(forwarded).toBe(true);
    const errors = framesOf(port, 'error');
    // One failure, one frame: the original error object carries status/code and
    // must not be raced by a second, less informed frame.
    expect(errors).toHaveLength(1);
    expect(errors[0].status).toBe(429);
    expect(errors[0].code).toBe('rate-limit');
  });

  it('reports a missing model config as an error instead of streaming', async () => {
    getModelConfigByIdMock.mockResolvedValue(null);
    const port = makePort();
    __emitConnect(port);

    sendMessages(port);
    await drain();

    expect(streamTextMock).not.toHaveBeenCalled();
    const errors = framesOf(port, 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('没有可用的模型配置，请先在设置中选择模型。');
  });

  it('aborts a silent provider through the idle watchdog and reports a timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    streamTextMock.mockImplementation((args: { abortSignal: AbortSignal }) => {
      signal = args.abortSignal;
      return makeHangingStream(() => args.abortSignal);
    });
    const port = makePort();
    __emitConnect(port);

    sendMessages(port);
    await vi.advanceTimersByTimeAsync(PROVIDER_IDLE_TIMEOUT_MS + 1);
    await drain();

    expect(signal?.aborted).toBe(true);
    const errors = framesOf(port, 'error');
    expect(errors).toHaveLength(1);
    expect(String(errors[0].message)).toContain('timed out');
    expect(errors[0].code).toBe('timeout');
    expect(errors[0].retryable).toBe(true);
  });

  it('stops the stream on an abort frame without reporting an error', async () => {
    let signal: AbortSignal | undefined;
    streamTextMock.mockImplementation((args: { abortSignal: AbortSignal }) => {
      signal = args.abortSignal;
      return makeHangingStream(() => args.abortSignal);
    });
    const port = makePort();
    __emitConnect(port);

    sendMessages(port);
    await drain();
    port.emitMessage({ type: 'abort' });
    await drain();

    expect(signal?.aborted).toBe(true);
    // A user-initiated stop is not a failure: no error frame, and the port is
    // released.
    expect(framesOf(port, 'error')).toHaveLength(0);
    expect(framesOf(port, 'done')).toHaveLength(0);
    expect(port.disconnected).toBe(true);
  });

  it('treats a port disconnect mid-stream as an abort and stops posting', async () => {
    let signal: AbortSignal | undefined;
    streamTextMock.mockImplementation((args: { abortSignal: AbortSignal }) => {
      signal = args.abortSignal;
      return makeHangingStream(() => args.abortSignal);
    });
    const port = makePort();
    __emitConnect(port);

    sendMessages(port);
    await drain();
    const postedBefore = port.posted.length;
    port.emitDisconnect();
    await drain();

    expect(signal?.aborted).toBe(true);
    expect(port.posted.length).toBe(postedBefore);
  });
});
