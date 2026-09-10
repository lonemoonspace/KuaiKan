import type { SummaryInputExceedBehaviour } from '@/constants/general-settings';
import { defineExtensionMessaging } from '@webext-core/messaging';

export interface ProtocolMap {
  /** Opens the options page at the specified hash/path */
  openOptionPage(url: string): Promise<void>;

  /** Instructs the content script summary panel to toggle or begin summarizing */
  invokeSummary(payload?: { beginSummary?: boolean }): void;

  /** Seeds the default prompt library exactly once (handled single-flight in the background). */
  seedPromptLibrary(): Promise<{ seeded: boolean }>;

  /** Token counting and truncation */
  countInputTokens(input: { text: string }): number;
  countInputTokensWithTiming(input: { text: string }): import('./token-count').InputTokenCountResult;
  truncateByTokens(input: { text: string; maxTokens: number; behaviour?: SummaryInputExceedBehaviour }): string;
  truncateByTokensWithTiming(input: { text: string; maxTokens: number; behaviour?: SummaryInputExceedBehaviour }): import('./token-count').TruncateByTokensResult;
  splitTokensWithTiming(input: { text: string }): import('./token-count').SplitTokensResult;

  /** Pings the content script to check if it's active */
  ping(): Promise<{ ok: boolean; title: string; url: string; textLength: number }>;

  /** Extracts text content from the current page */
  extractText(): Promise<{ ok: boolean; title?: string; url?: string; text?: string; error?: string }>;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
