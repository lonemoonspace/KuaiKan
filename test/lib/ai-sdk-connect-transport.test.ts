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

    await expect(reader.read()).rejects.toThrow(
      'AI SDK connect bridge disconnected before completion.',
    );
  });
});
