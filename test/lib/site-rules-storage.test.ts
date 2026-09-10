import { describe, expect, it } from 'vitest';
import {
  findMatchingCustomization,
  isUrlAllowed,
  matchPattern,
} from '@/lib/site-rules-storage';
import type { BlackList, SiteCustomizationItem, WhiteList } from '@/constants/site-rules';

const url = (href: string) => new URL(href);

describe('matchPattern (picomatch-based glob)', () => {
  it('matches an exact hostname', () => {
    expect(matchPattern('example.com', 'example.com')).toBe(true);
    expect(matchPattern('example.com', 'other.com')).toBe(false);
  });

  it('matches subdomains with a single wildcard segment', () => {
    expect(matchPattern('*.example.com', 'a.example.com')).toBe(true);
    // NOTE: unlike a filesystem glob, picomatch's `*` is only stopped by `/`,
    // not by `.` -- so a single `*` also happens to match multi-level
    // subdomains here. This contradicts the UI copy in lib/i18n.ts
    // (siteCustomization.examples), which documents `*.example.com` as
    // single-level-only and `**.example.com` as the multi-level form. Pinning
    // actual behaviour rather than the documented claim; flagged in the P3
    // report as a pre-existing doc/behaviour mismatch, not something this
    // test suite changes.
    expect(matchPattern('*.example.com', 'a.b.example.com')).toBe(true);
  });

  it('matches a multi-level subdomain wildcard', () => {
    expect(matchPattern('**.example.com', 'a.example.com')).toBe(true);
    expect(matchPattern('**.example.com', 'a.b.example.com')).toBe(true);
  });

  it('matches a path glob', () => {
    expect(matchPattern('example.com/articles/*', 'example.com/articles/1')).toBe(true);
    expect(matchPattern('example.com/articles/*', 'example.com/other/1')).toBe(false);
  });

  it('returns false instead of throwing for an invalid pattern', () => {
    expect(matchPattern('[', 'anything')).toBe(false);
  });
});

describe('isUrlAllowed (whitelist/blacklist precedence)', () => {
  const enabledWhitelist = (patterns: string[]): WhiteList => ({ enable: true, patterns });
  const disabledWhitelist: WhiteList = { enable: false, patterns: [] };
  const enabledBlacklist = (patterns: string[]): BlackList => ({ enable: true, patterns });
  const disabledBlacklist: BlackList = { enable: false, patterns: [] };

  it('when whitelist is enabled, only matching hosts are allowed regardless of blacklist', () => {
    const whitelist = enabledWhitelist(['*.example.com']);
    const blacklist = enabledBlacklist(['a.example.com']); // would also blacklist it, but whitelist wins
    expect(isUrlAllowed(url('https://a.example.com/page'), whitelist, blacklist)).toBe(true);
    expect(isUrlAllowed(url('https://other.com/page'), whitelist, blacklist)).toBe(false);
  });

  it('when whitelist is disabled, blacklist (if enabled) determines access', () => {
    const blacklist = enabledBlacklist(['*.blocked.com']);
    expect(isUrlAllowed(url('https://a.blocked.com/page'), disabledWhitelist, blacklist)).toBe(false);
    expect(isUrlAllowed(url('https://allowed.com/page'), disabledWhitelist, blacklist)).toBe(true);
  });

  it('when both are disabled, everything is allowed', () => {
    expect(isUrlAllowed(url('https://anything.com/page'), disabledWhitelist, disabledBlacklist)).toBe(
      true,
    );
  });

  it('matches against hostname+path as well as bare hostname', () => {
    const whitelist = enabledWhitelist(['example.com/articles/*']);
    expect(isUrlAllowed(url('https://example.com/articles/1'), whitelist, disabledBlacklist)).toBe(
      true,
    );
    expect(isUrlAllowed(url('https://example.com/other'), whitelist, disabledBlacklist)).toBe(false);
  });
});

describe('findMatchingCustomization', () => {
  const rule = (overrides: Partial<SiteCustomizationItem>): SiteCustomizationItem => ({
    enable: true,
    pattern: 'example.com',
    selectors: [],
    ...overrides,
  });

  it('returns the first enabled rule whose pattern matches', () => {
    const rules = [
      rule({ pattern: 'nomatch.com', selectors: ['.a'] }),
      rule({ pattern: '*.example.com', selectors: ['.b'] }),
    ];
    const found = findMatchingCustomization(url('https://sub.example.com/x'), rules);
    expect(found?.selectors).toEqual(['.b']);
  });

  it('skips disabled rules even if the pattern matches', () => {
    const rules = [rule({ pattern: 'example.com', enable: false, selectors: ['.a'] })];
    expect(findMatchingCustomization(url('https://example.com'), rules)).toBeUndefined();
  });

  it('returns undefined when nothing matches', () => {
    const rules = [rule({ pattern: 'nomatch.com' })];
    expect(findMatchingCustomization(url('https://example.com'), rules)).toBeUndefined();
  });
});
