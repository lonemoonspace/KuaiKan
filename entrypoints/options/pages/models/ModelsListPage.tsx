import { ArrowDown, ArrowUp, Copy, Download, Edit3, Plus, Trash2, Upload } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { browser } from 'wxt/browser';
import { Button } from '@/components/ui/button';
import {
  getModelProviderDefinition,
  type ModelConfigItem,
} from '@/constants/model-settings';
import { resolveModelIconUrl } from '@/lib/model-icon';
import { getUiMessages } from '@/lib/i18n';
import {
  buildModelExportFile,
  downloadJsonFile,
  mergeImportedModels,
  parseModelExportFile,
} from '@/lib/model-transfer';
import {
  loadModelSettings,
  type ModelSettings,
} from '@/lib/model-settings-storage';
import type { ModelMutationRequest } from '@/lib/settings-mutations';
import { sendMessage as sendExtMessage } from '@/lib/messaging';
import { cn } from '@/lib/utils';
import { OptionsPageTitle } from '../OptionsPageTitle';

export function ModelsListPage() {
  const messages = getUiMessages();
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const loadedSettings = await loadModelSettings();

        if (!active) return;

        setSettings(loadedSettings);
      } catch (error) {
        if (!active) return;

        setLoadError(
          error instanceof Error ? error.message : 'Model settings failed to load.',
        );
      }
    }

    load();

    return () => {
      active = false;
    };
  }, []);

  async function reloadSettings() {
    setSettings(await loadModelSettings());
  }

  /**
   * Run one mutation in the background (the single writer for these keys) and
   * adopt the settings it returns, so the list always reflects what was
   * actually persisted rather than what this page hoped to persist.
   */
  async function runMutation(request: ModelMutationRequest): Promise<boolean> {
    const response = await sendExtMessage('mutateModelSettings', request);
    setSettings(response.settings);

    if (response.op === 'create' || response.op === 'update') return true;
    // `replace` (the import) reports counts instead of a flag; the import path
    // handles it directly and never routes through here.
    if (response.op === 'replace') return response.saved > 0;

    return response.changed;
  }

  function handleExport() {
    if (!settings) return;

    try {
      // Keys are secrets: writing them into a file that lands in ~/Downloads
      // (or a synced folder) has to be an explicit choice, not the default.
      const includeSecrets = window.confirm(messages.models.exportIncludeSecretsConfirm);

      const file = buildModelExportFile(
        settings.models,
        settings.defaultModelId,
        browser.runtime.getManifest().version,
        { includeSecrets },
      );

      downloadJsonFile(
        JSON.stringify(file, null, 2),
        `kuai-kan-models-${new Date().toISOString().slice(0, 10)}.json`,
      );
      toast.success(
        includeSecrets
          ? messages.models.exportedWithSecretsToast(file.models.length)
          : messages.models.exportedToast(file.models.length),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : messages.models.exportFailed);
    }
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Cleared first so re-picking the same file still fires onChange.
    event.currentTarget.value = '';

    if (!file) return;

    try {
      const parsed = parseModelExportFile(JSON.parse(await file.text()));

      if (!parsed.ok) {
        toast.error(parsed.error);
        return;
      }

      const current = await loadModelSettings();
      const confirmed = window.confirm(
        `导入 ${parsed.models.length} 个模型配置，替换当前的 ${current.models.length} 个？此操作无法撤销。`,
      );

      if (!confirmed) return;

      const merged = mergeImportedModels(current.models, parsed.models);
      const defaultModelId =
        parsed.defaultModelId !== null &&
        merged.some((model) => model.id === parsed.defaultModelId)
          ? parsed.defaultModelId
          : merged[0]?.id ?? null;

      const response = await sendExtMessage('mutateModelSettings', {
        op: 'replace',
        settings: { models: merged, defaultModelId },
      });
      setSettings(response.settings);

      // Report what was actually written, not what the file claimed: rows the
      // storage layer could not parse are skipped (and kept in storage
      // untouched) rather than silently counted as imported.
      if (response.op === 'replace') {
        if (response.rejected > 0) {
          toast.warning(
            messages.models.importedPartialToast(response.saved, response.rejected),
          );
        } else {
          toast.success(messages.models.importedToast(response.saved));
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : messages.models.importFailed);
    }
  }

  async function runModelAction(
    modelId: string,
    action: () => Promise<boolean>,
    errorMessage: string,
  ) {
    setBusyModelId(modelId);

    try {
      const succeeded = await action();

      if (!succeeded) {
        throw new Error(errorMessage);
      }

      await reloadSettings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : errorMessage);
    } finally {
      setBusyModelId(null);
    }
  }

  function handleDelete(model: ModelConfigItem) {
    if (!window.confirm(messages.models.deleteConfirm(model.name))) {
      return;
    }

    runModelAction(
      model.id,
      async () => {
        const deleted = await runMutation({ op: 'delete', id: model.id });

        if (deleted) {
          toast.success(messages.models.deletedToast);
        }

        return deleted;
      },
      messages.models.deleteFailed,
    );
  }

  function handleDuplicate(model: ModelConfigItem) {
    runModelAction(
      model.id,
      async () => {
        const { id, at, ...draft } = model;
        const newDraft = { ...draft, name: `${model.name} (Copy)` };

        const created = await runMutation({ op: 'create', draft: newDraft });

        if (created) {
          toast.success(messages.models.duplicatedToast);
          setTimeout(() => {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          }, 100);
          return true;
        }

        return false;
      },
      messages.models.duplicateFailed,
    );
  }

  if (loadError) {
    return (
      <>
        <OptionsPageTitle>{messages.pageTitles.models}</OptionsPageTitle>
        <div className="max-w-2xl rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {loadError}
        </div>
      </>
    );
  }

  return (
    <div className="grid max-w-5xl gap-7 pb-16">
      <OptionsPageTitle>{messages.pageTitles.models}</OptionsPageTitle>

      <section className="flex flex-wrap items-center justify-between gap-3 border-b pb-7">
        <div className="flex items-center gap-4">
          <Button asChild>
            <Link to="/models/create">
              <Plus />
              {messages.models.createModelConfig}
            </Link>
          </Button>
          {settings?.defaultModelId ? (() => {
            const defaultModel = settings.models.find(m => m.id === settings.defaultModelId);
            return defaultModel ? (
              <div className="text-sm font-bold text-primary">
                {messages.models.defaultBadge}: {defaultModel.name}
              </div>
            ) : null;
          })() : null}
        </div>

        <div className="flex items-center gap-2">
          <Button
            disabled={!settings || settings.models.length === 0}
            onClick={handleExport}
            type="button"
            variant="outline"
          >
            <Download />
            导出
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            type="button"
            variant="outline"
          >
            <Upload />
            导入
          </Button>
          <input
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFileChange}
            ref={fileInputRef}
            type="file"
          />
        </div>
      </section>

      {!settings ? (
        <div className="text-sm text-muted-foreground">
          {messages.common.loadingSettings}
        </div>
      ) : null}

      {settings && settings.models.length === 0 ? (
        <section className="grid max-w-2xl gap-3 rounded-md border border-dashed p-6">
          <h2 className="text-base font-semibold">{messages.models.noModelConfigsYet}</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {messages.models.createOneBeforeBackgroundBridge}
          </p>
          <Button asChild className="justify-self-start">
            <Link to="/models/create">
              <Plus />
              {messages.models.createModelConfig}
            </Link>
          </Button>
        </section>
      ) : null}

      {settings && settings.models.length > 0 ? (
        <section className="grid gap-3" aria-label="Model configs">
          {settings.models.map((model, index) => {
            const provider = getModelProviderDefinition(model.providerId);
            const isDefault = settings.defaultModelId === model.id;
            const isBusy = busyModelId === model.id;

            return (
              <motion.article
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className={cn(
                  "grid gap-2 rounded-md border p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] transition-colors",
                  isDefault ? "border-primary/30 bg-primary/5" : "bg-card"
                )}
                key={model.id}
              >
                <div className="min-w-0">
                  <label className="inline-flex cursor-pointer items-center gap-3">
                    <input
                      aria-label={messages.models.useDefault(model.name)}
                      checked={isDefault}
                      className="size-4 accent-primary"
                      disabled={isBusy}
                      name="default-model"
                      onChange={() =>
                        runModelAction(
                          model.id,
                          () => runMutation({ op: 'setDefault', id: model.id }),
                          messages.models.defaultChangedFailed,
                        )
                      }
                      type="radio"
                    />
                    <img
                      alt=""
                      className="size-5 shrink-0 object-contain"
                      src={resolveModelIconUrl(model)}
                      title={provider.label}
                    />
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-base font-semibold">
                        {model.name}
                      </span>
                      <span className="truncate font-mono text-sm font-semibold text-muted-foreground">
                        {model.modelId}
                      </span>
                    </span>
                    {isDefault ? (
                      <span className="rounded-sm bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                        {messages.models.defaultBadge}
                      </span>
                    ) : null}
                  </label>

                  <details className="mt-1.5">
                    <summary className="cursor-pointer select-none text-xs text-muted-foreground transition-colors hover:text-foreground">
                      详情
                    </summary>
                    <dl className="mt-2 grid gap-2 text-xs lg:grid-cols-2">
                      <div className="min-w-0">
                        <dt className="text-[11px] font-medium uppercase text-muted-foreground">
                          {messages.models.provider}
                        </dt>
                        <dd className="mt-0.5 break-words">{provider.label}</dd>
                      </div>
                      {provider.supportsBaseURL ? (
                        <div className="min-w-0 lg:col-span-2">
                          <dt className="text-[11px] font-medium uppercase text-muted-foreground">
                            {messages.models.baseUrl}
                          </dt>
                          <dd className="mt-0.5 break-words font-mono text-[11px]">
                            {model.baseURL}
                          </dd>
                        </div>
                      ) : null}
                      {provider.supportsApiMode ? (
                        <div className="min-w-0">
                          <dt className="text-[11px] font-medium uppercase text-muted-foreground">
                            {messages.models.apiMode}
                          </dt>
                          <dd className="mt-0.5">{model.apiMode}</dd>
                        </div>
                      ) : null}
                      {model.maxInputTokens ? (
                        <div className="min-w-0">
                          <dt className="text-[11px] font-medium uppercase text-muted-foreground">
                            {messages.models.maxInputTokens}
                          </dt>
                          <dd className="mt-0.5">{model.maxInputTokens}</dd>
                        </div>
                      ) : null}
                      {model.inputTokenPrice || model.outputTokenPrice ? (
                        <div className="min-w-0">
                          <dt className="text-[11px] font-medium uppercase text-muted-foreground">
                            {messages.models.price}
                          </dt>
                          <dd className="mt-0.5">
                            {model.priceUnit} {model.inputTokenPrice || 0}/M input
                            {' / '}
                            {model.priceUnit} {model.outputTokenPrice || 0}/M output
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </details>
                </div>

                <div className="group flex items-start gap-2 sm:justify-end">
                  <Button
                    aria-label={messages.models.moveUp(model.name)}
                    disabled={isBusy || index === 0}
                    onClick={() =>
                      runModelAction(
                        model.id,
                        () => runMutation({ op: 'move', id: model.id, direction: 'up' }),
                        messages.models.moveFailed,
                      )
                    }
                    size="icon"
                    title={messages.models.moveUp(model.name)}
                    type="button"
                    variant="outline"
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    aria-label={messages.models.moveDown(model.name)}
                    disabled={isBusy || index === settings.models.length - 1}
                    onClick={() =>
                      runModelAction(
                        model.id,
                        () => runMutation({ op: 'move', id: model.id, direction: 'down' }),
                        messages.models.moveFailed,
                      )
                    }
                    size="icon"
                    title={messages.models.moveDown(model.name)}
                    type="button"
                    variant="outline"
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    aria-label={messages.models.duplicate(model.name)}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                    disabled={isBusy}
                    onClick={() => handleDuplicate(model)}
                    size="icon"
                    title={messages.models.duplicate(model.name)}
                    type="button"
                    variant="outline"
                  >
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    aria-label={messages.models.edit(model.name)}
                    asChild
                    disabled={isBusy}
                    size="icon"
                    title={messages.models.edit(model.name)}
                    variant="outline"
                  >
                    <Link to={`/models/edit?id=${model.id}`}>
                      <Edit3 className="size-4" />
                    </Link>
                  </Button>
                  <Button
                    aria-label={messages.models.delete(model.name)}
                    disabled={isBusy}
                    onClick={() => handleDelete(model)}
                    size="icon"
                    title={messages.models.delete(model.name)}
                    type="button"
                    variant="destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </motion.article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
