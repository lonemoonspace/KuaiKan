import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same harness as test/lib/model-settings-storage.test.ts: an in-memory store
// behind the '#imports' alias, so the read-modify-write behaviour (including
// what a write does to rows this version cannot parse) is exercised for real.
const { mockStore } = vi.hoisted(() => ({ mockStore: new Map<string, unknown>() }));

vi.mock('#imports', () => ({
  storage: {
    getItems: async (
      specs: Array<{ key: string; options?: { fallback?: unknown } }>,
    ) =>
      specs.map((spec) => ({
        key: spec.key,
        value: mockStore.has(spec.key) ? mockStore.get(spec.key) : spec.options?.fallback,
      })),
    setItems: async (items: Array<{ key: string; value: unknown }>) => {
      for (const item of items) mockStore.set(item.key, item.value);
    },
    setItem: async (key: string, value: unknown) => {
      mockStore.set(key, value);
    },
    getItem: async (key: string) => (mockStore.has(key) ? mockStore.get(key) : null),
    watch: (_key: string, _callback: (newValue: unknown, oldValue: unknown) => void) => () => {},
  },
}));

import {
  DEFAULT_PROMPT_ID_STORAGE_KEY,
  PROMPT_CONFIG_STORAGE_KEY,
} from '@/constants/prompt-settings';
import {
  createPrompt,
  deletePrompt,
  loadPromptSettings,
  updatePrompt,
} from '@/lib/prompt-settings-storage';

const PROMPT_BASE = {
  id: 'p1',
  name: 'Summarize',
  systemMessage: 'You summarize pages.',
  userMessage: 'Summarize:\n{{textContent}}',
  at: 1,
};

const UNPARSED_ROW = { id: 'future-1', name: 'Written by a newer build' };

describe('prompt settings storage', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('loads stored prompts and falls back to the first when the default id points nowhere', async () => {
    mockStore.set(PROMPT_CONFIG_STORAGE_KEY, [{ ...PROMPT_BASE }]);
    mockStore.set(DEFAULT_PROMPT_ID_STORAGE_KEY, 'missing');

    const settings = await loadPromptSettings();

    expect(settings.prompts).toHaveLength(1);
    expect(settings.defaultPromptId).toBe('p1');
  });

  it('stores a fresh copy of every edited field', async () => {
    mockStore.set(PROMPT_CONFIG_STORAGE_KEY, [{ ...PROMPT_BASE }]);

    await updatePrompt('p1', {
      name: 'Renamed',
      systemMessage: 'sys',
      userMessage: 'usr',
    });

    const settings = await loadPromptSettings();

    expect(settings.prompts[0]).toMatchObject({
      id: 'p1',
      name: 'Renamed',
      systemMessage: 'sys',
      userMessage: 'usr',
    });
  });

  it('keeps a row this version cannot parse when another prompt is written', async () => {
    mockStore.set(PROMPT_CONFIG_STORAGE_KEY, [{ ...PROMPT_BASE }, { ...UNPARSED_ROW }]);

    await deletePrompt('p1');

    // The unparsed row survives; only the managed row went away.
    expect(mockStore.get(PROMPT_CONFIG_STORAGE_KEY)).toEqual([{ ...UNPARSED_ROW }]);
  });

  it('never reuses a name that is already taken', async () => {
    mockStore.set(PROMPT_CONFIG_STORAGE_KEY, [{ ...PROMPT_BASE }]);

    const created = await createPrompt({
      name: 'Summarize',
      systemMessage: 's',
      userMessage: 'u',
    });

    expect(created.name).toBe('Summarize 2');
  });

  it('refuses a draft missing any of its three fields', async () => {
    await expect(
      createPrompt({ name: 'x', systemMessage: '', userMessage: 'u' }),
    ).rejects.toThrow();
  });
});
