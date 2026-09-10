export type SummaryErrorCode =
  | 'auth'
  | 'rate-limit'
  | 'model-not-found'
  | 'timeout'
  | 'permission'
  | 'aborted'
  | 'unknown';

export type ClassifiedSummaryError = {
  code: SummaryErrorCode;
  status?: number;
  retryable: boolean;
};

export function classifySummaryError(input: {
  message?: string;
  name?: string;
  status?: number;
}): ClassifiedSummaryError {
  const message = input.message ?? '';
  const lower = message.toLowerCase();

  // The DOM error name is an unambiguous "the caller stopped this" signal.
  if (input.name === 'AbortError') {
    return { code: 'aborted', retryable: false };
  }

  // Beyond that, a real HTTP status always wins over message sniffing. Provider
  // error bodies get spliced into `message` upstream (see getErrorMessage in
  // the background bridge), and a body that merely mentions "abort" must not be
  // mistaken for a user-initiated stop — that would suppress the toast AND the
  // header error indicator, failing the summary completely silently.
  if (input.status === 401 || input.status === 403) {
    return { code: 'auth', status: input.status, retryable: false };
  }
  if (input.status === 429) {
    return { code: 'rate-limit', status: input.status, retryable: true };
  }
  if (input.status === 404 || /model.*not found|not found.*model/i.test(lower)) {
    return { code: 'model-not-found', status: input.status, retryable: false };
  }
  if (
    input.status === 408 ||
    input.status === 504 ||
    lower.includes('timeout') ||
    lower.includes('timed out')
  ) {
    return { code: 'timeout', retryable: true };
  }
  if (
    lower.includes('access-control-allow-origin') ||
    lower.includes('cors') ||
    lower.includes('permission')
  ) {
    return { code: 'permission', retryable: false };
  }

  // Fallback abort detection: a whole-word abort phrase, but only when the
  // error carries no HTTP status of its own (a status means the request
  // actually reached the provider, so it was not a local stop).
  if (input.status === undefined && /\babort(ed|error)?\b/i.test(message)) {
    return { code: 'aborted', retryable: false };
  }

  return { code: 'unknown', status: input.status, retryable: false };
}

const COPY: Record<Exclude<SummaryErrorCode, 'unknown'>, string> = {
  auth: 'API Key 无效或没有权限，请检查模型设置。',
  'rate-limit': '请求过于频繁，请稍后重试或更换模型。',
  'model-not-found': '模型不存在，请检查模型配置中的模型 ID。',
  timeout: '请求超时，请重试。',
  permission: '请求被权限或 CORS 拦截，请检查扩展站点访问权限。',
  aborted: '已停止。',
};

export function describeSummaryError(code: SummaryErrorCode, fallback: string): string {
  if (code === 'unknown') return fallback;
  return COPY[code];
}