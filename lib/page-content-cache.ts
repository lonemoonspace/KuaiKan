import type { WebpageContent } from '@/lib/page-extraction';

type CacheEntry = {
  href: string;
  content: WebpageContent;
  tokenCount: number | null;
  signature: { length: number; headHash: number };
  timestamp: number;
};

const cache = new Map<string, CacheEntry>();

function readSignature(): { length: number; headHash: number } {
  const text = document.body?.innerText ?? '';
  let headHash = 0;
  const head = text.slice(0, 512);
  for (let i = 0; i < head.length; i += 1) {
    headHash = ((headHash << 5) - headHash + head.charCodeAt(i)) | 0;
  }
  return { length: text.length, headHash };
}

function isFresh(entry: CacheEntry): boolean {
  const signature = readSignature();
  return (
    entry.signature.length === signature.length &&
    entry.signature.headHash === signature.headHash
  );
}

export function getCachedPageContent(
  href: string,
): { content: WebpageContent; tokenCount: number | null } | null {
  const entry = cache.get(href);
  if (!entry || !isFresh(entry)) return null;
  return { content: entry.content, tokenCount: entry.tokenCount };
}

export function cachePageContent(href: string, content: WebpageContent): void {
  cache.set(href, {
    href,
    content,
    tokenCount: null,
    signature: readSignature(),
    timestamp: Date.now(),
  });
}

export function cachePageContentTokenCount(href: string, tokenCount: number): void {
  const entry = cache.get(href);
  if (entry) entry.tokenCount = tokenCount;
}