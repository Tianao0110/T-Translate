// The policy table (docs/T-ENGINE.md §7) as code, for the built-in model:
// T-Engine's numbers come in as events, decisions and advice come out. Pure
// and synchronous — the manager feeds it and reads its state; nothing here
// touches a host. Rules by number:
//   P4  self-test below the tier's floor        -> advise (never switch)
//   P5  a stalled request                       -> counted (the host already cancelled it)
//   P6  three stalls / timeouts in a row        -> unhealthy for this session; the chain moves on
//   P9  three runs below half the baseline      -> record "performance drop"
//   P13 a thought block leaked                  -> counted, shown in the trial report
// A host exit or a new model resets the streaks: the numbers were about the
// previous process.

const DEFAULT_THRESHOLDS = {
  slowTokPerSec: 8,
  stallLimit: 3,
  perfDropRatio: 0.5,
  perfDropRuns: 3,
};

const STALL_CODES = new Set(['LLM_TIMEOUT']);

function createLlmPolicy({ thresholds = {} } = {}) {
  const T = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const state = {
    unhealthy: false,
    consecutiveStalls: 0,
    stalls: 0,
    baselineTokPerSec: null,
    slowRuns: 0,
    perfDrop: false,
    slow: false,
    thinkLeaks: 0,
    lastTokPerSec: null,
  };

  function resetStreaks() {
    state.unhealthy = false;
    state.consecutiveStalls = 0;
    state.slowRuns = 0;
    state.perfDrop = false;
  }

  // Returns the actions this event triggered: [{ rule, action, ...detail }].
  function observe(evt) {
    const actions = [];
    if (!evt || evt.engine !== 'llm') return actions;
    switch (evt.kind) {
      case 'health':
        if (evt.ok && typeof evt.tokPerSec === 'number') {
          state.baselineTokPerSec = evt.tokPerSec;
          state.slow = evt.tokPerSec < T.slowTokPerSec;
          if (state.slow) actions.push({ rule: 'P4', action: 'advise', advice: 'slow', tokPerSec: evt.tokPerSec, floor: T.slowTokPerSec });
        }
        break;
      case 'request': {
        if (evt.stop === 'stall') {
          state.stalls++;
          state.consecutiveStalls++;
          actions.push({ rule: 'P5', action: 'count', consecutive: state.consecutiveStalls });
        } else if (evt.stop === 'eog' || evt.stop === 'limit' || evt.stop === 'loop') {
          state.consecutiveStalls = 0;
        }
        if (state.consecutiveStalls >= T.stallLimit && !state.unhealthy) {
          state.unhealthy = true;
          actions.push({ rule: 'P6', action: 'mark-unhealthy', consecutive: state.consecutiveStalls });
        }
        if (typeof evt.tokPerSec === 'number') {
          state.lastTokPerSec = evt.tokPerSec;
          if (state.baselineTokPerSec && evt.tokPerSec < state.baselineTokPerSec * T.perfDropRatio) {
            state.slowRuns++;
            if (state.slowRuns >= T.perfDropRuns && !state.perfDrop) {
              state.perfDrop = true;
              actions.push({ rule: 'P9', action: 'record', advice: 'perf-drop', tokPerSec: evt.tokPerSec, baseline: state.baselineTokPerSec });
            }
          } else {
            state.slowRuns = 0;
            state.perfDrop = false;
          }
        }
        if (evt.thinkLeak > 0) {
          state.thinkLeaks += evt.thinkLeak;
          actions.push({ rule: 'P13', action: 'count', thinkLeak: evt.thinkLeak, total: state.thinkLeaks });
        }
        break;
      }
      case 'request-failed':
        if (STALL_CODES.has(evt.code)) {
          state.stalls++;
          state.consecutiveStalls++;
          actions.push({ rule: 'P5', action: 'count', consecutive: state.consecutiveStalls });
          if (state.consecutiveStalls >= T.stallLimit && !state.unhealthy) {
            state.unhealthy = true;
            actions.push({ rule: 'P6', action: 'mark-unhealthy', consecutive: state.consecutiveStalls });
          }
        }
        break;
      case 'exit':
      case 'model-loaded':
        resetStreaks();
        break;
      default:
        break;
    }
    return actions;
  }

  return {
    observe,
    state: () => ({ ...state, advice: [...(state.slow ? ['slow'] : []), ...(state.perfDrop ? ['perf-drop'] : []), ...(state.unhealthy ? ['unhealthy'] : [])] }),
    reset: () => {
      resetStreaks();
      state.stalls = 0;
      state.baselineTokPerSec = null;
      state.slow = false;
      state.thinkLeaks = 0;
      state.lastTokPerSec = null;
    },
    thresholds: T,
  };
}

module.exports = { createLlmPolicy, DEFAULT_THRESHOLDS };
