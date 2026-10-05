import { describe, expect, it } from 'vitest';
import type { ModelProviderId } from '@/constants/model-settings';
import {
  PROMPT_SEAM_SLACK_TOKENS,
  RESERVED_COMPLETION_TOKENS,
  computeSummaryInputBudget,
  computeSummaryInputBudgetForModel,
} from '@/lib/summary-input-budget';

function model(providerId: ModelProviderId, maxInputTokens: number) {
  return { providerId, maxInputTokens };
}

describe('computeSummaryInputBudget', () => {
  it('subtracts the prompt overhead, the completion reserve and the slack', () => {
    const budget = computeSummaryInputBudget({
      inputTokenLimit: 100_000,
      promptOverheadTokens: 500,
    });

    expect(budget.inputTokenLimit).toBe(100_000);
    expect(budget.promptOverheadTokens).toBe(500);
    expect(budget.reservedCompletionTokens).toBe(RESERVED_COMPLETION_TOKENS);
    expect(budget.slackTokens).toBe(PROMPT_SEAM_SLACK_TOKENS);
    expect(budget.pageTextBudget).toBe(
      100_000 - RESERVED_COMPLETION_TOKENS - 500 - PROMPT_SEAM_SLACK_TOKENS,
    );
  });

  it('leaves less room for the page text than the raw limit (A1 regression)', () => {
    // Before this module existed the page text was truncated to the raw limit,
    // so the rendered prompt (system message + template + selection) plus the
    // completion pushed every near-the-limit page over the context window.
    const budget = computeSummaryInputBudget({
      inputTokenLimit: 128_000,
      promptOverheadTokens: 1_234,
    });

    expect(budget.pageTextBudget).toBeLessThan(128_000);
  });

  it('keeps overhead + reserve + slack + page text inside the limit', () => {
    const limits = [1, 5, 64, 128, 1_000, 200_000];
    const overheads = [0, 1, 50, 5_000, 1_000_000];

    for (const inputTokenLimit of limits) {
      for (const promptOverheadTokens of overheads) {
        const budget = computeSummaryInputBudget({
          inputTokenLimit,
          promptOverheadTokens,
        });
        expect(budget.pageTextBudget).not.toBeNull();

        const requested =
          budget.promptOverheadTokens +
          budget.reservedCompletionTokens +
          budget.slackTokens +
          (budget.pageTextBudget ?? 0);

        if ((budget.pageTextBudget ?? 0) > 0) {
          // The request can be made to fit, so it must fit.
          expect(requested).toBeLessThanOrEqual(inputTokenLimit);
        } else {
          // Nothing fits: the caller must abort instead of sending, and the
          // reason is that the non-text parts alone overflow the window.
          expect(inputTokenLimit).toBeLessThanOrEqual(
            budget.promptOverheadTokens +
              budget.reservedCompletionTokens +
              budget.slackTokens,
          );
        }
      }
    }
  });

  it('caps the completion reserve for a small limit', () => {
    const budget = computeSummaryInputBudget({
      inputTokenLimit: 100,
      promptOverheadTokens: 0,
    });

    expect(budget.reservedCompletionTokens).toBe(25);
    expect(budget.pageTextBudget).toBe(100 - 25 - PROMPT_SEAM_SLACK_TOKENS);
  });

  it('reports a zero page-text budget when the prompt alone fills the window', () => {
    const budget = computeSummaryInputBudget({
      inputTokenLimit: 100,
      promptOverheadTokens: 90,
    });

    expect(budget.pageTextBudget).toBe(0);
  });

  it('treats a non-positive or non-finite limit as unlimited', () => {
    for (const inputTokenLimit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const budget = computeSummaryInputBudget({
        inputTokenLimit,
        promptOverheadTokens: 100,
      });

      expect(budget.inputTokenLimit).toBe(0);
      expect(budget.pageTextBudget).toBeNull();
      expect(budget.reservedCompletionTokens).toBe(0);
      expect(budget.slackTokens).toBe(0);
    }
  });

  it('normalizes fractional, negative and non-finite counts', () => {
    const budget = computeSummaryInputBudget({
      inputTokenLimit: 1_000.7,
      promptOverheadTokens: 10.2,
    });

    expect(budget.inputTokenLimit).toBe(1_000);
    // Rounded up: under-reserving is what breaks the invariant.
    expect(budget.promptOverheadTokens).toBe(11);
  });

  it('clamps a negative overhead to zero', () => {
    expect(
      computeSummaryInputBudget({
        inputTokenLimit: 1_000,
        promptOverheadTokens: -5,
      }).promptOverheadTokens,
    ).toBe(0);
  });

  it('honours an explicit completion reserve', () => {
    const budget = computeSummaryInputBudget({
      inputTokenLimit: 10_000,
      promptOverheadTokens: 0,
      reservedCompletionTokens: 4_096,
    });

    expect(budget.reservedCompletionTokens).toBe(4_096);
  });

  it('never reserves more than the limit itself', () => {
    const budget = computeSummaryInputBudget({
      inputTokenLimit: 500,
      promptOverheadTokens: 0,
      reservedCompletionTokens: 10_000,
    });

    expect(budget.reservedCompletionTokens).toBe(500);
    expect(budget.pageTextBudget).toBe(0);
  });
});

describe('computeSummaryInputBudgetForModel', () => {
  it('applies the provider-aware effective limit first', () => {
    const openai = computeSummaryInputBudgetForModel(model('openai', 10_000), 100);
    const anthropic = computeSummaryInputBudgetForModel(
      model('anthropic', 10_000),
      100,
    );

    expect(openai.inputTokenLimit).toBe(10_000);
    expect(anthropic.inputTokenLimit).toBe(9_000);
    expect(anthropic.pageTextBudget).toBeLessThan(openai.pageTextBudget ?? 0);
  });

  it('skips truncation for a model without a configured limit', () => {
    expect(
      computeSummaryInputBudgetForModel(model('openai', 0), 500).pageTextBudget,
    ).toBeNull();
  });
});
