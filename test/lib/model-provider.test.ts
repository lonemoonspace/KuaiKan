import { describe, expect, it } from 'vitest';
import { buildBodyOverrides } from '@/lib/model-provider';

describe('buildBodyOverrides', () => {
  it('injects nothing when extraBody is empty', () => {
    expect(buildBodyOverrides({ extraBody: {} })).toEqual({});
  });

  it('passes extraBody through verbatim', () => {
    expect(
      buildBodyOverrides({ extraBody: { thinking: { type: 'disabled' } } }),
    ).toEqual({ thinking: { type: 'disabled' } });
  });

  it('keeps unrelated keys alongside a reasoning-control key', () => {
    expect(
      buildBodyOverrides({
        extraBody: { reasoning_effort: 'low', enable_search: true },
      }),
    ).toEqual({ reasoning_effort: 'low', enable_search: true });
  });
});
