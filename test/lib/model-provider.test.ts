import { describe, expect, it } from 'vitest';
import { buildBodyOverrides } from '@/lib/model-provider';

describe('buildBodyOverrides', () => {
  it('injects nothing when reasoningEffort is the default (empty string)', () => {
    expect(
      buildBodyOverrides({
        providerId: 'openai-compatible',
        apiMode: 'chat',
        reasoningEffort: '',
        extraBody: {},
      }),
    ).toEqual({});
  });

  it('uses top-level reasoning_effort for openai-compatible', () => {
    expect(
      buildBodyOverrides({
        providerId: 'openai-compatible',
        apiMode: 'chat',
        reasoningEffort: 'high',
        extraBody: {},
      }),
    ).toEqual({ reasoning_effort: 'high' });
  });

  it('uses top-level reasoning_effort for openai chat mode', () => {
    expect(
      buildBodyOverrides({
        providerId: 'openai',
        apiMode: 'chat',
        reasoningEffort: 'medium',
        extraBody: {},
      }),
    ).toEqual({ reasoning_effort: 'medium' });
  });

  it('uses nested reasoning.effort for openai responses mode', () => {
    expect(
      buildBodyOverrides({
        providerId: 'openai',
        apiMode: 'responses',
        reasoningEffort: 'low',
        extraBody: {},
      }),
    ).toEqual({ reasoning: { effort: 'low' } });
  });

  it('uses nested reasoning.effort for open-responses', () => {
    expect(
      buildBodyOverrides({
        providerId: 'open-responses',
        apiMode: 'responses',
        reasoningEffort: 'xhigh',
        extraBody: {},
      }),
    ).toEqual({ reasoning: { effort: 'xhigh' } });
  });

  it('never injects a reasoning param for providers that do not support it', () => {
    expect(
      buildBodyOverrides({
        providerId: 'anthropic',
        apiMode: 'chat',
        reasoningEffort: 'high',
        extraBody: {},
      }),
    ).toEqual({});
    expect(
      buildBodyOverrides({
        providerId: 'google',
        apiMode: 'chat',
        reasoningEffort: 'high',
        extraBody: {},
      }),
    ).toEqual({});
    expect(
      buildBodyOverrides({
        providerId: 'ollama',
        apiMode: 'chat',
        reasoningEffort: 'high',
        extraBody: {},
      }),
    ).toEqual({});
  });

  it('lets a same-named key in extraBody win over the injected reasoning effort', () => {
    expect(
      buildBodyOverrides({
        providerId: 'openai-compatible',
        apiMode: 'chat',
        reasoningEffort: 'high',
        extraBody: { reasoning_effort: 'low', enable_search: true },
      }),
    ).toEqual({ reasoning_effort: 'low', enable_search: true });
  });

  it('lets extraBody win over the nested reasoning.effort shape too', () => {
    expect(
      buildBodyOverrides({
        providerId: 'open-responses',
        apiMode: 'responses',
        reasoningEffort: 'high',
        extraBody: { reasoning: { effort: 'custom' } },
      }),
    ).toEqual({ reasoning: { effort: 'custom' } });
  });
});
