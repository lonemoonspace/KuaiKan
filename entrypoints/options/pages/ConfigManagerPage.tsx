import { useRef, useState, type ChangeEvent } from 'react';
import { browser } from 'wxt/browser';
import { z } from 'zod';
import { getUiMessages } from '@/lib/i18n';
import { OptionsPageTitle } from './OptionsPageTitle';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { MODEL_CONFIGS_V2_STORAGE_KEY } from '@/constants/model-settings';

import { createLogger } from '@/lib/logger';

const logger = createLogger('options:ConfigManagerPage');

const compatibilityVersion = 20250224;

const DEFAULT_FILENAME = 'kuai-kan-config';

function downloadJsonFile(contents: string, filename: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The download starts asynchronously; revoking the object URL immediately
  // can abort the transfer before the browser reads it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function decodeImportText(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(decodeURIComponent(atob(raw.trim())));
    } catch {
      return null;
    }
  }
}

/** Trim + strip trailing slashes; missing/empty baseURL normalizes to ''. */
function normalizeBaseURLForSecretMerge(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

/**
 * Merge an incoming model list with the one already in storage, preserving
 * `apiKey` / `headers` for models the import does not carry them for.
 *
 * The default export strips both fields, so importing such a file would
 * otherwise erase every credential the user has. Values present in the import
 * always win; only genuinely absent/empty ones fall back to local.
 *
 * A same-id entry only inherits the local secret when the endpoint it talks
 * to is unchanged (same `providerId` and, once normalized, the same
 * `baseURL`): otherwise the local key/headers were issued for a different
 * endpoint and must not be silently carried over to the imported one.
 */
export function mergeModelSecrets(currentValue: unknown, incomingValue: unknown): unknown {
  if (!Array.isArray(incomingValue) || !Array.isArray(currentValue)) {
    return incomingValue;
  }

  const localById = new Map<string, any>();
  for (const item of currentValue) {
    if (item && typeof item === 'object' && typeof (item as any).id === 'string') {
      localById.set((item as any).id, item);
    }
  }

  return incomingValue.map((item) => {
    if (!item || typeof item !== 'object') return item;

    const incoming = item as Record<string, unknown>;
    const local = typeof incoming.id === 'string' ? localById.get(incoming.id) : undefined;
    if (!local) return item;

    const sameProvider = incoming.providerId === local.providerId;
    const sameBaseURL =
      normalizeBaseURLForSecretMerge(incoming.baseURL) === normalizeBaseURLForSecretMerge(local.baseURL);
    if (!sameProvider || !sameBaseURL) return item;

    const merged: Record<string, unknown> = { ...incoming };

    if (!merged.apiKey && local.apiKey) {
      merged.apiKey = local.apiKey;
    }
    if (
      (!merged.headers || Object.keys(merged.headers as object).length === 0) &&
      local.headers &&
      Object.keys(local.headers).length > 0
    ) {
      merged.headers = local.headers;
    }

    // Same reasoning as apiKey/headers, for the fetched model pool: it is
    // per-endpoint local knowledge produced by a `/models` fetch, so an export
    // from a build that predates the field carries nothing and overwriting the
    // local pool with that emptiness would silently lose it.
    if (
      (!Array.isArray(merged.modelIds) || merged.modelIds.length === 0) &&
      Array.isArray(local.modelIds) &&
      local.modelIds.length > 0
    ) {
      merged.modelIds = local.modelIds;
    }

    return merged;
  });
}

const importSchema = z.object({
  name: z.literal('kuai-kan'),
  version: z.string(),
  compatibilityVersion: z.literal(compatibilityVersion),
  exportDate: z.string(),
  data: z.record(z.string(), z.any()),
});

type ExportDataStructure = z.infer<typeof importSchema>;

type DiffItem = {
  key: string;
  action: 'add' | 'update';
  oldValue: any;
  newValue: any;
  selected: boolean;
};

export function ConfigManagerPage() {
  const messages = getUiMessages();
  const [isExportWithApiKeys, setIsExportWithApiKeys] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [diffItems, setDiffItems] = useState<DiffItem[] | null>(null);
  const [format, setFormat] = useState<'json' | 'txt'>('json');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleExport = async () => {
    setIsLoading(true);
    try {
      const items = await browser.storage.local.get(null);

      if (items && !isExportWithApiKeys) {
        const key = MODEL_CONFIGS_V2_STORAGE_KEY.replace('local:', '');
        if (items[key] && Array.isArray(items[key])) {
          items[key] = items[key].map((item: any) => {
            // Strip both the apiKey field and custom headers: users often put
            // Authorization / API tokens in headers, which would otherwise
            // leak credentials into the exported file.
            const { apiKey, headers, ...other } = item;
            return { ...other };
          });
        }
      }

      if (items) {
        delete items['local:content-samples-position'];
        delete items['content-samples-position'];
      }

      const manifest = browser.runtime.getManifest();
      const version = manifest.version;

      const data: ExportDataStructure = {
        name: 'kuai-kan',
        version: version,
        compatibilityVersion: compatibilityVersion,
        exportDate: new Date().toISOString(),
        data: items,
      };

      const contents = JSON.stringify(data, null, 2);
      const filename = DEFAULT_FILENAME + '.' + format;
      downloadJsonFile(contents, filename, format === 'txt' ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8');
      toast.success(messages.common?.success || 'Success', {
        description: 'Configuration exported to ' + filename,
      });
    } catch (e) {
      logger.error('Export failed:', e);
      toast.error('Export Error', { description: String(e) });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    fileInputRef.current?.click();
  };

  const handleImportFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    setIsLoading(true);
    try {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const raw = await file.text();
      const parsedJson = decodeImportText(raw);
      if (!parsedJson) {
        toast.error('Invalid or unsupported file.');
        return;
      }

      const parsedData = importSchema.safeParse(parsedJson);
      if (!parsedData.success) {
        toast.error('Import Parse Failed', { description: 'Invalid configuration structure.' });
        return;
      }

      const { data } = parsedData.data;

      if (data) {
        delete data['local:content-samples-position'];
        delete data['content-samples-position'];
      }

      const currentItems = await browser.storage.local.get(null);
      const newDiffs: DiffItem[] = [];
      const modelsKey = MODEL_CONFIGS_V2_STORAGE_KEY.replace('local:', '');

      for (const [key, value] of Object.entries(data)) {
        // Exports omit apiKey/headers unless the user explicitly opted in, so a
        // plain overwrite of the model list would silently wipe every stored
        // credential. Carry the local secrets over per model id instead.
        const merged =
          key === modelsKey
            ? mergeModelSecrets(currentItems[key], value)
            : value;

        const isUpdate = currentItems.hasOwnProperty(key);
        if (isUpdate && JSON.stringify(currentItems[key]) === JSON.stringify(merged)) {
          continue;
        }
        newDiffs.push({
          key,
          action: isUpdate ? 'update' : 'add',
          oldValue: isUpdate ? currentItems[key] : undefined,
          newValue: merged,
          selected: true,
        });
      }

      if (newDiffs.length === 0) {
        toast.info(messages.exportImport.noChanges, { description: messages.exportImport.noChangesDesc });
        return;
      }

      setDiffItems(newDiffs);
      toast.info(messages.exportImport.reviewImport);
    } catch (e) {
      logger.error('Import failed:', e);
      toast.error('Import Error', { description: String(e) });
    } finally {
      setIsLoading(false);
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleConfirmImport = async () => {
    if (!diffItems) return;
    
    setIsLoading(true);
    try {
      const dataToSave: Record<string, any> = {};
      for (const item of diffItems) {
        if (item.selected) {
          dataToSave[item.key] = item.newValue;
        }
      }
      
      if (Object.keys(dataToSave).length > 0) {
        await browser.storage.local.set(dataToSave);
        toast.success(messages.common?.success || 'Success', {
          description: messages.exportImport.importedSuccess(Object.keys(dataToSave).length),
        });
      } else {
        toast.info(messages.exportImport.noImportSelected);
      }
      
      setDiffItems(null);
    } catch (e) {
      logger.error('Import confirmation failed:', e);
      toast.error('Import Error', { description: String(e) });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetAll = async () => {
    if (window.confirm(messages.exportImport.resetConfirm)) {
      setIsLoading(true);
      try {
        await browser.storage.local.clear();
        toast.success(messages.common?.success || 'Success', {
          description: messages.exportImport.resetSuccess,
        });
      } catch (e) {
        logger.error('Reset failed:', e);
        toast.error('Reset Error', { description: String(e) });
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <>
      <OptionsPageTitle>{messages.options.navigation.exportImport}</OptionsPageTitle>
      <div className="text-sm text-muted-foreground mb-6">
        {messages.exportImport.exportImportDescription}
      </div>

      <div className="flex flex-col gap-8">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{messages.exportImport.exportConfiguration}</h2>
          <div className="flex items-center gap-2">
            <Switch 
              id="export-apikeys" 
              checked={isExportWithApiKeys} 
              onCheckedChange={(checked) => setIsExportWithApiKeys(checked === true)}
            />
            <label htmlFor="export-apikeys" className="text-sm font-medium leading-none cursor-pointer">
              {messages.exportImport.exportWithApiKeys}
            </label>
          </div>
          {isExportWithApiKeys && (
            <p className="text-sm text-destructive">
              Warning: Exporting with API Keys includes sensitive information. Keep the exported string safe.
            </p>
          )}
          <div className="flex items-center gap-2">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'json' | 'txt')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="json">JSON (.json)</option>
              <option value="txt">TXT (.txt)</option>
            </select>
          </div>
          <Button onClick={handleExport} disabled={isLoading}>
            {isLoading ? 'Exporting...' : 'Export file'}
          </Button>
        </section>

        <section className="space-y-4 border-t pt-6">
          <h2 className="text-lg font-semibold">{messages.exportImport.importConfiguration}</h2>
          <p className="text-sm text-muted-foreground">
            {messages.exportImport.importConfigurationDescription}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.txt,application/json,text/plain"
            className="hidden"
            onChange={handleImportFileChange}
          />
          <Button onClick={handleImport} disabled={isLoading || diffItems !== null} variant="secondary">
            {isLoading ? 'Reading...' : 'Import file'}
          </Button>

          {diffItems && (
            <div className="mt-6 space-y-4 bg-muted p-4 rounded-md">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold">{messages.exportImport.importReviewTitle}</h3>
                <div className="space-x-2 flex items-center">
                  <Button size="sm" onClick={handleConfirmImport} disabled={isLoading}>
                    {messages.exportImport.confirmImport}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDiffItems(null)}>
                    {messages.exportImport.cancel}
                  </Button>
                </div>
              </div>
              <div className="border rounded-md bg-background">
                <table className="w-full text-sm text-left table-fixed">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium w-[200px]">{messages.exportImport.configItem}</th>
                      <th className="px-4 py-2 font-medium w-1/3">{messages.exportImport.oldValue}</th>
                      <th className="px-4 py-2 font-medium w-1/3">{messages.exportImport.newValue}</th>
                      <th className="px-4 py-2 font-medium w-[220px]">
                        <div className="flex items-center justify-end gap-1.5">
                          <span>{messages.exportImport.action}</span>
                          <Button 
                            size="sm"
                            variant="outline"
                            className="h-6 px-1.5 text-[10px] bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100 hover:text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/50" 
                            onClick={() => setDiffItems(diffItems.map(i => ({ ...i, selected: true })))}
                          >
                            {messages.exportImport.acceptAll}
                          </Button>
                          <Button 
                            size="sm"
                            variant="outline"
                            className="h-6 px-1.5 text-[10px] bg-red-50 text-red-600 border-red-200 hover:bg-red-100 hover:text-red-700 dark:bg-red-900/30 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/50"
                            onClick={() => setDiffItems(diffItems.map(i => ({ ...i, selected: false })))}
                          >
                            {messages.exportImport.rejectAll}
                          </Button>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {diffItems.map((item, idx) => (
                      <tr key={item.key} className="hover:bg-muted/50">
                        <td className="px-4 py-2 font-mono text-xs break-all align-top">
                          <div className="flex items-center gap-2">
                            <span className={`shrink-0 text-[10px] whitespace-nowrap px-1.5 py-0.5 rounded-sm ${item.action === 'update' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                              {item.action === 'update' ? messages.exportImport.conflict : messages.exportImport.addNew}
                            </span>
                            <span>{item.key}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-xs font-mono break-all whitespace-pre-wrap align-top">
                          {item.action === 'update' ? (
                            <div className="text-red-700 max-h-[300px] overflow-y-auto">
                              {JSON.stringify(item.oldValue, null, 2)}
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs font-mono break-all whitespace-pre-wrap align-top">
                          <div className="text-green-700 max-h-[300px] overflow-y-auto">
                            {JSON.stringify(item.newValue, null, 2)}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <Button 
                              size="sm" 
                              variant={item.selected ? 'default' : 'outline'}
                              className={`h-7 px-2.5 text-xs ${item.selected ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                              onClick={() => {
                                const newItems = [...diffItems];
                                newItems[idx].selected = true;
                                setDiffItems(newItems);
                              }}
                            >
                              ✅ {item.action === 'update' ? messages.exportImport.overwrite : messages.exportImport.accept}
                            </Button>
                            <Button 
                              size="sm" 
                              variant={!item.selected ? 'destructive' : 'outline'}
                              className="h-7 px-2.5 text-xs"
                              onClick={() => {
                                const newItems = [...diffItems];
                                newItems[idx].selected = false;
                                setDiffItems(newItems);
                              }}
                            >
                              ❌ {item.action === 'update' ? messages.exportImport.skip : messages.exportImport.discard}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-4 border-t pt-6">
          <h2 className="text-lg font-semibold text-destructive">{messages.exportImport.dangerZone}</h2>
          <p className="text-sm text-muted-foreground">
            {messages.exportImport.resetConfigurationDescription}
          </p>
          <Button variant="destructive" onClick={handleResetAll} disabled={isLoading}>
            {messages.exportImport.resetAllConfigurations}
          </Button>
        </section>
      </div>
    </>
  );
}
