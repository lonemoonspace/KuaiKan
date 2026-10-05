import { getUiMessages } from '@/lib/i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  createEmptyModelDraft,
} from '@/lib/model-settings-storage';
import { sendMessage as sendExtMessage } from '@/lib/messaging';
import { OptionsPageTitle } from '../OptionsPageTitle';
import { ModelEditor } from './ModelEditor';

export function CreateModelPage() {
  const messages = getUiMessages();
  const navigate = useNavigate();
  const [isSaving, setIsSaving] = useState(false);
  // Stable reference: creating the draft inside render produced a new object on
  // every parent re-render (e.g. when isSaving flips), which made ModelEditor's
  // reset-on-initialDraft-change effect wipe the user's input mid-edit.
  const [initialDraft] = useState(createEmptyModelDraft);

  return (
    <>
      <OptionsPageTitle>{messages.pageTitles.createModel}</OptionsPageTitle>
      <ModelEditor
        initialDraft={initialDraft}
        isSaving={isSaving}
        onSubmit={async (draft) => {
          setIsSaving(true);

          try {
            // Created by the background worker: it owns the read-modify-write
            // for this key, so a concurrent edit elsewhere cannot be lost.
            await sendExtMessage('mutateModelSettings', { op: 'create', draft });
            toast.success('模型已创建。');
            navigate('/models');
          } finally {
            setIsSaving(false);
          }
        }}
        submitLabel="Create"
      />
    </>
  );
}
