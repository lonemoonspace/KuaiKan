import './timing-bg';
import { browser } from 'wxt/browser';
import {
  seedPromptLibraryInBackground,
} from '@/lib/prompt-settings-storage';
import { onMessage } from '@/lib/messaging';
import { registerAiSdkConnectBridge } from './ai-sdk-connect-bridge';
import { registerTokenCountMessages } from './token-count-bg';
import { setupOnInstallHook } from './onInstall';
import { registerControlMessages, addContextMenus, initializeControlHandlers } from './control';
import { setupCorsFixRule } from './cors-fix';
import { registerPanelSnapshotMessages } from './panel-snapshot-bg';

import { createLogger } from '@/lib/logger';

const logger = createLogger('background:index');

export default defineBackground(() => {
  logger.info('Hello background!', { id: browser.runtime.id });

  function seedPromptLibrary() {
    seedPromptLibraryInBackground().catch((error) => {
      logger.error('Failed to create initial prompt.', error);
    });
  }

  // All contexts request seeding through this single-flight background handler
  // so the check-then-create sequence can never race across contexts. Failures
  // resolve (not reject) so one transient storage error can't dead-init the
  // caller's panel/popup.
  onMessage('seedPromptLibrary', async () => {
    try {
      const prompt = await seedPromptLibraryInBackground();
      return { seeded: prompt !== null };
    } catch (error) {
      logger.error('Failed to seed prompt library.', error);
      return { seeded: false };
    }
  });

  setupOnInstallHook();
  seedPromptLibrary();
  setupCorsFixRule().catch((err) => logger.error('Failed to setup CORS fix rule:', err));
  registerAiSdkConnectBridge();
  registerTokenCountMessages();
  registerPanelSnapshotMessages();
  registerControlMessages();
  addContextMenus().catch((err) => logger.error('Failed to setup context menus:', err));
  initializeControlHandlers();
});
