// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';

import {
  focusNextInside,
  getActiveElement,
  getFocusableElements,
  nextFocusIndex,
} from '@/lib/focus-trap';

describe('nextFocusIndex', () => {
  it('returns -1 when there is nothing to focus', () => {
    expect(nextFocusIndex(0, 0, false)).toBe(-1);
    expect(nextFocusIndex(-1, 0, true)).toBe(-1);
  });

  it('enters the trap from outside, forwards or backwards', () => {
    expect(nextFocusIndex(-1, 3, false)).toBe(0);
    expect(nextFocusIndex(-1, 3, true)).toBe(2);
    // An index past the end (element removed while focused) is treated the
    // same way.
    expect(nextFocusIndex(7, 3, false)).toBe(0);
  });

  it('wraps around at both ends', () => {
    expect(nextFocusIndex(2, 3, false)).toBe(0);
    expect(nextFocusIndex(0, 3, true)).toBe(2);
    expect(nextFocusIndex(1, 3, false)).toBe(2);
  });
});

describe('getFocusableElements', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.append(root);
  });

  it('keeps tabbable elements in DOM order and drops disabled ones', () => {
    root.innerHTML = `
      <a href="#one">one</a>
      <button>two</button>
      <button disabled>three</button>
      <input />
      <input type="hidden" />
      <div tabindex="-1">not tabbable</div>
      <div tabindex="0">tabbable div</div>
    `;

    expect(getFocusableElements(root).map((el) => el.textContent?.trim())).toEqual([
      'one',
      'two',
      '',
      'tabbable div',
    ]);
  });

  it('skips elements hidden by CSS, which jsdom reports without layout', () => {
    root.innerHTML = `
      <button style="display: none">hidden</button>
      <button style="visibility: hidden">invisible</button>
      <button>visible</button>
    `;

    expect(getFocusableElements(root).map((el) => el.textContent)).toEqual(['visible']);
  });
});

describe('getActiveElement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('descends into a shadow root instead of stopping at the host', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inside = document.createElement('button');
    inside.textContent = 'inside';
    shadow.append(inside);

    inside.focus();

    expect(document.activeElement).toBe(host);
    expect(getActiveElement(inside)).toBe(inside);
  });
});

describe('focusNextInside', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('cycles through the trapped elements and wraps', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button>first</button><button>second</button>';
    document.body.append(root);
    const [first, second] = getFocusableElements(root);

    expect(focusNextInside(root, false)).toBe(first);
    expect(focusNextInside(root, false)).toBe(second);
    expect(focusNextInside(root, false)).toBe(first);
    expect(focusNextInside(root, true)).toBe(second);
  });

  it('returns null when the trap has no focusable content', () => {
    const root = document.createElement('div');
    root.textContent = 'nothing to focus here';
    document.body.append(root);

    expect(focusNextInside(root, false)).toBeNull();
  });
});
