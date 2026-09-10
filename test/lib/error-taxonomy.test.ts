import { describe, expect, it } from 'vitest';
import { classifySummaryError, describeSummaryError } from '@/lib/error-taxonomy';

describe('classifySummaryError', () => {
  it('treats a DOM AbortError name as an unambiguous user-initiated stop', () => {
    expect(classifySummaryError({ name: 'AbortError', message: 'anything' })).toEqual({
      code: 'aborted',
      retryable: false,
    });
  });

  it('prioritizes HTTP status over message content for auth errors', () => {
    expect(
      classifySummaryError({ status: 401, message: 'the model aborted the request due to invalid_api_key' }),
    ).toEqual({ code: 'auth', status: 401, retryable: false });
  });

  it('prioritizes HTTP status over message content for a 403', () => {
    expect(classifySummaryError({ status: 403, message: 'aborted' })).toEqual({
      code: 'auth',
      status: 403,
      retryable: false,
    });
  });

  it('classifies 429 as a retryable rate limit', () => {
    expect(classifySummaryError({ status: 429, message: 'too many requests' })).toEqual({
      code: 'rate-limit',
      status: 429,
      retryable: true,
    });
  });

  it('classifies 404 or a "model not found" message as model-not-found', () => {
    expect(classifySummaryError({ status: 404 })).toEqual({
      code: 'model-not-found',
      status: 404,
      retryable: false,
    });
    expect(classifySummaryError({ message: 'Model not found: gpt-9' })).toEqual({
      code: 'model-not-found',
      status: undefined,
      retryable: false,
    });
  });

  it('classifies timeouts from status or message', () => {
    expect(classifySummaryError({ status: 504 })).toEqual({ code: 'timeout', retryable: true });
    expect(classifySummaryError({ message: 'Request timed out' })).toEqual({
      code: 'timeout',
      retryable: true,
    });
  });

  it('classifies CORS/permission failures', () => {
    expect(
      classifySummaryError({ message: "No 'Access-Control-Allow-Origin' header is present" }),
    ).toEqual({ code: 'permission', retryable: false });
  });

  it('only falls back to message-based abort detection when there is no HTTP status', () => {
    // Whole-word match, no status present -> genuinely a local abort.
    expect(classifySummaryError({ message: 'The user aborted a request.' })).toEqual({
      code: 'aborted',
      retryable: false,
    });
  });

  it('does not misclassify a provider error body that merely contains "abort" as a substring when a status is present', () => {
    // Regression for the exact scenario called out in error-taxonomy.ts: a
    // provider response body mentioning "aborted" must not be mistaken for a
    // user-initiated stop once we know the request actually reached the
    // provider (i.e. it carries an HTTP status).
    expect(
      classifySummaryError({
        status: 500,
        message: 'upstream provider aborted the request due to invalid_api_key',
      }),
    ).not.toEqual(expect.objectContaining({ code: 'aborted' }));
  });

  it('does not match "abort" as a substring of an unrelated word (whole-word only)', () => {
    expect(classifySummaryError({ message: 'the abortion of the deployment plan' }).code).not.toBe(
      'aborted',
    );
  });

  it('falls back to unknown when nothing matches', () => {
    expect(classifySummaryError({ message: 'some unexpected failure' })).toEqual({
      code: 'unknown',
      status: undefined,
      retryable: false,
    });
  });
});

describe('describeSummaryError', () => {
  it('returns the fixed Chinese copy for known codes', () => {
    expect(describeSummaryError('auth', 'fallback')).toBe(
      'API Key 无效或没有权限，请检查模型设置。',
    );
  });

  it('returns the fallback message for unknown', () => {
    expect(describeSummaryError('unknown', 'fallback message')).toBe('fallback message');
  });
});
