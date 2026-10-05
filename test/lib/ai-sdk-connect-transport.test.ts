import type { ChatTransport, UIMessage } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSdkConnectTransport } from '@/lib/ai-sdk-connect-transport';
import { MockPort, __setMockPortFactory } from '../mocks/wxt-browser';

// The transport turns raw bridge frames into a ReadableStream for `useChat`.
// These tests pin that protocol: which frames reach the stream, which fail it,
// and what happens to a frame this build does not recognise.

type SendMessagesArgs = Parameters<ChatTransport<UIMessage>['sendMessages']>[0];

let port: MockPort;

beforeEach(() => {
  port = new MockPort();
  __setMockPortFactory(() => port);
});

function startStream(abortSignal?: AbortSignal) {
  return new AiSdkConnectTransport().sendMessages({
    abortSignal,
    chatId: 'chat-1',
    messageId: 'message-1',
    messages: [],
    trigger: 'submit-message',
  } as SendMessagesArgs);
}

describe('AiSdkConnectTransport.sendMessages', () => {
  it('posts the request frame and forwards chunk frames into the stream', async () => {
    const reader = (await startStream()).getReader();

    expect(port.posted[0]).toMatchObject({
      type: 'send-messages',
      chatId: 'chat-1',
      messageId: 'message-1',
    });

    port.emitMessage({ type: 'chunk', chunk: { type: 'text-delta', id: 't1', delta: '你好' } });

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { type: 'text-delta', id: 't1', delta: '你好' },
    });
  });

  it('absorbs timing frames instead of forwarding them to the stream', async () => {
    const reader = (await startStream()).getReader();

    port.emitMessage({ type: 'timing', marks: { 后台收到请求: 1 }, final: false });
    port.emitMessage({ type: 'chunk', chunk: { type: 'text-delta', id: 't1', delta: 'x' } });

    // The first value read must be the chunk that followed the timing frame.
    await expect(reader.read()).resolves.toMatchObject({
      value: { type: 'text-delta', delta: 'x' },
    });
  });

  it('closes the stream and releases the port on the done frame', async () => {
    const reader = (await startStream()).getReader();

    port.emitMessage({ type: 'done' });

    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    expect(port.disconnected).toBe(true);
    expect(port.listenerCount).toBe(0);
  });

  it('fails the stream with the classified fields carried by an error frame', async () => {
    const reader = (await startStream()).getReader();

    port.emitMessage({
      type: 'error',
      message: '请求过于频繁',
      code: 'rate-limit',
      status: 429,
      retryable: true,
    });

    await expect(reader.read()).rejects.toMatchObject({
      message: '请求过于频繁',
      code: 'rate-limit',
      status: 429,
      retryable: true,
    });
  });

  it('ignores an unknown frame type and keeps the stream usable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const reader = (await startStream()).getReader();

      port.emitMessage({ type: 'frame-from-the-future', payload: 1 });
      port.emitMessage({ type: 'chunk', chunk: { type: 'text-delta', id: 't1', delta: 'still here' } });

      await expect(reader.read()).resolves.toMatchObject({
        value: { type: 'text-delta', delta: 'still here' },
      });
      expect(port.disconnected).toBe(false);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('sends an abort frame and closes the stream when the signal aborts', async () => {
    const controller = new AbortController();
    const reader = (await startStream(controller.signal)).getReader();

    controller.abort();

    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    expect(port.posted.at(-1)).toEqual({ type: 'abort' });
  });

  it('fails the stream when the background drops the port', async () => {
    const reader = (await startStream()).getReader();

    port.emitDisconnect();

    // The message surfaces verbatim in the panel (nothing in error-taxonomy
    // classifies it), so it is asserted in the UI language.
    await expect(reader.read()).rejects.toThrow('与后台服务的连接已断开，请重试。');
    expect(port.listenerCount).toBe(0);
  });

  it('aborts immediately when the caller hands over an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const reader = (await startStream(controller.signal)).getReader();

    // Nothing may be sent to the background, and the request must not hang.
    expect(port.posted).toEqual([{ type: 'abort' }]);
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    expect(port.disconnected).toBe(true);
    expect(port.listenerCount).toBe(0);
  });

  it('fails the stream and releases the port when the request frame cannot be posted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwingPort = new MockPort();
    throwingPort.postMessage = () => {
      throw new Error('Extension context invalidated.');
    };
    __setMockPortFactory(() => throwingPort);

    try {
      const reader = (await startStream()).getReader();

      // `port.postMessage` throwing must not escape `start`: the stream errors
      // through the normal path, so the listeners are removed too.
      await expect(reader.read()).rejects.toThrow('无法连接后台服务，请重试。');
      expect(throwingPort.listenerCount).toBe(0);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  // A `Port` whose `disconnect()` does not re-dispatch `onDisconnect` on the
  // *same* port object — Chrome does not document that it does, and the
  // transport used to rely on it: `cancel()` called `port.disconnect()` only,
  // so `onMessage`/`onDisconnect`/the abort listener stayed registered.
  class SilentDisconnectPort extends MockPort {
    disconnect() {
      this.disconnected = true;
    }
  }

  it('releases the port listeners on cancel without relying on onDisconnect', async () => {
    const silentPort = new SilentDisconnectPort();
    __setMockPortFactory(() => silentPort);
    const reader = (await startStream()).getReader();

    expect(silentPort.listenerCount).toBeGreaterThan(0);

    await reader.cancel();

    expect(silentPort.disconnected).toBe(true);
    expect(silentPort.listenerCount).toBe(0);
    expect(silentPort.posted.at(-1)).toEqual({ type: 'abort' });
  });
});
