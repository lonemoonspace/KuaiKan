// Development-only instrumentation for diagnosing "time to first character".
// Collects wall-clock marks from the content script and the background
// worker into one timeline and prints a single console.table per summary.
// Only enabled in the `wxt` (dev) build: in release builds
// `import.meta.env.DEV` is false, so every entry point below returns
// immediately and nothing is executed, printed, or sent over the wire.

export const SUMMARY_TIMING_ENABLED = import.meta.env.DEV;

/** Wall-clock ms with sub-ms precision, comparable across extension contexts. */
export function timingNow(): number {
  return performance.timeOrigin + performance.now();
}

export type TimingMarks = Record<string, number>;

type Session = {
  origin: number;
  marks: TimingMarks;
  hasSummaryStart: boolean;
  backgroundReceived: boolean;
  streamEnded: boolean;
  reported: boolean;
};

let session: Session | null = null;

function newSession(originMark: string): Session {
  const origin = timingNow();
  return {
    origin,
    marks: { [originMark]: origin },
    hasSummaryStart: false,
    backgroundReceived: false,
    streamEnded: false,
    reported: false,
  };
}

/** Panel mount: starts the timeline an auto-summary will continue. */
export function beginPanelTiming() {
  if (!SUMMARY_TIMING_ENABLED) return;
  session = newSession('面板初始化开始');
}

/**
 * Summary requested. The first summary after mount continues the panel
 * timeline (so auto-summary includes init cost); any later one starts fresh.
 */
export function beginSummaryTiming() {
  if (!SUMMARY_TIMING_ENABLED) return;
  if (!session || session.hasSummaryStart || session.reported) {
    session = newSession('开始总结');
  } else {
    session.marks['开始总结'] = timingNow();
  }
  session.hasSummaryStart = true;
}

/** Record a mark once per session; later calls with the same name are ignored. */
export function markTiming(name: string, at: number = timingNow()) {
  if (!SUMMARY_TIMING_ENABLED || !session) return;
  if (name in session.marks) return;
  session.marks[name] = at;
  maybeReport();
}

export function mergeBackgroundTiming(marks: TimingMarks, final: boolean) {
  if (!SUMMARY_TIMING_ENABLED || !session) return;
  for (const [name, at] of Object.entries(marks)) {
    // Worker-lifetime marks (cold start, tokenizer load) only matter when
    // they happened during this timeline; earlier ones mean "already warm".
    if (at < session.origin) continue;
    if (!(name in session.marks)) session.marks[name] = at;
  }
  session.backgroundReceived = true;
  if (final) session.streamEnded = true;
  maybeReport();
}

function maybeReport() {
  if (!session || session.reported || !session.backgroundReceived) return;
  if (!('首次渲染到面板' in session.marks) && !session.streamEnded) return;
  session.reported = true;

  const { origin, marks } = session;
  const rows = Object.entries(marks)
    .sort((a, b) => a[1] - b[1])
    .map(([name, at], index, sorted) => ({
      阶段: name,
      '累计 ms': Math.round(at - origin),
      '距上一步 ms': index === 0 ? 0 : Math.round(at - sorted[index - 1][1]),
    }));

  // Deliberately bypasses the logger: the content logger hides info by default.
  console.info('[KuaiKan 计时] 从「%s」到首字的时间线', Object.keys(marks)[0]);
  console.table(rows);
}
