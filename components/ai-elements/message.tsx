"use client";

import { Button } from "@/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupText,
} from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { scrollToPhrase } from "@/lib/scroll-to-text";
import { markTiming } from "@/lib/summary-timing";
import type { UIMessage } from "ai";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type {
  ComponentProps,
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
} from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      (({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      } as Record<string, string>)[char]),
  );

const isSafeUrl = (href: string) => {
  try {
    const normalized = href.trim().replace(/[\u0000-\u001f\u007f]/g, '');
    // Relative URLs resolve against the summarized page in the browser. The
    // fallback base only exists so the protocol check still means something
    // when this module is loaded outside a page (vitest runs in node).
    const base =
      typeof window === 'undefined' ? 'https://localhost/' : window.location.href;
    const url = new URL(normalized, base);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol);
  } catch {
    return false;
  }
};

export type HeadingTone = 'key' | 'caution';

/**
 * Section tone of a summary heading, used to style the built-in presets'
 * "核心结论" and "注意事项" sections (see `.kuai-markdown h2[data-tone]` in
 * entrypoints/content/style.css). Matched on the heading text so custom
 * prompts with similar headings get the same treatment.
 */
export function getHeadingTone(text: string): HeadingTone | null {
  if (/结论|要点总结|tl;?dr|takeaway|conclusion/i.test(text)) return 'key';
  if (/注意|风险|限制|局限|警告|caveat|caution|warning|limitation/i.test(text)) return 'caution';
  return null;
}

// `marked` itself caches its dynamic import, but re-`new Renderer()`-ing and
// re-wiring the three overridden methods on every streamed chunk was pure
// waste. Build the renderer once, lazily, and reuse the same synchronous
// render function for the lifetime of the extension context.
let markdownRendererPromise: Promise<(text: string) => string> | null = null;

function loadMarkdownRenderer(): Promise<(text: string) => string> {
  if (!markdownRendererPromise) {
    markdownRendererPromise = import('marked').then(({ marked, Renderer }) => {
      const renderer = new Renderer();
      renderer.html = (token) => escapeHtml(token.text);
      renderer.link = ({ href, title, tokens }) => {
        const safeHref = isSafeUrl(href) ? href : '#';
        const text = renderer.parser.parseInline(tokens);
        // `rel` plus `target=_blank` keep a model-supplied link from navigating
        // the summarized page away and from reaching back through window.opener.
        return `<a href="${escapeHtml(safeHref)}"${title ? ` title="${escapeHtml(title)}"` : ''} target="_blank" rel="noopener noreferrer">${text}</a>`;
      };
      renderer.heading = ({ tokens, depth, text }) => {
        const tone = getHeadingTone(text);
        const inner = renderer.parser.parseInline(tokens);
        return `<h${depth}${tone ? ` data-tone="${tone}"` : ''}>${inner}</h${depth}>\n`;
      };
      // Images are never emitted. Model output is page-influenced, so an
      // `<img src>` here would let the summarized page turn the panel into an
      // outbound request: a tracking pixel for an absolute URL, or a
      // credentialed same-origin GET when `isSafeUrl` resolves a relative URL
      // against the page being summarized. The alt text carries the same
      // information as plain text with no network side effect.
      //
      // The alt text is escaped, not returned raw: marked treats renderer
      // output as trusted HTML, so `![<img src=x onerror=…>](…)` would
      // otherwise inject markup straight into `dangerouslySetInnerHTML`.
      renderer.image = ({ text }) => escapeHtml(text);
      return (text: string) =>
        marked.parse(text, {
          async: false,
          gfm: true,
          breaks: false,
          renderer,
        }) as string;
    });
  }
  return markdownRendererPromise;
}

/**
 * The panel's whole markdown pipeline: pull citation markers out of the raw
 * text, render, then restore the chips. Exported so tests can drive the real
 * renderer (escaping, link/image policy) rather than a copy of it.
 */
export async function renderMarkdownToHtml(text: string): Promise<string> {
  const render = await loadMarkdownRenderer();
  const extracted = extractCitationPhrases(text);
  return buildCitationChips(render(extracted.text), extracted.phrases);
}

// Phase-1 citation convention agreed with the prompts: a key point may end
// with `⟦cite:原文短句⟧` (legacy prompts saved before this change may still
// emit `⟦引用:原文短句⟧`, so both prefixes are accepted). Markers are
// extracted from the RAW source text before Markdown rendering (phrases are
// then never entity-escaped or mangled by markup), swapped for placeholders,
// and re-inserted as clickable chips after parsing. Clicking a chip scrolls
// back to the phrase in the page.
const CITATION_PATTERN = /⟦(?:引用|cite):([^⟧]+)⟧/g;

export function extractCitationPhrases(source: string): { text: string; phrases: string[] } {
  const phrases: string[] = [];
  const text = source.replace(CITATION_PATTERN, (_match, raw: string) => {
    const index = phrases.length;
    phrases.push(String(raw).replace(/\s+/g, ' ').trim());
    return `⟦kuai-cite:${index}⟧`;
  });
  return { phrases, text };
}

/**
 * Plain-text form of a summary for copying: citation markers become the
 * quoted phrase they point at, the same way the chip reads in the panel.
 */
export function citationMarkersToQuotes(source: string): string {
  return source.replace(CITATION_PATTERN, (_match, raw: string) => {
    const phrase = String(raw).replace(/\s+/g, ' ').trim();
    return phrase ? `“${phrase}”` : '';
  });
}

export function buildCitationChips(html: string, phrases: string[]): string {
  // Single pass over tags OR placeholders. A placeholder that survived inside
  // an attribute (a model that wrote `[x](⟦cite:…⟧)` puts one in the href)
  // must not have the chip markup spliced into the attribute value, or the tag
  // is torn apart. Matching whole tags first and leaving them untouched, and
  // never rescanning a replacement, keeps substitution in text context only.
  return html.replace(/<[^>]*>|⟦kuai-cite:(\d+)⟧/g, (match, rawIndex: string | undefined) => {
    if (rawIndex === undefined) return match;

    const phrase = phrases[Number(rawIndex)];
    if (!phrase) return '';
    const display = phrase.length > 60 ? `${phrase.slice(0, 60)}…` : phrase;
    return `<span class="kuai-cite" data-cite-phrase="${escapeHtml(phrase)}" role="button" tabindex="0" title="${escapeHtml(phrase)}">“${escapeHtml(display)}”</span>`;
  });
}

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full  flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "sm",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};

interface MessageBranchContextType {
  currentBranch: number;
  totalBranches: number;
  goToPrevious: () => void;
  goToNext: () => void;
  branches: ReactElement[];
  setBranches: (branches: ReactElement[]) => void;
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(
  null
);

const useMessageBranch = () => {
  const context = useContext(MessageBranchContext);

  if (!context) {
    throw new Error(
      "MessageBranch components must be used within MessageBranch"
    );
  }

  return context;
};

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

export const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);

  const handleBranchChange = useCallback(
    (newBranch: number) => {
      setCurrentBranch(newBranch);
      onBranchChange?.(newBranch);
    },
    [onBranchChange]
  );

  const goToPrevious = useCallback(() => {
    const newBranch =
      currentBranch > 0 ? currentBranch - 1 : branches.length - 1;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const goToNext = useCallback(() => {
    const newBranch =
      currentBranch < branches.length - 1 ? currentBranch + 1 : 0;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const contextValue = useMemo<MessageBranchContextType>(
    () => ({
      branches,
      currentBranch,
      goToNext,
      goToPrevious,
      setBranches,
      totalBranches: branches.length,
    }),
    [branches, currentBranch, goToNext, goToPrevious]
  );

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        className={cn("grid w-full gap-2 [&>div]:pb-0", className)}
        {...props}
      />
    </MessageBranchContext.Provider>
  );
};

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageBranchContent = ({
  children,
  ...props
}: MessageBranchContentProps) => {
  const { currentBranch, setBranches, branches } = useMessageBranch();
  const childrenArray = useMemo(
    () => (Array.isArray(children) ? children : [children]),
    [children]
  );

  // Use useEffect to update branches when they change
  useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray);
    }
  }, [childrenArray, branches, setBranches]);

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        "grid gap-2 overflow-hidden [&>div]:pb-0",
        index === currentBranch ? "block" : "hidden"
      )}
      key={branch.key}
      {...props}
    >
      {branch}
    </div>
  ));
};

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>;

export const MessageBranchSelector = ({
  className,
  ...props
}: MessageBranchSelectorProps) => {
  const { totalBranches } = useMessageBranch();

  // Don't render if there's only one branch
  if (totalBranches <= 1) {
    return null;
  }

  return (
    <ButtonGroup
      className={cn(
        "[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md",
        className
      )}
      orientation="horizontal"
      {...props}
    />
  );
};

export type MessageBranchPreviousProps = ComponentProps<typeof Button>;

export const MessageBranchPrevious = ({
  children,
  ...props
}: MessageBranchPreviousProps) => {
  const { goToPrevious, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  );
};

export type MessageBranchNextProps = ComponentProps<typeof Button>;

export const MessageBranchNext = ({
  children,
  ...props
}: MessageBranchNextProps) => {
  const { goToNext, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  );
};

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>;

export const MessageBranchPage = ({
  className,
  ...props
}: MessageBranchPageProps) => {
  const { currentBranch, totalBranches } = useMessageBranch();

  return (
    <ButtonGroupText
      className={cn(
        "border-none bg-transparent text-muted-foreground shadow-none",
        className
      )}
      {...props}
    >
      {currentBranch + 1} of {totalBranches}
    </ButtonGroupText>
  );
};

// `dangerouslySetInnerHTML` is owned by the component's escaping pipeline;
// callers must not be able to override it through the spread props.
export type MessageResponseProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "dangerouslySetInnerHTML"
> & {
  children: string;
  /** Called when a clicked citation chip's phrase cannot be located in the page. */
  onCitationNotFound?: (phrase: string) => void;
};

export const MessageResponse = memo(
  ({ className, children, onCitationNotFound, ...props }: MessageResponseProps) => {
    const [html, setHtml] = useState<string>('');

    // `children` grows on every streamed chunk. Re-`marked.parse`-ing the
    // whole string on every single chunk is O(n^2) over the stream and
    // destroys/rebuilds the DOM every frame. Throttle to a leading render
    // (so the first chunk shows up immediately) plus at most one trailing
    // render per 100ms window, always reading the latest text via a ref so
    // a slow-resolving parse can never clobber newer text with stale HTML.
    const childrenRef = useRef(children);
    childrenRef.current = children;
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastRenderAtRef = useRef(0);
    const hasRenderedRef = useRef(false);
    // useRef's returned object has stable identity for the component's
    // lifetime, so closures below can read `isMountedRef.current` without
    // needing it passed in or listed as a dependency.
    const isMountedRef = useRef(true);

    const renderMarkdown = useCallback(() => {
      const text = childrenRef.current;
      // Citation markers are swapped out before parsing so phrases containing
      // markdown characters (& < > " *) survive untouched, then swapped back
      // in on the rendered HTML -- see renderMarkdownToHtml.
      void renderMarkdownToHtml(text).then((html) => {
        if (!isMountedRef.current) return;
        setHtml(html);
        // TEMPORARY timing instrumentation (first markdown paint handed to React).
        if (text) markTiming('首次渲染到面板');
      });
      lastRenderAtRef.current = Date.now();
    }, []);

    // Mount-scoped: guarantees the pending trailing timer (if any) is
    // cleared on unmount. Deliberately separate from the effect below so
    // that a `children` update never resets/cancels an already-scheduled
    // trailing call -- throttling means the delay is anchored to the last
    // render, not to the last change.
    useEffect(() => {
      isMountedRef.current = true;
      return () => {
        isMountedRef.current = false;
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    }, []);

    useEffect(() => {
      if (!hasRenderedRef.current) {
        // Leading edge: parse the first chunk immediately, otherwise the
        // first frame would sit blank for 100ms.
        hasRenderedRef.current = true;
        renderMarkdown();
        return;
      }

      if (timerRef.current !== null) {
        // A trailing render is already scheduled. It reads `childrenRef`
        // when it fires, so it will pick up this update too -- no need to
        // (and, for a throttle, no reason to) reschedule it.
        return;
      }

      const wait = Math.max(0, 100 - (Date.now() - lastRenderAtRef.current));
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // Guaranteed trailing call: streaming eventually stops changing
        // `children`, so this effect stops re-running -- but this timer was
        // already scheduled by the last change that *did* run it, and it
        // always reads the latest text via `childrenRef` at fire time, so
        // the final chunk is never dropped even though nothing triggers a
        // further effect run after it.
        renderMarkdown();
      }, wait);
    }, [children, renderMarkdown]);

    // Single delegated handler for citation chips rendered via
    // dangerouslySetInnerHTML: click (or Enter/Space on the focused chip)
    // scrolls the underlying page to the quoted phrase. Read the callback via
    // a ref so the handler (and the memo comparator) stay prop-agnostic.
    const onCitationNotFoundRef = useRef(onCitationNotFound);
    onCitationNotFoundRef.current = onCitationNotFound;
    const handleCitationInteraction = useCallback(
      (event: ReactMouseEvent<HTMLDivElement> | ReactKeyboardEvent<HTMLDivElement>) => {
        const chip = (event.target as HTMLElement | null)?.closest?.(
          '[data-cite-phrase]',
        ) as HTMLElement | null;
        if (!chip) return;

        if (event.type === 'keydown') {
          const key = (event as ReactKeyboardEvent<HTMLDivElement>).key;
          if (key !== 'Enter' && key !== ' ') return;
        }

        event.preventDefault();
        const phrase = chip.getAttribute('data-cite-phrase');
        if (!phrase) return;
        const found = scrollToPhrase(phrase);
        chip.classList.toggle('is-missing', !found);
        if (!found) onCitationNotFoundRef.current?.(phrase);
      },
      [],
    );

    // Nothing parsed yet and nothing to parse: falling through would emit a
    // bare `<p></p>` from the fallback branch below.
    if (!html && !children) return null;

    return (
      <div
        // Spread FIRST: the escaping pipeline and the delegated citation
        // handler are owned by this component, so a caller-supplied prop must
        // never be able to override them at runtime.
        {...props}
        className={cn(
          'kuai-markdown size-full selection:bg-primary/15',
          className
        )}
        dangerouslySetInnerHTML={{ __html: html || `<p>${escapeHtml(children)}</p>` }}
        onClick={handleCitationInteraction}
        onKeyDown={handleCitationInteraction}
      />
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    // `className` is a stable template literal at the call sites, so comparing
    // it costs nothing and stops a class-only change from being swallowed.
    prevProps.className === nextProps.className
);

MessageResponse.displayName = "MessageResponse";

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps) => (
  <div
    className={cn(
      "mt-4 flex w-full items-center justify-between gap-4",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
