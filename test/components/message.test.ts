import { describe, expect, it } from 'vitest';
import {
  buildCitationChips,
  citationMarkersToQuotes,
  extractCitationPhrases,
  getHeadingTone,
  renderMarkdownToHtml,
} from '@/components/ai-elements/message';

// These two functions implement the citation-chip convention agreed with the
// prompts (see message.tsx's CITATION_PATTERN comment): a key point may end
// with `⟦cite:原文短句⟧` (or the legacy `⟦引用:原文短句⟧`), which gets pulled out
// of the raw text before Markdown parsing and swapped back in as a clickable
// chip after. 1.5.1 fixed a double-escaping bug here, so these are worth
// pinning down.
describe('extractCitationPhrases', () => {
  it('extracts a single cite: marker into a placeholder + phrase list', () => {
    const { text, phrases } = extractCitationPhrases('Summary says ⟦cite:the sky is blue⟧.');
    expect(text).toBe('Summary says ⟦kuai-cite:0⟧.');
    expect(phrases).toEqual(['the sky is blue']);
  });

  it('also accepts the legacy 引用: prefix', () => {
    const { text, phrases } = extractCitationPhrases('结论 ⟦引用:原文短句⟧ 结束。');
    expect(text).toBe('结论 ⟦kuai-cite:0⟧ 结束。');
    expect(phrases).toEqual(['原文短句']);
  });

  it('handles both prefixes mixed in the same text, indexed in order of appearance', () => {
    const { text, phrases } = extractCitationPhrases(
      'A ⟦cite:first⟧ B ⟦引用:second⟧ C',
    );
    expect(text).toBe('A ⟦kuai-cite:0⟧ B ⟦kuai-cite:1⟧ C');
    expect(phrases).toEqual(['first', 'second']);
  });

  it('collapses internal whitespace and trims each extracted phrase', () => {
    const { phrases } = extractCitationPhrases('⟦cite:  a   b\n  c  ⟧');
    expect(phrases).toEqual(['a b c']);
  });

  it('leaves text with no markers untouched and returns an empty phrase list', () => {
    const { text, phrases } = extractCitationPhrases('plain text, no markers here');
    expect(text).toBe('plain text, no markers here');
    expect(phrases).toEqual([]);
  });

  it('preserves markdown-special characters inside a phrase verbatim (not yet escaped)', () => {
    const { phrases } = extractCitationPhrases('⟦cite:<b>&"quoted"* text</b>⟧');
    expect(phrases).toEqual(['<b>&"quoted"* text</b>']);
  });
});

describe('buildCitationChips', () => {
  it('restores a placeholder into a chip span carrying the original phrase', () => {
    const html = buildCitationChips('<p>Summary says ⟦kuai-cite:0⟧.</p>', ['the sky is blue']);
    expect(html).toBe(
      '<p>Summary says <span class="kuai-cite" data-cite-phrase="the sky is blue" role="button" tabindex="0" title="the sky is blue">“the sky is blue”</span>.</p>',
    );
  });

  it('html-escapes markdown/HTML-special characters (& < > " *) in the phrase exactly once', () => {
    const html = buildCitationChips('⟦kuai-cite:0⟧', ['<b>&"quoted"* text</b>']);
    // `*` is not an HTML-special character, so it passes through unescaped;
    // & < > " are each escaped exactly once (no double-escaping regression).
    expect(html).toBe(
      '<span class="kuai-cite" data-cite-phrase="&lt;b&gt;&amp;&quot;quoted&quot;* text&lt;/b&gt;" role="button" tabindex="0" title="&lt;b&gt;&amp;&quot;quoted&quot;* text&lt;/b&gt;">“&lt;b&gt;&amp;&quot;quoted&quot;* text&lt;/b&gt;”</span>',
    );
  });

  it('truncates the visible label at 60 chars with an ellipsis, but keeps the full phrase in the title/data attributes', () => {
    const longPhrase = 'a'.repeat(61);
    const html = buildCitationChips('⟦kuai-cite:0⟧', [longPhrase]);
    const expectedDisplay = `${'a'.repeat(60)}…`;
    expect(html).toContain(`data-cite-phrase="${longPhrase}"`);
    expect(html).toContain(`title="${longPhrase}"`);
    // Only the visible label is truncated -- it must carry the ellipsis and
    // stop at 60 chars, not the full 61-char phrase.
    expect(html).toContain(`“${expectedDisplay}”`);
    expect(html).not.toContain(`“${longPhrase}”`);
  });

  it('does not truncate a phrase that is exactly 60 chars', () => {
    const phrase = 'b'.repeat(60);
    const html = buildCitationChips('⟦kuai-cite:0⟧', [phrase]);
    expect(html).toContain(`“${phrase}”`);
    expect(html).not.toContain('…');
  });

  it('drops an unmatched placeholder (index with no corresponding phrase) rather than leaving it or throwing', () => {
    const html = buildCitationChips('<p>before ⟦kuai-cite:5⟧ after</p>', []);
    expect(html).toBe('<p>before  after</p>');
  });

  it('restores multiple placeholders independently by index', () => {
    const html = buildCitationChips('⟦kuai-cite:1⟧ then ⟦kuai-cite:0⟧', ['first', 'second']);
    expect(html).toBe(
      '<span class="kuai-cite" data-cite-phrase="second" role="button" tabindex="0" title="second">“second”</span>' +
        ' then ' +
        '<span class="kuai-cite" data-cite-phrase="first" role="button" tabindex="0" title="first">“first”</span>',
    );
  });

  it('leaves html with no placeholders untouched', () => {
    expect(buildCitationChips('<p>no citations here</p>', ['unused'])).toBe(
      '<p>no citations here</p>',
    );
  });

  it('does not splice a chip into an attribute when the placeholder survived inside a tag', () => {
    // A model that writes `[x](⟦cite:…⟧)` puts the placeholder in the href.
    // Substituting there would tear the anchor apart.
    const html = buildCitationChips('<a href="⟦kuai-cite:0⟧">x</a>', ['p']);
    expect(html).toBe('<a href="⟦kuai-cite:0⟧">x</a>');
    expect(html).not.toContain('data-cite-phrase');
  });

  it('still replaces placeholders that sit in text next to a tag', () => {
    const html = buildCitationChips('<p>a ⟦kuai-cite:0⟧ <b>b</b></p>', ['p']);
    expect(html).toContain('data-cite-phrase="p"');
    expect(html).toContain('<b>b</b>');
  });
});

// The renderer is the only thing standing between page-influenced model output
// and `dangerouslySetInnerHTML`, so the escaping and link/image policies are
// pinned against the real `marked` instead of a re-implementation of it.
describe('renderMarkdownToHtml', () => {
  it('escapes an HTML alt text instead of injecting it (image alt XSS regression)', async () => {
    const html = await renderMarkdownToHtml(
      '![<img src=x onerror=alert(1)>](javascript:alert(1))',
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('never emits an img, even for a safe absolute URL', async () => {
    const html = await renderMarkdownToHtml('![a diagram](https://example.com/a.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('a diagram');
  });

  it('escapes raw HTML blocks and inline HTML', async () => {
    expect(await renderMarkdownToHtml('<img src=x onerror=alert(1)>')).toContain(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
    expect(await renderMarkdownToHtml('a <b onclick="x">b</b> c')).not.toContain('<b onclick');
  });

  it('keeps the protocol whitelist for links and neutralises javascript:', async () => {
    const safe = await renderMarkdownToHtml('[ok](https://example.com)');
    expect(safe).toContain('href="https://example.com"');
    expect(safe).toContain('rel="noopener noreferrer"');

    const unsafe = await renderMarkdownToHtml('[bad](javascript:alert(1))');
    expect(unsafe).toContain('href="#"');
    expect(unsafe).not.toContain('javascript:');
  });

  it('renders citation chips for markers in the model output', async () => {
    const html = await renderMarkdownToHtml('要点 ⟦cite:原文短句⟧');
    expect(html).toContain('class="kuai-cite"');
    expect(html).toContain('data-cite-phrase="原文短句"');
  });
});

describe('getHeadingTone', () => {
  it('marks the built-in presets\' conclusion and caveat sections', () => {
    expect(getHeadingTone('核心结论')).toBe('key');
    expect(getHeadingTone('注意事项')).toBe('caution');
  });

  it('recognises common English and Chinese variants', () => {
    expect(getHeadingTone('Key Takeaways')).toBe('key');
    expect(getHeadingTone('TL;DR')).toBe('key');
    expect(getHeadingTone('风险与限制')).toBe('caution');
    expect(getHeadingTone('Caveats')).toBe('caution');
  });

  it('leaves ordinary headings untoned', () => {
    expect(getHeadingTone('关键要点')).toBeNull();
    expect(getHeadingTone('详细内容')).toBeNull();
  });
});

describe('citationMarkersToQuotes', () => {
  it('turns both marker prefixes into the quoted phrase', () => {
    expect(citationMarkersToQuotes('要点 ⟦cite:原文 短句⟧。另一点 ⟦引用:第二句⟧')).toBe(
      '要点 “原文 短句”。另一点 “第二句”',
    );
  });

  it('collapses whitespace inside the phrase and leaves other text alone', () => {
    expect(citationMarkersToQuotes('## 标题\n- a ⟦cite:  x\n  y ⟧')).toBe('## 标题\n- a “x y”');
  });
});
