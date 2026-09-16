import type { SummaryInputExceedBehaviour } from '@/constants/general-settings';
import { onMessage } from '@/lib/messaging';
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
  tokenizerPromise ??= import('gpt-tokenizer/model/gpt-5').then((tokenizer) => {
    markTokenizerLoaded();
    return tokenizer;
  });
  return tokenizerPromise;
}

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
  if (behaviour === 'back') {
    return tokenizer.decode(tokens.slice(tokens.length - maxTokens));
  }

  if (behaviour === 'middle') {
    const headTokens = Math.floor(maxTokens / 2);
    const head = tokenizer.decode(tokens.slice(0, headTokens));
    const tail = tokenizer.decode(tokens.slice(tokens.length - (maxTokens - headTokens)));
    return `${head}\n\n[... 内容已截断 / content truncated ...]\n\n${tail}`;
  }

  return tokenizer.decode(tokens.slice(0, maxTokens));
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

  const tokenizer = await loadTokenizer();
  const tokens = tokenizer.encode(text);
  const originalLength = text.length;
  const originalTokens = tokens.length;

  if (originalTokens <= maxTokens) {
    logger.info(`[TokenCount] No truncation needed: String length ${originalLength}, Tokens ${originalTokens}`);
    return text;
  }

  const truncatedText = applyTruncationStrategy(tokenizer, tokens, maxTokens, behaviour);
  const truncatedLength = truncatedText.length;

  logger.info(`[TokenCount] Truncated (${behaviour}): String length ${originalLength} -> ${truncatedLength}, Tokens ${originalTokens} -> ${maxTokens}`);

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
  const loadStart = nowMs();
  const tokenizer = await loadTokenizer();
  const loadMs = nowMs() - loadStart;

  const calculateStart = nowMs();
  const tokens = tokenizer.encode(input);
  const originalTokenCount = tokens.length;
  let truncatedText = input;
  let truncatedTokenCount = originalTokenCount;

  if (tokens.length > maxTokens && behaviour !== 'nothing') {
    truncatedText = applyTruncationStrategy(tokenizer, tokens, maxTokens, behaviour);
    truncatedTokenCount = Math.min(maxTokens, originalTokenCount);
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

export async function splitTokensWithTiming(
  input: string,
): Promise<SplitTokensResult> {
  const loadStart = nowMs();
  const tokenizer = await loadTokenizer();
  const loadMs = nowMs() - loadStart;

  const calculateStart = nowMs();
  const ids = tokenizer.encode(input);
  const pieces = ids.map((id) => ({
    id,
    text: tokenizer.decode([id]),
  }));
  const calculateMs = nowMs() - calculateStart;

  return {
    model: INPUT_TOKEN_COUNT_MODEL,
    pieces,
    timing: {
      calculateMs,
      loadMs,
    },
  };
}

export function registerTokenCountMessages() {
  onMessage('countInputTokens', async (msg) => countInputTokens(msg.data.text));
  onMessage('countInputTokensWithTiming', async (msg) => countInputTokensWithTiming(msg.data.text));
  onMessage('truncateByTokens', async (msg) => truncateByTokens(msg.data.text, msg.data.maxTokens, msg.data.behaviour));
  onMessage('truncateByTokensWithTiming', async (msg) => truncateByTokensWithTiming(msg.data.text, msg.data.maxTokens, msg.data.behaviour));
  onMessage('splitTokensWithTiming', async (msg) => splitTokensWithTiming(msg.data.text));
}
