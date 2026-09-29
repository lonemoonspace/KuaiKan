import { browser } from 'wxt/browser';
import {
  getModelDisplayIcon,
  type ModelConfigItem,
} from '@/constants/model-settings';

type IconSource = Pick<ModelConfigItem, 'iconPath' | 'baseURL' | 'providerId'>;

/**
 * Resolve a model row's icon into an `<img src>`.
 *
 * `getModelDisplayIcon` returns either a remote/data URL or a path into the
 * extension bundle (`/llm-icons/*.svg`). A bundled path only resolves through
 * `runtime.getURL`: the resources are declared with `use_dynamic_url`, so the
 * extension id alone does not address them, and a raw root-relative path (which
 * happens to work on an extension page) would render a broken image.
 */
export function resolveModelIconUrl(model: IconSource): string {
  const icon = getModelDisplayIcon(model);

  if (!icon) return '';
  if (icon.startsWith('http') || icon.startsWith('data:')) return icon;

  // WXT types `getURL` for the entry HTML files it knows about; the bundled
  // icon paths live in `public/` and are served from the same origin.
  return browser.runtime.getURL(icon as never);
}
