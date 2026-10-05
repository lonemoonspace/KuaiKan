import type { SummaryInputExceedBehaviour } from '@/constants/general-settings';
import type { PanelSnapshot, PanelSnapshotPatch } from '@/lib/panel-snapshot';
import type {
  ModelMutationRequest,
  ModelMutationResponse,
  PromptMutationRequest,
  PromptMutationResponse,
} from '@/lib/settings-mutations';
import { defineExtensionMessaging } from '@webext-core/messaging';

export interface ProtocolMap {
  /** Opens the options page at the specified hash/path */
  openOptionPage(url: string): Promise<void>;

  /** Instructs the content script summary panel to toggle or begin summarizing */
  invokeSummary(payload?: { beginSummary?: boolean }): void;

  /** Seeds the default prompt library exactly once (handled single-flight in the background). */
  seedPromptLibrary(): Promise<{ seeded: boolean }>;

  /**
   * Per-tab, per-page panel state (open flag + summary), kept in storage.session
   * by the background.
   *
   * Note the value types below are the *return value*, not the handler's
   * promise shape: `@webext-core/messaging` types `sendMessage` as
   * `Promise<GetReturnType<ProtocolMap[K]>>` and lets a handler return either
   * `T` or `Promise<T>`. Declaring `Promise<T>` here would double-wrap every
   * client call and reject the synchronous handlers in `panel-snapshot-bg.ts`.
   */
  loadPanelSnapshot(input: { pageKey: string }): PanelSnapshot | null;
  savePanelSnapshot(input: { pageKey: string; patch: PanelSnapshotPatch }): void;

  /**
   * Model/prompt settings mutations, executed serially in the background so
   * concurrent writers (panel, popup, options page) cannot lose an update.
   */
  mutateModelSettings(input: ModelMutationRequest): Promise<ModelMutationResponse>;
  mutatePromptSettings(input: PromptMutationRequest): Promise<PromptMutationResponse>;

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
