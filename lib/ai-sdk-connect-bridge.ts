import type { UIMessage, UIMessageChunk } from 'ai';
import type { SummaryErrorCode } from '@/lib/error-taxonomy';

export const AI_SDK_CONNECT_BRIDGE_PORT = 'ai-sdk-connect-bridge';

export type AiSdkConnectBridgeRequest = {
  type: 'send-messages';
  requestId: string;
  chatId: string;
  messageId?: string;
  messages: UIMessage[];
  modelConfigId?: string | null;
  system?: string;
  trigger: 'submit-message' | 'regenerate-message';
};

export type AiSdkConnectBridgeClientMessage =
  | AiSdkConnectBridgeRequest
  | { type: 'abort' };

export type AiSdkConnectBridgeServerMessage =
  | { type: 'chunk'; chunk: UIMessageChunk }
  | {
      type: 'error';
      message: string;
      code?: SummaryErrorCode;
      status?: number;
      retryable?: boolean;
    }
  | { type: 'done' }
  // Background-side timing marks, see lib/summary-timing.ts. Only sent in
  // development builds.
  | { type: 'timing'; marks: Record<string, number>; final: boolean };
