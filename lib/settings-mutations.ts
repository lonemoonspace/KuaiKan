import type { ModelConfigItem, ModelDraft } from '@/constants/model-settings';
import type { PromptConfigItem, PromptDraft } from '@/constants/prompt-settings';
import type { ModelSettings } from '@/lib/model-settings-storage';
import type { PromptSettings } from '@/lib/prompt-settings-storage';

/**
 * Settings mutations are requested as data, not run in the calling context.
 *
 * Every one of them is a read-modify-write of a single storage key, and the
 * callers live in different contexts (the in-page panel, the popup, the options
 * page). Running them inside the background worker, behind one queue, is what
 * keeps two of them from interleaving and losing an update -- the reason panel
 * snapshots are serialized the same way. The previous design had each context
 * write storage directly, so a model edit in the options page and a model
 * switch in the panel could silently overwrite each other.
 *
 * Every response carries the freshly reloaded settings so the caller can apply
 * them without a second round trip.
 */
export type ModelMoveDirection = 'up' | 'down';

export type ModelMutationRequest =
  | { op: 'create'; draft: ModelDraft }
  | { op: 'update'; id: string; draft: ModelDraft }
  | { op: 'delete'; id: string }
  | { op: 'move'; id: string; direction: ModelMoveDirection }
  | { op: 'setDefault'; id: string }
  | { op: 'setModelId'; configId: string; modelId: string }
  | { op: 'replace'; settings: ModelSettings };

export type ModelMutationResponse =
  | { op: 'create'; settings: ModelSettings; created: ModelConfigItem }
  | { op: 'update'; settings: ModelSettings; updated: ModelConfigItem }
  | { op: 'delete' | 'move' | 'setDefault' | 'setModelId'; settings: ModelSettings; changed: boolean }
  | {
      op: 'replace';
      settings: ModelSettings;
      /** Rows the import asked to save and that this version accepted. */
      saved: number;
      /** Rows the import asked to save that had to be skipped. */
      rejected: number;
      /** Unparsed rows carried over from storage untouched. */
      preserved: number;
    };

export type PromptMutationRequest =
  | { op: 'create'; draft: PromptDraft }
  | { op: 'update'; id: string; draft: PromptDraft }
  | { op: 'delete'; id: string }
  | { op: 'move'; id: string; direction: ModelMoveDirection }
  | { op: 'setDefault'; id: string };

export type PromptMutationResponse =
  | { op: 'create'; settings: PromptSettings; created: PromptConfigItem }
  | { op: 'update'; settings: PromptSettings; updated: PromptConfigItem }
  | { op: 'delete' | 'move' | 'setDefault'; settings: PromptSettings; changed: boolean };
