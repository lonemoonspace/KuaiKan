import type { ModelConfigItem } from '@/constants/model-settings';

interface UsageDisplayProps {
  messages: any[];
  currentModel?: ModelConfigItem;
}

export function UsageDisplay({ messages, currentModel }: UsageDisplayProps) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCached = 0;

  const latestAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  for (const m of latestAssistant ? [latestAssistant] : []) {
    if (m.role === 'assistant') {
      const usage = (m.metadata as any)?.usage;
      if (usage) {
        totalInput += usage.inputTokens ?? usage.promptTokens ?? 0;
        totalOutput += usage.outputTokens ?? usage.completionTokens ?? 0;
        totalCached += usage.cachedInputTokens ?? usage.inputTokenDetails?.cacheReadTokens ?? usage.promptTokensDetails?.cachedTokens ?? usage.cachedTokens ?? 0;
      }
    }
  }

  if (totalInput === 0 && totalOutput === 0) return null;

  // Providers disagree on whether `inputTokens` already excludes cache reads.
  // Clamping at 0 keeps the uncached remainder sane for the ones that do,
  // instead of producing a negative token count and a negative cost.
  const rawInput = Math.max(0, totalInput - totalCached);

  const priceUnit = currentModel?.priceUnit || '$';

  // Cached-input discount, per provider family. Anthropic bills cache reads at
  // 1/10 of the input price, OpenAI at 1/2, Google at 1/4; a single hardcoded
  // 1/10 made the displayed cost wrong for most configured providers.
  const cachedInputRate = (() => {
    switch (currentModel?.providerId) {
      case 'anthropic':
        return 0.1;
      case 'google':
        return 0.25;
      case 'openai':
      case 'open-responses':
      case 'openai-compatible':
        return 0.5;
      default:
        return 0.5;
    }
  })();

  const rawInputCost = currentModel ? (rawInput * currentModel.inputTokenPrice) / 1_000_000 : 0;
  const cachedCost = currentModel
    ? (totalCached * (currentModel.inputTokenPrice * cachedInputRate)) / 1_000_000
    : 0;
  const outputCost = currentModel ? (totalOutput * currentModel.outputTokenPrice) / 1_000_000 : 0;

  const totalCost = rawInputCost + cachedCost + outputCost;

  const formatCost = (cost: number) => {
    if (!cost) return '0';
    if (cost < 0.000001) return '<0.000001';
    return parseFloat(cost.toFixed(6)).toString();
  };

  const hoverText =
    `↑in: ${rawInput} ${priceUnit}${formatCost(rawInputCost)}` +
    (totalCached > 0 ? ` (cached: ${totalCached} ${priceUnit}${formatCost(cachedCost)})` : '') +
    `    ↓out: ${totalOutput} ${priceUnit}${formatCost(outputCost)}`;

  return (
    <div title={hoverText} className="px-1.5 py-0.5 bg-zinc-300/80 backdrop-blur-md rounded-md text-[10px] text-zinc-600 font-mono tracking-tight flex items-center gap-1.5 leading-tight">
      <span>↑{totalInput}</span>
      <span>↓{totalOutput}</span>
      {totalCost > 0 && <span>{priceUnit}{formatCost(totalCost)}</span>}
    </div>
  );
}
