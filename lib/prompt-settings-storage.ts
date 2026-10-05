import { storage } from '#imports';
import { uid } from 'radash';
import {
  DEFAULT_PROMPT_ID_STORAGE_KEY,
  getPromptPreset,
  PROMPT_CONFIG_STORAGE_KEY,
  PROMPT_LIBRARY_SEEDED_STORAGE_KEY,
  type PromptConfigItem,
  type PromptDraft,
} from '@/constants/prompt-settings';

export type PromptSettings = {
  defaultPromptId: string | null;
  prompts: PromptConfigItem[];
};

type PromptMoveDirection = 'down' | 'up';

function cleanMessage(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanName(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPromptConfigItem(value: unknown): value is PromptConfigItem {
  if (!value || typeof value !== 'object') return false;

  const prompt = value as Record<string, unknown>;

  return (
    typeof prompt.id === 'string' &&
    typeof prompt.name === 'string' &&
    typeof prompt.systemMessage === 'string' &&
    typeof prompt.userMessage === 'string'
  );
}

function normalizePrompt(value: PromptConfigItem): PromptConfigItem | null {
  const name = cleanName(value.name);
  const systemMessage = cleanMessage(value.systemMessage);
  const userMessage = cleanMessage(value.userMessage);

  if (!value.id || !name || !systemMessage || !userMessage) {
    return null;
  }

  return {
    at: typeof value.at === 'number' ? value.at : Date.now(),
    id: value.id,
    name,
    systemMessage,
    userMessage,
  };
}

/**
 * See the model-side `splitModelRows`: loading is tolerant, and writes must not
 * turn that tolerance into deletion, so unparsed rows are carried along instead
 * of being dropped.
 */
function splitPromptRows(value: unknown): {
  prompts: PromptConfigItem[];
  unparsed: unknown[];
} {
  if (!Array.isArray(value)) return { prompts: [], unparsed: [] };

  const prompts: PromptConfigItem[] = [];
  const unparsed: unknown[] = [];

  for (const item of value) {
    const normalized = isPromptConfigItem(item) ? normalizePrompt(item) : null;

    if (!normalized) {
      unparsed.push(item);
      continue;
    }

    prompts.push(normalized);
  }

  return { prompts, unparsed };
}

function parsePrompts(value: unknown) {
  return splitPromptRows(value).prompts;
}

function normalizeDraft(draft: PromptDraft): PromptDraft {
  return {
    name: cleanName(draft.name),
    systemMessage: cleanMessage(draft.systemMessage),
    userMessage: cleanMessage(draft.userMessage),
  };
}

function validateDraft(draft: PromptDraft) {
  const normalizedDraft = normalizeDraft(draft);

  if (
    !normalizedDraft.name ||
    !normalizedDraft.systemMessage ||
    !normalizedDraft.userMessage
  ) {
    throw new Error('请填写提示词名称、系统消息和用户消息。');
  }

  return normalizedDraft;
}

function isDuplicateName(
  prompts: PromptConfigItem[],
  name: string,
  excludedId?: string,
) {
  return prompts.some(
    (prompt) =>
      prompt.id !== excludedId &&
      prompt.name.localeCompare(name, undefined, { sensitivity: 'accent' }) ===
        0,
  );
}

function getUniqueName(prompts: PromptConfigItem[], name: string) {
  if (!isDuplicateName(prompts, name)) return name;

  let suffix = 2;
  let nextName = `${name} ${suffix}`;

  while (isDuplicateName(prompts, nextName)) {
    suffix += 1;
    nextName = `${name} ${suffix}`;
  }

  return nextName;
}

function normalizeDefaultPromptId(
  defaultPromptId: unknown,
  prompts: PromptConfigItem[],
) {
  return typeof defaultPromptId === 'string' &&
    prompts.some((prompt) => prompt.id === defaultPromptId)
    ? defaultPromptId
    : prompts[0]?.id ?? null;
}

/** Raw rows currently in storage that this version cannot parse. */
async function readPreservedRows(): Promise<unknown[]> {
  const raw = await storage.getItem<unknown>(PROMPT_CONFIG_STORAGE_KEY);

  return splitPromptRows(raw).unparsed;
}

function uniqueRows(rows: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];

  for (const row of rows) {
    let key: string;
    try {
      key = JSON.stringify(row) ?? String(row);
    } catch {
      key = String(row);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }

  return result;
}

export type PromptSettingsWriteResult = {
  defaultPromptId: string | null;
  prompts: PromptConfigItem[];
  /** Rows the caller supplied that this version cannot treat as a prompt. */
  rejected: number;
  /** Unparsed rows kept in storage (from this write and from before it). */
  preserved: number;
};

async function writePromptSettings(
  settings: PromptSettings,
): Promise<PromptSettingsWriteResult> {
  const { prompts, unparsed } = splitPromptRows(settings.prompts);
  const preserved = uniqueRows([...(await readPreservedRows()), ...unparsed]);
  const defaultPromptId = normalizeDefaultPromptId(settings.defaultPromptId, prompts);

  await storage.setItems([
    {
      key: PROMPT_CONFIG_STORAGE_KEY,
      value: [...prompts, ...preserved],
    },
    {
      key: DEFAULT_PROMPT_ID_STORAGE_KEY,
      value: defaultPromptId,
    },
  ]);

  return { defaultPromptId, prompts, rejected: unparsed.length, preserved: preserved.length };
}

export async function loadPromptSettings(): Promise<PromptSettings> {
  const [promptItem, defaultPromptItem] = await storage.getItems([
    {
      key: PROMPT_CONFIG_STORAGE_KEY,
      options: { fallback: [] },
    },
    {
      key: DEFAULT_PROMPT_ID_STORAGE_KEY,
      options: { fallback: null },
    },
  ]);
  const prompts = parsePrompts(promptItem?.value);

  return {
    defaultPromptId: normalizeDefaultPromptId(defaultPromptItem?.value, prompts),
    prompts,
  };
}

export async function createPrompt(draft: PromptDraft) {
  const settings = await loadPromptSettings();
  const normalizedDraft = validateDraft(draft);
  const prompt: PromptConfigItem = {
    ...normalizedDraft,
    at: Date.now(),
    id: uid(16),
    name: getUniqueName(settings.prompts, normalizedDraft.name),
  };

  settings.prompts.push(prompt);

  await writePromptSettings({
    defaultPromptId: settings.defaultPromptId ?? prompt.id,
    prompts: settings.prompts,
  });

  return prompt;
}

export async function updatePrompt(id: string, draft: PromptDraft) {
  const settings = await loadPromptSettings();
  const index = settings.prompts.findIndex((prompt) => prompt.id === id);

  if (index === -1) {
    throw new Error('未找到该提示词。');
  }

  const normalizedDraft = validateDraft(draft);

  if (isDuplicateName(settings.prompts, normalizedDraft.name, id)) {
    throw new Error('提示词名称已存在。');
  }

  settings.prompts[index] = {
    ...settings.prompts[index],
    ...normalizedDraft,
  };

  await writePromptSettings(settings);

  return settings.prompts[index];
}

export async function deletePrompt(id: string) {
  const settings = await loadPromptSettings();
  const prompts = settings.prompts.filter((prompt) => prompt.id !== id);

  if (prompts.length === settings.prompts.length) {
    return false;
  }

  await writePromptSettings({
    defaultPromptId:
      settings.defaultPromptId === id ? prompts[0]?.id ?? null : settings.defaultPromptId,
    prompts,
  });

  return true;
}

export async function movePrompt(id: string, direction: PromptMoveDirection) {
  const settings = await loadPromptSettings();
  const index = settings.prompts.findIndex((prompt) => prompt.id === id);
  const nextIndex = direction === 'up' ? index - 1 : index + 1;

  if (
    index === -1 ||
    nextIndex < 0 ||
    nextIndex >= settings.prompts.length
  ) {
    return false;
  }

  const prompts = [...settings.prompts];
  [prompts[index], prompts[nextIndex]] = [prompts[nextIndex], prompts[index]];

  await writePromptSettings({
    defaultPromptId: settings.defaultPromptId,
    prompts,
  });

  return true;
}

export async function setDefaultPrompt(id: string) {
  const settings = await loadPromptSettings();

  if (!settings.prompts.some((prompt) => prompt.id === id)) {
    return false;
  }

  await writePromptSettings({
    defaultPromptId: id,
    prompts: settings.prompts,
  });

  return true;
}

/**
 * Seed the library with the sample prompt when it is empty.
 *
 * `knownPrompts` lets a caller that has just loaded the list pass it in, so the
 * seeding path does not read the same key twice for no reason.
 */
export async function ensureSamplePrompt(knownPrompts?: PromptConfigItem[]) {
  const prompts = knownPrompts ?? (await loadPromptSettings()).prompts;

  if (prompts.length > 0) {
    return prompts[0];
  }

  const preset = getPromptPreset('basic');

  return createPrompt({
    ...preset,
    name: 'Sample',
  });
}

let backgroundSeedingPromise: Promise<PromptConfigItem | null> | null = null;

async function seedPromptLibraryOnce(): Promise<PromptConfigItem | null> {
  const hasSeededLibrary = await storage.getItem<boolean>(
    PROMPT_LIBRARY_SEEDED_STORAGE_KEY,
    { fallback: false },
  );

  if (hasSeededLibrary) {
    return null;
  }

  const settings = await loadPromptSettings();
  const prompt = settings.prompts[0] ?? (await ensureSamplePrompt(settings.prompts));

  await storage.setItem(PROMPT_LIBRARY_SEEDED_STORAGE_KEY, true);

  return prompt;
}

/**
 * Single-flight seeder meant to run only inside the background worker. The
 * background is the only context whose module singleton is shared by every
 * request, so funneling all seeding through it prevents two contexts (e.g.
 * content script and options page) from both seeing "not seeded yet" and
 * creating duplicate "Sample" / "Sample 2" prompts on first run.
 */
export async function seedPromptLibraryInBackground(): Promise<PromptConfigItem | null> {
  if (backgroundSeedingPromise) return backgroundSeedingPromise;

  backgroundSeedingPromise = seedPromptLibraryOnce().finally(() => {
    backgroundSeedingPromise = null;
  });

  return backgroundSeedingPromise;
}
