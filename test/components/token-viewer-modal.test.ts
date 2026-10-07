import { describe, expect, it } from 'vitest';

import { isTokenKept } from '@/components/TokenViewerModal';

// The viewer must mirror what the background really sends, otherwise it shows a
// green "kept" token that was actually cut (or the reverse).
const keptIndexes = (total: number, keep: number, behaviour: 'front' | 'back' | 'middle' | 'nothing', marker = 0) =>
  Array.from({ length: total }, (_, index) => index).filter((index) =>
    isTokenKept(index, total, keep, behaviour, marker),
  );

describe('isTokenKept', () => {
  it('keeps everything when the content already fits or the strategy is "nothing"', () => {
    expect(keptIndexes(5, 10, 'front')).toEqual([0, 1, 2, 3, 4]);
    expect(keptIndexes(5, 0, 'nothing')).toEqual([0, 1, 2, 3, 4]);
    expect(keptIndexes(5, 0, 'front')).toEqual([]);
  });

  it('keeps the first `keep` tokens for the front strategy', () => {
    expect(keptIndexes(10, 3, 'front')).toEqual([0, 1, 2]);
  });

  it('keeps the last `keep` tokens for the back strategy', () => {
    expect(keptIndexes(10, 3, 'back')).toEqual([7, 8, 9]);
  });

  it('splits the budget head/tail for the middle strategy', () => {
    expect(keptIndexes(10, 4, 'middle')).toEqual([0, 1, 8, 9]);
    // Odd budgets give the extra token to the tail, matching the background.
    expect(keptIndexes(10, 5, 'middle')).toEqual([0, 1, 7, 8, 9]);
  });

  it('subtracts the truncation marker before splitting, so head/tail match the background', () => {
    // keep 6 - marker 2 => budget 4 => 2 head + 2 tail.
    expect(keptIndexes(10, 6, 'middle', 2)).toEqual([0, 1, 8, 9]);
  });

  it('keeps the head, like the background, when the marker alone eats the whole budget', () => {
    expect(keptIndexes(10, 4, 'middle', 4)).toEqual([0, 1, 2, 3]);
    expect(keptIndexes(10, 4, 'middle', 99)).toEqual([0, 1, 2, 3]);
  });
});
