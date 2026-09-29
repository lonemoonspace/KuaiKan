import { onMessage } from '@/lib/messaging';
import { assertTrustedSender } from '@/lib/background-trust';
import {
  createModelConfig,
  deleteModelConfig,
  loadModelSettings,
  moveModelConfig,
  replaceModelSettings,
  setDefaultModelConfig,
  setModelConfigModelId,
  updateModelConfig,
} from '@/lib/model-settings-storage';
import {
  createPrompt,
  deletePrompt,
  loadPromptSettings,
  movePrompt,
  setDefaultPrompt,
  updatePrompt,
} from '@/lib/prompt-settings-storage';
import type {
  ModelMutationRequest,
  ModelMutationResponse,
  PromptMutationRequest,
  PromptMutationResponse,
} from '@/lib/settings-mutations';

import { createLogger } from '@/lib/logger';

const logger = createLogger('background:settings-mutations');

/**
 * Model and prompt mutations, executed in the background behind one queue.
 *
 * Each mutation is a read-modify-write of a whole storage key, and the callers
 * live in separate contexts (in-page panel, popup, options page). Without a
 * single owner the sequence interleaves: both sides read the same array, both
 * write it back, and the later write silently drops the earlier change. This is
 * the same reasoning behind the panel-snapshot queue; the difference is that
 * these keys hold user data (including API keys) that cannot be recreated.
 */
function createQueue() {
  let queue: Promise<unknown> = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };
}

async function applyModelMutation(
  request: ModelMutationRequest,
): Promise<ModelMutationResponse> {
  switch (request.op) {
    case 'create': {
      const created = await createModelConfig(request.draft);
      return { op: 'create', created, settings: await loadModelSettings() };
    }
    case 'update': {
      const updated = await updateModelConfig(request.id, request.draft);
      return { op: 'update', updated, settings: await loadModelSettings() };
    }
    case 'delete': {
      const changed = await deleteModelConfig(request.id);
      return { op: 'delete', changed, settings: await loadModelSettings() };
    }
    case 'move': {
      const changed = await moveModelConfig(request.id, request.direction);
      return { op: 'move', changed, settings: await loadModelSettings() };
    }
    case 'setDefault': {
      const changed = await setDefaultModelConfig(request.id);
      return { op: 'setDefault', changed, settings: await loadModelSettings() };
    }
    case 'setModelId': {
      const changed = await setModelConfigModelId(request.configId, request.modelId);
      return { op: 'setModelId', changed, settings: await loadModelSettings() };
    }
    case 'replace': {
      const written = await replaceModelSettings(request.settings);
      return {
        op: 'replace',
        saved: written.models.length,
        rejected: written.rejected,
        preserved: written.preserved,
        settings: await loadModelSettings(),
      };
    }
  }
}

async function applyPromptMutation(
  request: PromptMutationRequest,
): Promise<PromptMutationResponse> {
  switch (request.op) {
    case 'create': {
      const created = await createPrompt(request.draft);
      return { op: 'create', created, settings: await loadPromptSettings() };
    }
    case 'update': {
      const updated = await updatePrompt(request.id, request.draft);
      return { op: 'update', updated, settings: await loadPromptSettings() };
    }
    case 'delete': {
      const changed = await deletePrompt(request.id);
      return { op: 'delete', changed, settings: await loadPromptSettings() };
    }
    case 'move': {
      const changed = await movePrompt(request.id, request.direction);
      return { op: 'move', changed, settings: await loadPromptSettings() };
    }
    case 'setDefault': {
      const changed = await setDefaultPrompt(request.id);
      return { op: 'setDefault', changed, settings: await loadPromptSettings() };
    }
  }
}

export function registerSettingsMutationMessages() {
  const serialize = createQueue();

  onMessage('mutateModelSettings', ({ data, sender }) => {
    assertTrustedSender(sender);

    return serialize(() => applyModelMutation(data)).catch((error) => {
      logger.error('[settings-mutations] Model mutation failed', error);
      throw error;
    });
  });

  onMessage('mutatePromptSettings', ({ data, sender }) => {
    assertTrustedSender(sender);

    return serialize(() => applyPromptMutation(data)).catch((error) => {
      logger.error('[settings-mutations] Prompt mutation failed', error);
      throw error;
    });
  });
}
