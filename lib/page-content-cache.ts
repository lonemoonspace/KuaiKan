import type { WebpageContent } from '@/lib/page-extraction';

type PageSignature = { length: number; headHash: number; tailHash: number };

type CacheEntry = {
  href: string;
  content: WebpageContent;
  tokenCount: number | null;
  signature: PageSignature;
};

const cache = new Map<string, CacheEntry>();

// Long SPA sessions visit many routes; each entry holds the full article twice
// (text and HTML), so keep only the most recent few.
const MAX_CACHE_ENTRIES = 20;

// Characters sampled from each end of the live page text. Cheap next to the
// `innerText` read itself, and sampling both ends catches an equal-length swap
// at either end of the page.
const SIGNATURE_WINDOW = 512;

function hashRange(text: string, start: number, end: number): number {
  let hash = 0;
  for (let i = start; i < end; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return hash;
}

// Deliberately a heuristic, not a full-text hash: `innerText` is re-read on
// every lookup, and hashing the whole page (or digesting it through
// `crypto.subtle`) would cost more than the extraction it avoids. Length plus
// both 512-character windows catches the realistic cases — content appended,
// replaced, or swapped at the head — while two same-length pages sharing both
// windows still collide. Short texts (under two windows) are sampled once, as
// the tail window starts where the head one ends.
function readSignature(): PageSignature {
  const text = document.body?.innerText ?? '';
  const headEnd = Math.min(text.length, SIGNATURE_WINDOW);
  const tailStart = Math.max(headEnd, text.length - SIGNATURE_WINDOW);
  return {
    length: text.length,
    headHash: hashRange(text, 0, headEnd),
    tailHash: hashRange(text, tailStart, text.length),
  };
}

function isFresh(entry: CacheEntry): boolean {
  const signature = readSignature();
  return (
    entry.signature.length === signature.length &&
    entry.signature.headHash === signature.headHash &&
    entry.signature.tailHash === signature.tailHash
  );
}

export function getCachedPageContent(
  href: string,
): { content: WebpageContent; tokenCount: number | null } | null {
  const entry = cache.get(href);
  if (!entry || !isFresh(entry)) return null;
  cache.delete(href);
  cache.set(href, entry);
  return { content: entry.content, tokenCount: entry.tokenCount };
}

export function cachePageContent(href: string, content: WebpageContent): void {
  // Re-inserting moves the key to the end, so Map iteration order is recency.
  cache.delete(href);
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(href, {
    href,
    content,
    tokenCount: null,
    signature: readSignature(),
  });
}

export function cachePageContentTokenCount(href: string, tokenCount: number): void {
  const entry = cache.get(href);
  if (entry) entry.tokenCount = tokenCount;
}