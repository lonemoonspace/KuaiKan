import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GithubIcon } from '@/components/icons/GithubIcon';

// The icon used to discard every prop (`{ size: _size = 24, ..._props }`) while
// the glyph hardcoded width/height 1024 and className="size-6", so the size the
// options layout asked for was never applied.
describe('GithubIcon', () => {
  it('renders at the default size instead of the glyph’s intrinsic 1024', () => {
    const html = renderToStaticMarkup(<GithubIcon />);

    expect(html).toContain('width="24"');
    expect(html).toContain('height="24"');
    expect(html).not.toContain('width="1024"');
    expect(html).not.toContain('height="1024"');
  });

  it('applies the size the caller asks for', () => {
    const html = renderToStaticMarkup(<GithubIcon size={18} />);

    expect(html).toContain('width="18"');
    expect(html).toContain('height="18"');
  });

  it('merges the caller className and forwards other svg props', () => {
    const html = renderToStaticMarkup(
      <GithubIcon className="text-muted-foreground" data-testid="github" />,
    );

    expect(html).toContain('class="shrink-0 text-muted-foreground"');
    expect(html).toContain('data-testid="github"');
  });
});
