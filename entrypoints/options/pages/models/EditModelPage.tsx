import { getUiMessages } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  loadModelSettings,
} from '@/lib/model-settings-storage';
import { sendMessage as sendExtMessage } from '@/lib/messaging';
import type { ModelConfigItem } from '@/constants/model-settings';
import { OptionsPageTitle } from '../OptionsPageTitle';
import { ModelEditor } from './ModelEditor';

export function EditModelPage() {
  const messages = getUiMessages();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const modelId = searchParams.get('id');
  const [model, setModel] = useState<ModelConfigItem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!modelId) {
        setLoadError('缺少模型 ID。');
        return;
      }

      try {
        const settings = await loadModelSettings();
        const nextModel =
          settings.models.find((item) => item.id === modelId) ?? null;

        if (!active) return;

        if (!nextModel) {
          setLoadError('未找到该模型。');
          return;
        }

        setModel(nextModel);
      } catch (error) {
        if (!active) return;

        setLoadError(
          error instanceof Error ? error.message : '模型设置加载失败。',
        );
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [modelId]);

  return (
    <>
      <OptionsPageTitle>{messages.pageTitles.editModel}</OptionsPageTitle>
      {loadError ? (
        <div className="max-w-2xl rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {loadError}
        </div>
      ) : null}
      {!loadError && !model ? (
        <div className="text-sm text-muted-foreground">
          {messages.common.loadingSettings}
        </div>
      ) : null}
      {model ? (
        <ModelEditor
          initialDraft={model}
          isSaving={isSaving}
          onSubmit={async (draft) => {
            setIsSaving(true);

            try {
              await sendExtMessage('mutateModelSettings', {
                op: 'update',
                id: model.id,
                draft,
              });
              toast.success('模型已保存。');
              navigate('/models');
            } finally {
              setIsSaving(false);
            }
          }}
          submitLabel="Save"
        />
      ) : null}
    </>
  );
}
