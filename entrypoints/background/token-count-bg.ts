import type { SummaryInputExceedBehaviour } from '@/constants/general-settings';
import { onMessage } from '@/lib/messaging';
import { assertTrustedSender } from '@/lib/background-trust';
import {
  INPUT_TOKEN_COUNT_MODEL,
  type InputTokenCountResult,
  type InputTokenCountTiming,
  type SplitTokensResult,
  type TokenPiece,
  type TruncateByTokensResult,
} from '@/lib/token-count-types';

import { createLogger } from '@/lib/logger';
import { markTokenizerLoaded } from './timing-bg';

const logger = createLogger('background:token-count-bg');

// Re-exported for backward compatibility with anything importing these from
// this module; the canonical definitions live in lib/token-count-types.ts,
// shared with the content-script-side lib/token-count.ts.
export {
  INPUT_TOKEN_COUNT_MODEL,
  type InputTokenCountResult,
  type InputTokenCountTiming,
  type SplitTokensResult,
  type TokenPiece,
  type TruncateByTokensResult,
};

type Gpt5Tokenizer = typeof import('gpt-tokenizer/model/gpt-5');

type Tokenizer = Awaited<Gpt5Tokenizer>;

let tokenizerPromise: Promise<Tokenizer> | null = null;

function nowMs() {
  return globalThis.performance?.now() ?? Date.now();
}

function loadTokenizer() {
  tokenizerPromise ??= import('gpt-tokenizer/model/gpt-5').then(
    (tokenizer) => {
      markTokenizerLoaded();
      return tokenizer;
    },
    (error) => {
      // `??=` assigns before the import settles, so a rejection would otherwise
      // stay cached and fail every token RPC for the rest of this worker's
      // life (a recycled service worker or one transient resource read is
      // enough). Clear it so the next call retries.
      tokenizerPromise = null;
      throw error;
    },
  );
  return tokenizerPromise;
}

/**
 * Inserted between the kept head and tail of a `middle` truncation. Exported so
 * tests can measure its token cost instead of hard-coding it.
 */
export const MIDDLE_TRUNCATION_MARKER =
  '\n\n[... 内容已截断 / content truncated ...]\n\n';

/**
 * Slice an over-long token array according to the configured strategy.
 *
 * - front:   keep the head of the document (previous default).
 * - back:    keep the tail of the document.
 * - middle:  keep head + tail and mark the removed section.
 *
 * `nothing` (leave the text untouched) is handled by callers before they
 * ever reach this function, so it is not a case here.
 */
function applyTruncationStrategy(
  tokenizer: Tokenizer,
  tokens: number[],
  maxTokens: number,
  behaviour: SummaryInputExceedBehaviour,
): string {
  // A zero budget has no meaningful slice: `slice(0, -0)` would keep the whole
  // array and `middle` would emit its marker alone. Every strategy returns
  // nothing instead.
  if (maxTokens <= 0) return '';

  if (behaviour === 'back') {
    return tokenizer.decode(tokens.slice(tokens.length - maxTokens));
  }

  if (behaviour === 'middle') {
    const marker = MIDDLE_TRUNCATION_MARKER;
    // The marker counts against the budget so the result never exceeds it.
    const budget = Math.max(0, maxTokens - tokenizer.countTokens(marker));
    // The marker alone costs ~12 tokens, so a budget below that leaves nothing:
    // returning the bare marker (the previous behaviour) sent *more* tokens
    // than the caller asked for -- exactly what truncation must prevent.
    if (budget === 0) return '';
    const headTokens = Math.floor(budget / 2);
    const tailTokens = budget - headTokens;
    const head = tokenizer.decode(tokens.slice(0, headTokens));
    const tail =
      tailTokens > 0
        ? tokenizer.decode(tokens.slice(tokens.length - tailTokens))
        : '';
    return `${head}${marker}${tail}`;
  }

  return tokenizer.decode(tokens.slice(0, maxTokens));
}

/**
 * The strategies index token arrays directly, so the budget has to be a
 * non-negative integer before it reaches them: a negative value makes `front`
 * slice from the tail (`slice(0, -3)` keeps everything but the last three
 * tokens) and makes the reported truncated count negative. Normalizing here
 * protects every caller, including one that forgets the `> 0` guard.
 */
function normalizeMaxTokens(maxTokens: number): number {
  if (!Number.isFinite(maxTokens)) return 0;
  return Math.max(0, Math.floor(maxTokens));
}

export async function truncateByTokens(
  text: string,
  maxTokens: number,
  behaviour: SummaryInputExceedBehaviour = 'front',
): Promise<string> {
  if (behaviour === 'nothing') {
    // The user opted out of truncation: skip loading/encoding entirely and
    // let the provider decide/error on the raw text.
    logger.info('[TokenCount] No truncation needed: behaviour is "nothing".');
    return text;
  }

  const budget = normalizeMaxTokens(maxTokens);

  if (budget === 0) {
    logger.info('[TokenCount] Truncated: budget is 0, returning empty text.');
    return '';
  }

  const tokenizer = await loadTokenizer();
  const tokens = tokenizer.encode(text);
  const originalLength = text.length;
  const originalTokens = tokens.length;

  if (originalTokens <= budget) {
    logger.info(`[TokenCount] No truncation needed: String length ${originalLength}, Tokens ${originalTokens}`);
    return text;
  }

  const truncatedText = applyTruncationStrategy(tokenizer, tokens, budget, behaviour);
  const truncatedLength = truncatedText.length;

  logger.info(`[TokenCount] Truncated (${behaviour}): String length ${originalLength} -> ${truncatedLength}, Tokens ${originalTokens} -> ${budget}`);

  return truncatedText;
}

export async function countInputTokens(input: string): Promise<number> {
  const tokenizer = await loadTokenizer();
  return tokenizer.countTokens(input);
}

export async function countInputTokensWithTiming(
  input: string,
): Promise<InputTokenCountResult> {
  const loadStart = nowMs();
  const tokenizer = await loadTokenizer();
  const loadMs = nowMs() - loadStart;

  const calculateStart = nowMs();
  const tokenCount = tokenizer.countTokens(input);
  const calculateMs = nowMs() - calculateStart;

  return {
    model: INPUT_TOKEN_COUNT_MODEL,
    tokenCount,
    timing: {
      calculateMs,
      loadMs,
    },
  };
}

export async function truncateByTokensWithTiming(
  input: string,
  maxTokens: number,
  behaviour: SummaryInputExceedBehaviour = 'front',
): Promise<TruncateByTokensResult> {
  const budget = normalizeMaxTokens(maxTokens);
  const loadStart = nowMs();
  const tokenizer = await loadTokenizer();
  const loadMs = nowMs() - loadStart;

  const calculateStart = nowMs();
  const tokens = tokenizer.encode(input);
  const originalTokenCount = tokens.length;
  let truncatedText = input;
  let truncatedTokenCount = originalTokenCount;

  if (originalTokenCount > budget && behaviour !== 'nothing') {
    truncatedText = applyTruncationStrategy(tokenizer, tokens, budget, behaviour);
    truncatedTokenCount = Math.min(budget, originalTokenCount);
  }
  const calculateMs = nowMs() - calculateStart;

  return {
    model: INPUT_TOKEN_COUNT_MODEL,
    truncatedText,
    originalTokenCount,
    truncatedTokenCount,
    timing: {
      calculateMs,
      loadMs,
    },
  };
}

/**
 * Upper bound on the pieces `splitTokensWithTiming` returns. The viewer renders
 * one span per piece and each piece is a structured-cloned RPC payload, so an
 * uncapped 100k-token article froze the content script (and, near the session
 * quota, the worker). The window covers the head of the document, which is what
 * the truncation strategies keep an eye on, and the viewer reports the real
 * total alongside it.
 */
export const MAX_TOKEN_PIECES = 4_000;

export async function splitTokensWithTiming(
  input: string,
): Promise<SplitTokensResult> {
  const loadStart = nowMs();
  const tokenizer = await loadTokenizer();
  const loadMs = nowMs() - loadStart;

  const calculateStart = nowMs();
  const ids = tokenizer.encode(input);
  const totalTokenCount = ids.length;
  const pieces = ids.slice(0, MAX_TOKEN_PIECES).map((id) => ({
    id,
    text: tokenizer.decode([id]),
  }));
  // Reported so the viewer can mirror a `middle` truncation exactly: the
  // strategy spends part of the budget on this marker before splitting the
  // remaining budget between head and tail.
  const middleMarkerTokenCount = tokenizer.countTokens(MIDDLE_TRUNCATION_MARKER);
  const calculateMs = nowMs() - calculateStart;

  return {
    model: INPUT_TOKEN_COUNT_MODEL,
    pieces,
    totalTokenCount,
    middleMarkerTokenCount,
    timing: {
      calculateMs,
      loadMs,
    },
  };
}

export function registerTokenCountMessages() {
  // Every one of these is a runtime-level RPC that only this extension's own
  // contexts may call; see lib/background-trust.ts.
  onMessage('countInputTokens', async (msg) => {
    assertTrustedSender(msg.sender);
    return countInputTokens(msg.data.text);
  });
  onMessage('countInputTokensWithTiming', async (msg) => {
    assertTrustedSender(msg.sender);
    return countInputTokensWithTiming(msg.data.text);
  });
  onMessage('truncateByTokens', async (msg) => {
    assertTrustedSender(msg.sender);
    return truncateByTokens(msg.data.text, msg.data.maxTokens, msg.data.behaviour);
  });
  onMessage('truncateByTokensWithTiming', async (msg) => {
    assertTrustedSender(msg.sender);
    return truncateByTokensWithTiming(msg.data.text, msg.data.maxTokens, msg.data.behaviour);
  });
  onMessage('splitTokensWithTiming', async (msg) => {
    assertTrustedSender(msg.sender);
    return splitTokensWithTiming(msg.data.text);
  });
}
