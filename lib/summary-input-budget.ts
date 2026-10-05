import { getEffectiveInputTokenLimit } from '@/lib/input-token-limit';
import type { ModelConfigItem } from '@/constants/model-settings';

/**
 * Tokens held back for the model's answer.
 *
 * Model configs carry an *input* limit only — `streamText` is called without
 * `maxOutputTokens`, so the provider's own default completion budget applies.
 * Reserving a fixed window keeps a page that exactly fills the context from
 * being rejected; a quarter of the limit is the cap so a small limit is not
 * eaten entirely by the reserve.
 */
export const RESERVED_COMPLETION_TOKENS = 1024;

/**
 * BPE is not additive across a template boundary: substituting the page text
 * into `{{textContent}}` can merge with the surrounding characters and add a
 * few tokens that a render with an empty string cannot see. Two seams (system
 * + user message) plus the per-message role overhead stay far below this.
 */
export const PROMPT_SEAM_SLACK_TOKENS = 32;

export type SummaryInputBudget = {
  /** Effective model input limit; 0 means "no configured limit". */
  inputTokenLimit: number;
  /** Tokens the rendered prompt uses *besides* the page text. */
  promptOverheadTokens: number;
  /** Tokens held back for the completion. */
  reservedCompletionTokens: number;
  /** Extra headroom subtracted for template-seam estimation error. */
  slackTokens: number;
  /**
   * What is left for the page text. `null` means the model has no configured
   * limit, i.e. truncation is skipped entirely; `0` means nothing fits.
   */
  pageTextBudget: number | null;
};

function toCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.ceil(value));
}

/**
 * Split a model's input limit into "what the page text may use" and everything
 * else in the request.
 *
 * The invariant callers must preserve is
 * `promptOverheadTokens + slackTokens + reservedCompletionTokens +
 * pageTextBudget <= inputTokenLimit` (when a limit is configured), so that the
 * page text cannot be truncated to a size that still overflows the context
 * once the prompt templates and the completion are added.
 */
export function computeSummaryInputBudget(input: {
  inputTokenLimit: number;
  promptOverheadTokens: number;
  /** Override for tests; defaults to a quarter of the limit, capped. */
  reservedCompletionTokens?: number;
}): SummaryInputBudget {
  const promptOverheadTokens = toCount(input.promptOverheadTokens);
  const limit = input.inputTokenLimit;

  if (!(limit > 0) || !Number.isFinite(limit)) {
    return {
      inputTokenLimit: 0,
      promptOverheadTokens,
      reservedCompletionTokens: 0,
      slackTokens: 0,
      pageTextBudget: null,
    };
  }

  const inputTokenLimit = Math.floor(limit);
  const requestedReserve =
    input.reservedCompletionTokens ??
    Math.min(RESERVED_COMPLETION_TOKENS, Math.floor(inputTokenLimit / 4));
  const reservedCompletionTokens = Math.min(
    toCount(requestedReserve),
    inputTokenLimit,
  );
  const pageTextBudget = Math.max(
    0,
    inputTokenLimit -
      reservedCompletionTokens -
      promptOverheadTokens -
      PROMPT_SEAM_SLACK_TOKENS,
  );

  return {
    inputTokenLimit,
    promptOverheadTokens,
    reservedCompletionTokens,
    slackTokens: PROMPT_SEAM_SLACK_TOKENS,
    pageTextBudget,
  };
}

/**
 * Convenience wrapper for callers holding a model config rather than a raw
 * limit: resolves the provider-aware effective limit first (see
 * `lib/input-token-limit.ts`) and then splits it.
 */
export function computeSummaryInputBudgetForModel(
  model: Pick<ModelConfigItem, 'providerId' | 'maxInputTokens'>,
  promptOverheadTokens: number,
): SummaryInputBudget {
  return computeSummaryInputBudget({
    inputTokenLimit: getEffectiveInputTokenLimit(model),
    promptOverheadTokens,
  });
}
