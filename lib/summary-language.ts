// Converts the stored summary-language setting (a language code such as
// `zh-CN`, or a value the user typed directly like `简体中文`) into a
// human-readable language name to hand the model, e.g. via the
// `{{summaryLanguage}}` Mustache variable in built-in prompts.

const LANGUAGE_CODE_PATTERN = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/;

const SIMPLIFIED_CHINESE_CODES = new Set(['zh', 'zh-cn', 'zh-sg', 'zh-hans']);
const TRADITIONAL_CHINESE_CODES = new Set(['zh-tw', 'zh-hk', 'zh-mo', 'zh-hant']);

export function getSummaryLanguageName(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return '简体中文';
  }

  // Not shaped like a language code (e.g. the user typed "简体中文" directly
  // into the setting) -- pass it through unchanged.
  if (!LANGUAGE_CODE_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.toLowerCase().replace(/_/g, '-');

  if (SIMPLIFIED_CHINESE_CODES.has(normalized)) {
    return '简体中文';
  }
  if (TRADITIONAL_CHINESE_CODES.has(normalized)) {
    return '繁體中文';
  }

  try {
    const displayNames = new Intl.DisplayNames([trimmed], { type: 'language' });
    const name = displayNames.of(trimmed);
    if (name && name.toLowerCase() !== trimmed.toLowerCase()) {
      return name;
    }
  } catch {
    // Unsupported/invalid code for Intl.DisplayNames -- fall through.
  }

  return trimmed;
}
