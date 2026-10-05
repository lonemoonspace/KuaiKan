// Pure types/constants shared by lib/token-count.ts (content-script-side RPC
// wrapper) and entrypoints/background/token-count-bg.ts (the actual
// tokenizer logic). Kept dependency-free (no '@/lib/messaging' or any other
// runtime module) so either side can import it without pulling in the other.

export const INPUT_TOKEN_COUNT_MODEL = 'gpt-5';

export type InputTokenCountTiming = {
  calculateMs: number;
  loadMs: number;
};

export type InputTokenCountResult = {
  model: typeof INPUT_TOKEN_COUNT_MODEL;
  tokenCount: number;
  timing: InputTokenCountTiming;
};

export type TruncateByTokensResult = {
  model: typeof INPUT_TOKEN_COUNT_MODEL;
  truncatedText: string;
  originalTokenCount: number;
  truncatedTokenCount: number;
  timing: InputTokenCountTiming;
};

export type TokenPiece = {
  id: number;
  text: string;
};

export type SplitTokensResult = {
  model: typeof INPUT_TOKEN_COUNT_MODEL;
  /**
   * A bounded preview window (the first `MAX_TOKEN_PIECES` tokens of the
   * input). The token viewer renders one DOM node per piece, so returning the
   * whole article meant shipping a 100k-element message and committing 100k
   * React nodes at once.
   */
  pieces: TokenPiece[];
  /** Tokens in the whole input, i.e. >= `pieces.length`. */
  totalTokenCount: number;
  /**
   * Tokens the `middle` truncation strategy spends on its "content truncated"
   * marker. The viewer subtracts it from the budget before splitting it into
   * head/tail, so its dimmed region matches what the background actually keeps.
   */
  middleMarkerTokenCount: number;
  timing: InputTokenCountTiming;
};
