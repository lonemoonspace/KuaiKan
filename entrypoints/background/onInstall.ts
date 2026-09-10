import { browser } from 'wxt/browser';
import { runFullMigration } from '@/lib/migration';
import { seedPromptLibraryInBackground } from '@/lib/prompt-settings-storage';

import { createLogger } from '@/lib/logger';

const logger = createLogger('background:onInstall');

export function setupOnInstallHook() {
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      // First install logic if needed
    } else if (details.reason === 'update') {
      await handleExtensionUpdate(details.previousVersion);
    }
  });
}

async function handleExtensionUpdate(previousVersion?: string) {
  try {
    const logs = await runFullMigration();
    logger.info(
      `Migration during extension update (from ${previousVersion ?? 'unknown'}) completed:`,
      logs,
    );
  } catch (err) {
    logger.error('Failed to run migration during update:', err);
  }

  // The migration may have cleared a stale "already seeded" flag (see
  // runFullMigration). Seeding runs at worker startup, which is BEFORE this
  // listener fires, so retry here rather than making the user restart Chrome.
  try {
    await seedPromptLibraryInBackground();
  } catch (err) {
    logger.error('Failed to re-seed prompt library after migration:', err);
  }
}
