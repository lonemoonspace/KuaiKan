import type { SummaryInputExceedBehaviour } from '@/constants/general-settings';
import { sendMessage } from '@/lib/messaging';
import type {
  InputTokenCountResult,
  SplitTokensResult,
  TruncateByTokensResult,
} from '@/lib/token-count-types';

// Re-exported so existing consumers (TokenViewerModal.tsx, lib/messaging.ts)
// don't need to change their import path; the actual definitions live in
// lib/token-count-types.ts, shared with entrypoints/background/token-count-bg.ts.
export {
  INPUT_TOKEN_COUNT_MODEL,
  type InputTokenCountResult,
  type InputTokenCountTiming,
  type SplitTokensResult,
  type TokenPiece,
  type TruncateByTokensResult,
} from '@/lib/token-count-types';

export type TruncationStrategy = SummaryInputExceedBehaviour;

export async function truncateByTokens(
  text: string,
  maxTokens: number,
  behaviour: TruncationStrategy = 'front',
): Promise<string> {
  return sendMessage('truncateByTokens', { text, maxTokens, behaviour });
}

export async function countInputTokens(input: string): Promise<number> {
  return sendMessage('countInputTokens', { text: input });
}

export async function countInputTokensWithTiming(
  input: string,
): Promise<InputTokenCountResult> {
  return sendMessage('countInputTokensWithTiming', { text: input });
}

export async function truncateByTokensWithTiming(
  input: string,
  maxTokens: number,
  behaviour: TruncationStrategy = 'front',
): Promise<TruncateByTokensResult> {
  return sendMessage('truncateByTokensWithTiming', { text: input, maxTokens, behaviour });
}

export async function splitTokensWithTiming(
  input: string,
): Promise<SplitTokensResult> {
  return sendMessage('splitTokensWithTiming', { text: input });
}
