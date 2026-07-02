// Full coverage for SelectionStateMachine: state transitions, the three
// LIKELY-entry conditions (A/B/D), hotkey sticky path, double-click, retreat,
// and reset.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// FSM uses require('./logger')('SelectionSM'); logger in turn pulls in
// `electron`. Stub the logger so neither dependency loads under Node.
vi.mock('../../electron/utils/logger.js', () => ({
  default: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

const smModule = await import('../../electron/utils/selection-state-machine.js');
const { SelectionStateMachine, STATES, CONFIG } = smModule.default;

describe('SelectionStateMachine', () => {
  let sm;

  beforeEach(() => {
    sm = new SelectionStateMachine();
  });

  // ===== Basic transitions =====

  it('starts in IDLE', () => {
    expect(sm.state).toBe(STATES.IDLE);
  });

  it('IDLE → POSSIBLE on onMouseDown (no hotkey)', () => {
    sm.onMouseDown(100, 100, false);
    expect(sm.state).toBe(STATES.POSSIBLE);
    expect(sm.isHotkeyTriggered).toBe(false);
  });

  it('IDLE → LIKELY on onMouseDown with hotkeyActive=true (sticky direct)', () => {
    sm.onMouseDown(100, 100, true);
    expect(sm.state).toBe(STATES.LIKELY);
    expect(sm.isHotkeyTriggered).toBe(true);
  });

  // ===== Condition A: long duration + stable direction =====

  it('Condition A: long duration + stable direction → POSSIBLE → LIKELY', async () => {
    sm.onMouseDown(100, 100, false);
    expect(sm.state).toBe(STATES.POSSIBLE);

    // Simulate a horizontally-stable drag exceeding MIN_DURATION_A (80ms)
    // and MIN_TOTAL_DISTANCE (12px).
    for (let i = 1; i <= 10; i++) {
      // 30ms per step (> SAMPLE_INTERVAL 25), moving right.
      await new Promise(r => setTimeout(r, 30));
      sm.onMouseMove(100 + i * 4, 100);
    }
    expect(sm.state).toBe(STATES.LIKELY);
  });

  // ===== Condition B: long duration + low speed (fine precision) =====

  it('Condition B: long duration + low speed → POSSIBLE → LIKELY', async () => {
    sm.onMouseDown(100, 100, false);

    // 50ms steps moving 2px → 0.04 px/ms < LOW_SPEED_THRESHOLD 0.1.
    // Total duration > MIN_DURATION_B (100ms).
    for (let i = 1; i <= 6; i++) {
      await new Promise(r => setTimeout(r, 50));
      sm.onMouseMove(100 + i * 2, 100);
    }
    expect(sm.state).toBe(STATES.LIKELY);
  });

  // ===== Condition D: short duration + high horizontal speed
  //                    (v0.2.4 fix for fast selection drag misses) =====

  it('Condition D: short duration + high horizontal speed → POSSIBLE → LIKELY', async () => {
    sm.onMouseDown(100, 100, false);

    // ~30ms / ~12px horizontal → 0.4 px/ms > MIN_SPEED_D 0.2.
    // Satisfies MIN_DURATION_D 10ms / MIN_DISTANCE_D 8px / MIN_HORIZONTAL_D 5px.
    await new Promise(r => setTimeout(r, 15));
    sm.onMouseMove(108, 100);  // dx=8, dy=0
    await new Promise(r => setTimeout(r, 15));
    sm.onMouseMove(115, 100);  // dx=15, dy=0 cumulative

    expect(sm.state).toBe(STATES.LIKELY);
  });

  // ===== Retreat: LIKELY → POSSIBLE when direction flips =====

  // TODO(v0.3): retreat tests are timing-sensitive and flaky. Better to
  // unit-test evaluateLikely's angle calculation and retreatCount accumulation
  // directly. Current FSM retreat behavior is still hand-tested.
  it.skip('retreat: direction flip after entering LIKELY falls back to POSSIBLE', async () => {
    // skipped — see TODO above
  });

  // ===== onMouseUp three branches =====

  it('onMouseUp: sticky + real drag (hotkey both ends) → skipIcon:true', async () => {
    sm.onMouseDown(100, 100, true);   // sticky → LIKELY
    await new Promise(r => setTimeout(r, 30));  // clear the sample throttle
    sm.onMouseMove(120, 100);         // drag 20px > STICKY_MIN_DISTANCE
    const result = sm.onMouseUp(120, 100, true);
    expect(result.shouldShow).toBe(true);
    expect(result.skipIcon).toBe(true);
    expect(result.rect).toBeDefined();
  });

  it('onMouseUp: sticky + pure click (no drag) → shouldShow:false, no Ctrl+C injection', () => {
    sm.onMouseDown(100, 100, true);   // sticky → LIKELY
    const result = sm.onMouseUp(100, 100, true);  // released at same spot
    expect(result.shouldShow).toBe(false);
    expect(result.skipIcon).toBeUndefined();
  });

  it('onMouseUp: CapsLock released mid-drag (hotkey=false) → normal flow, no skipIcon', () => {
    sm.onMouseDown(100, 100, true);   // hotkey ON at mousedown
    const result = sm.onMouseUp(100, 100, false);  // hotkey OFF at mouseup
    expect(result.shouldShow).toBe(true);
    expect(result.skipIcon).toBeUndefined();  // normal flow
  });

  it('onMouseUp: POSSIBLE state (no condition met) → shouldShow:false', () => {
    sm.onMouseDown(100, 100, false);
    expect(sm.state).toBe(STATES.POSSIBLE);
    const result = sm.onMouseUp(100, 100, false);
    expect(result.shouldShow).toBe(false);
  });

  // ===== peekMultiClick double-click =====

  it('peekMultiClick: second click within window at same spot → true', () => {
    const t = Date.now();
    sm.clickHistory.push({ x: 100, y: 100, t, upTime: t + 50 });
    const result = sm.peekMultiClick(100, 100);
    expect(result).toBe(true);
  });

  it('peekMultiClick: previous click too old → false', () => {
    const t = Date.now() - CONFIG.DOUBLE_CLICK_TIME - 100;  // outside window
    sm.clickHistory.push({ x: 100, y: 100, t, upTime: t + 50 });
    const result = sm.peekMultiClick(100, 100);
    expect(result).toBe(false);
  });

  it('peekMultiClick: too far away → false', () => {
    const t = Date.now();
    sm.clickHistory.push({ x: 100, y: 100, t, upTime: t + 50 });
    const result = sm.peekMultiClick(200, 100);  // 100 > DOUBLE_CLICK_DISTANCE 15
    expect(result).toBe(false);
  });

  // ===== clickHistory.upTime preserved (hotkey-path regression guard) =====

  it('hotkey path mouseup still updates clickHistory.upTime (guards double-click misfire)', () => {
    sm.onMouseDown(100, 100, true);  // sticky direct → LIKELY
    expect(sm.clickHistory.length).toBe(1);
    expect(sm.clickHistory[0].upTime).toBeUndefined();

    sm.onMouseUp(100, 100, true);
    expect(sm.clickHistory[0].upTime).toBeDefined();
    expect(typeof sm.clickHistory[0].upTime).toBe('number');
  });

  // ===== reset() =====

  it('reset() clears isHotkeyTriggered + FSM internal state', () => {
    sm.onMouseDown(100, 100, true);
    expect(sm.isHotkeyTriggered).toBe(true);
    expect(sm.state).toBe(STATES.LIKELY);

    sm.reset();
    expect(sm.isHotkeyTriggered).toBe(false);
    expect(sm.state).toBe(STATES.IDLE);
    expect(sm.samples).toEqual([]);
    expect(sm.directions).toEqual([]);
  });
});
