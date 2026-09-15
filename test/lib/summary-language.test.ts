import { describe, expect, it } from 'vitest';
import { getSummaryLanguageName } from '@/lib/summary-language';

describe('getSummaryLanguageName', () => {
  it('defaults an empty value to Simplified Chinese', () => {
    expect(getSummaryLanguageName('')).toBe('简体中文');
    expect(getSummaryLanguageName('   ')).toBe('简体中文');
  });

  it('maps zh-CN style codes (case/separator insensitive) to 简体中文', () => {
    expect(getSummaryLanguageName('zh-CN')).toBe('简体中文');
    expect(getSummaryLanguageName('zh')).toBe('简体中文');
    expect(getSummaryLanguageName('ZH-SG')).toBe('简体中文');
    expect(getSummaryLanguageName('zh-Hans')).toBe('简体中文');
  });

  it('maps zh-TW style codes to 繁體中文', () => {
    expect(getSummaryLanguageName('zh_TW')).toBe('繁體中文');
    expect(getSummaryLanguageName('zh-HK')).toBe('繁體中文');
    expect(getSummaryLanguageName('zh-Hant')).toBe('繁體中文');
  });

  it('resolves other language codes to their autonym via Intl.DisplayNames', () => {
    expect(getSummaryLanguageName('en')).toBe('English');
    expect(getSummaryLanguageName('ja')).toBe('日本語');
  });

  it('returns a non-code value (e.g. the user typed a language name directly) unchanged', () => {
    expect(getSummaryLanguageName('简体中文')).toBe('简体中文');
    expect(getSummaryLanguageName('My Custom Language')).toBe('My Custom Language');
  });

  it('falls back to the original value for a code-shaped string Intl cannot resolve to a real name', () => {
    // 'xx' is a syntactically valid language subtag but not a real language;
    // Intl.DisplayNames resolves it back to itself, which must not be treated
    // as a meaningful autonym.
    expect(getSummaryLanguageName('xx')).toBe('xx');
  });
});
