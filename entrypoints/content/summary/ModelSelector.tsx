import { browser } from 'wxt/browser';
import { ChevronDown } from 'lucide-react';
import {
  getModelProviderDefinition,
  getModelDisplayIcon,
  type ModelConfigItem,
} from '@/constants/model-settings';

interface ModelSelectorProps {
  models: ModelConfigItem[];
  /** Selected model *config* (endpoint + API key), i.e. `ModelConfigItem.id`. */
  currentModelId: string;
  onModelChange: (id: string) => void;
  /** Selected model id inside the current config's fetched pool. */
  onModelIdChange: (modelId: string) => void;
}

const SELECT_CLASS =
  'appearance-none pr-5 py-1 outline-none font-medium truncate cursor-pointer transition-colors border border-border rounded-lg text-xs bg-background shadow-sm text-foreground';

/**
 * Two native selects: the model config, and the model inside that config's
 * fetched pool. The prompt is deliberately not selectable here — it is changed
 * on the options page, where the panel has no room for a third control.
 */
export function ModelSelector({
  models,
  currentModelId,
  onModelChange,
  onModelIdChange,
}: ModelSelectorProps) {
  const currentModel = models.find((m) => m.id === currentModelId);

  // Empty pool (never fetched, or a hand-typed id) degrades to the single id in
  // use, so the row always has something selected.
  const modelIdOptions = currentModel
    ? (currentModel.modelIds.includes(currentModel.modelId)
        ? currentModel.modelIds
        : [currentModel.modelId, ...currentModel.modelIds]
      ).filter((id) => id)
    : [];

  return (
    <div className="flex items-center shrink-0 justify-center gap-1">
      <div className="relative flex items-center">
        {currentModel && (() => {
          const providerDef = getModelProviderDefinition(currentModel.providerId);
          const iconUrl = getModelDisplayIcon(currentModel);
          const src =
            iconUrl.startsWith('http') || iconUrl.startsWith('data:')
              ? iconUrl
              : browser.runtime.getURL(iconUrl as any);

          return (
            <img
              src={src}
              alt={providerDef.label}
              className="absolute left-1.5 w-3.5 h-3.5 pointer-events-none object-contain z-10"
            />
          );
        })()}
        <select
          className={`${SELECT_CLASS} pl-6 max-w-[112px]`}
          value={currentModelId}
          onChange={(e) => {
            onModelChange(e.target.value);
          }}
          title={currentModel?.name}
        >
          {models.length === 0 && <option value="">-</option>}
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
      </div>
      <div className="relative flex items-center">
        <select
          className={`${SELECT_CLASS} pl-2 max-w-[132px]`}
          value={currentModel?.modelId ?? ''}
          onChange={(e) => {
            onModelIdChange(e.target.value);
          }}
          title={currentModel?.modelId}
        >
          {modelIdOptions.length === 0 && <option value="">-</option>}
          {modelIdOptions.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
      </div>
    </div>
  );
}
