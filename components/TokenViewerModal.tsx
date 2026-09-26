import React, { useEffect, useState } from 'react';
import { X, Info } from 'lucide-react';
import { sendMessage } from '@/lib/messaging';
import { getUiMessages } from '@/lib/i18n';
import type { TokenPiece } from '@/lib/token-count';
import type { SummaryInputExceedBehaviour } from '@/constants/general-settings';

import { createLogger } from '@/lib/logger';

const logger = createLogger('content:TokenViewerModal');

// Literal class names so Tailwind picks up both the light and dark variant.
const TOKEN_COLORS = [
  'bg-red-200 dark:bg-red-500/30',
  'bg-orange-200 dark:bg-orange-500/30',
  'bg-amber-200 dark:bg-amber-500/30',
  'bg-yellow-200 dark:bg-yellow-500/30',
  'bg-lime-200 dark:bg-lime-500/30',
  'bg-green-200 dark:bg-green-500/30',
  'bg-emerald-200 dark:bg-emerald-500/30',
  'bg-teal-200 dark:bg-teal-500/30',
  'bg-cyan-200 dark:bg-cyan-500/30',
  'bg-sky-200 dark:bg-sky-500/30',
  'bg-blue-200 dark:bg-blue-500/30',
  'bg-indigo-200 dark:bg-indigo-500/30',
  'bg-violet-200 dark:bg-violet-500/30',
  'bg-purple-200 dark:bg-purple-500/30',
  'bg-fuchsia-200 dark:bg-fuchsia-500/30',
  'bg-pink-200 dark:bg-pink-500/30',
  'bg-rose-200 dark:bg-rose-500/30',
];

interface TokenViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  textContent: string;
  maxInputTokens: number;
  behaviour?: SummaryInputExceedBehaviour;
}

/**
 * Which token indices survive truncation, mirroring applyTruncationStrategy in
 * the background worker. The preview used to always dim the tail, i.e. it only
 * ever showed `front` behaviour — for `back`/`middle` it highlighted exactly
 * the region that gets discarded.
 */
export function isTokenKept(
  index: number,
  total: number,
  keep: number,
  behaviour: SummaryInputExceedBehaviour,
): boolean {
  if (behaviour === 'nothing' || total <= keep) return true;

  if (behaviour === 'back') {
    return index >= total - keep;
  }

  if (behaviour === 'middle') {
    const headTokens = Math.floor(keep / 2);
    const tailTokens = keep - headTokens;
    return index < headTokens || index >= total - tailTokens;
  }

  return index < keep;
}

export function TokenViewerModal({ isOpen, onClose, textContent, maxInputTokens, behaviour = 'front' }: TokenViewerModalProps) {
  const uiMessages = getUiMessages();
  const [pieces, setPieces] = useState<TokenPiece[]>([]);
  const [loading, setLoading] = useState(false);
  const [sliderValue, setSliderValue] = useState(maxInputTokens);

  useEffect(() => {
    if (!isOpen) return;
    
    let active = true;
    setLoading(true);
    sendMessage('splitTokensWithTiming', { text: textContent })
      .then((res) => {
        if (!active) return;
        setPieces(res.pieces);
        const realTokens = res.pieces.length;
        setSliderValue(maxInputTokens === 0 ? realTokens : Math.min(realTokens, maxInputTokens));
        setLoading(false);
      })
      .catch(e => {
        logger.error('Failed to split tokens:', e);
        if (active) setLoading(false);
      });
      
    return () => { active = false; };
  }, [isOpen, textContent, maxInputTokens]);

  if (!isOpen) return null;

  const realTokens = pieces.length;
  const maxSlider = Math.max(realTokens, maxInputTokens);

  return (
    <div className="absolute inset-0 z-50 bg-card text-card-foreground flex flex-col pointer-events-auto rounded-[inherit] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card shrink-0 z-10">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span>{uiMessages.content.tokenPreview}</span>
          <div className="group relative flex items-center justify-center">
            <Info size={14} className="text-muted-foreground cursor-help" />
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 w-60 p-2 bg-zinc-800 text-zinc-100 text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 text-center font-normal leading-relaxed before:content-[''] before:absolute before:bottom-full before:left-1/2 before:-translate-x-1/2 before:border-4 before:border-transparent before:border-b-zinc-800">
              {uiMessages.content.tokenViewerInfoTip}
            </div>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title={uiMessages.content.close}
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 leading-[1.6] whitespace-pre-wrap font-mono text-sm text-foreground break-words bg-card">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="animate-pulse">Loading tokens...</div>
          </div>
        ) : (
          pieces.map((p, i) => {
            const isExcluded = !isTokenKept(i, pieces.length, sliderValue, behaviour);
            const colorClass = TOKEN_COLORS[(i * 7) % TOKEN_COLORS.length];
            return (
              <span 
                key={i} 
                className={`relative px-[0.5px] rounded-[1px] transition-colors duration-150 ${isExcluded ? 'bg-muted text-muted-foreground/50' : colorClass}`}
                title={`Token ID: ${p.id}`}
              >
                {p.text}
              </span>
            );
          })
        )}
      </div>

      {/* Footer / Slider */}
      <div className="px-4 py-3 border-t border-border bg-muted/40 shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <label className="text-xs font-medium text-muted-foreground flex-1">
            Tokens: <span className="text-primary font-bold text-sm">{sliderValue}</span> / {realTokens}
          </label>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
            Max Input Limit: {maxInputTokens === 0 ? '∞' : maxInputTokens}
          </span>
        </div>
        <div className="relative flex items-center h-4">
          <input 
            type="range" 
            min={0} 
            max={maxSlider} 
            value={sliderValue} 
            onChange={(e) => setSliderValue(Number(e.target.value))}
            className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-[hsl(var(--primary))] outline-none transition-colors focus:ring-2 focus:ring-ring/20"
          />
        </div>
      </div>
    </div>
  );
}
