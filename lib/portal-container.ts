// Radix portals (tooltip, select, dialog, …) append their content to
// `document.body` by default. The content script mounts the panel inside a
// shadow root with `cssInjectionMode: 'ui'`, so anything portaled to the light
// DOM sits outside the shadow root, where none of the injected stylesheet
// applies — the tooltip rendered as unstyled text. Register the shadow root
// here at mount time and every portal resolves its container through this.

let portalContainer: Element | DocumentFragment | null = null;

export function setPortalContainer(
  container: Element | DocumentFragment | null,
): void {
  portalContainer = container;
}

/**
 * `undefined` lets Radix fall back to its own default (`document.body`), which
 * is what the options/popup pages (plain documents) want.
 */
export function getPortalContainer(): Element | DocumentFragment | undefined {
  return portalContainer ?? undefined;
}
