import { storage } from '#imports';
import {
  createDefaultGeneralSettings,
  getGeneralSettingEntries,
  type GeneralSettingKey,
  type GeneralSettings,
} from '@/constants/general-settings';

export async function loadGeneralSettings(): Promise<GeneralSettings> {
  const defaults = createDefaultGeneralSettings();
  const definitions = getGeneralSettingEntries();
  const storedItems = await storage.getItems(
    definitions.map(([key, definition]) => ({
      key: definition.storageKey,
      options: { fallback: defaults[key] },
    })),
  );

  return Object.fromEntries(
    definitions.map(([key, definition], index) => [
      key,
      definition.parse(storedItems[index]?.value, defaults[key]),
    ]),
  ) as GeneralSettings;
}

/**
 * Persist a settings form, writing only the fields the user actually edited.
 *
 * `baseline` is the snapshot the caller loaded when its form mounted. Diffing
 * against that — rather than against whatever is in storage right now — is what
 * makes this safe: a key changed by another context in the meantime (e.g. the
 * content script writing `enable-floating-ball=false` when the user dismisses
 * the ball) is neither in the diff nor overwritten. Diffing against current
 * storage would do the opposite, flagging that concurrent change as a user edit
 * and reverting it.
 *
 * Without a baseline every field is written, which is the old whole-object
 * behaviour and only correct when the caller genuinely owns all of them.
 */
export async function saveGeneralSettings(
  settings: GeneralSettings,
  baseline?: GeneralSettings | null,
) {
  const defaults = createDefaultGeneralSettings();

  const items = getGeneralSettingEntries()
    .map(([key, definition]) => ({
      key: definition.storageKey,
      settingKey: key,
      value: definition.parse(settings[key], defaults[key]),
    }))
    .filter((item) => !baseline || item.value !== baseline[item.settingKey]);

  if (items.length === 0) return;

  await storage.setItems(items.map(({ key, value }) => ({ key, value })));
}

/**
 * Write a single setting without touching any other key. Preferred whenever the
 * caller only means to change one field.
 */
export async function saveGeneralSetting<Key extends GeneralSettingKey>(
  key: Key,
  value: GeneralSettings[Key],
) {
  const defaults = createDefaultGeneralSettings();
  // Look the definition up through the widened entries helper: indexing the
  // definition map with a generic key collapses the per-key `parse` overloads
  // into an unusable intersection.
  const entry = getGeneralSettingEntries().find(([entryKey]) => entryKey === key);
  if (!entry) return;

  const [, definition] = entry;

  await storage.setItem(
    definition.storageKey,
    definition.parse(value, defaults[key]),
  );
}
