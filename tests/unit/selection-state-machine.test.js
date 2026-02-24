// tests/unit/selection-state-machine.test.js
// 划词翻译状态机测试
//
// 覆盖: state transitions, condition evaluation, multi-click detection, timeout

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { SelectionStateMachine, STATES, CONFIG } = await import('../../electron/utils/selection-state-machine.js');

describe('SelectionStateMachine', () => {
  let sm;

  beforeEach(() => {
    sm = new SelectionStateMachine();
  });

  describe('initial state', () => {
    it('starts in IDLE state', () => {
      expect(sm.state).toBe(STATES.IDLE);
    });
  });

  describe('mousedown → POSSIBLE', () => {
    it('transitions to POSSIBLE on mousedown', () => {
      sm.onMouseDown(100, 100);
      expect(sm.state).toBe(STATES.POSSIBLE);
    });

    it('records starting position', () => {
      sm.onMouseDown(150, 200);
      expect(sm._startX).toBe(150);
      expect(sm._startY).toBe(200);
    });
  });

  describe('mouseup from IDLE', () => {
    it('stays IDLE if mouseup without mousedown', () => {
      const result = sm.onMouseUp(100, 100);
      expect(sm.state).toBe(STATES.IDLE);
      expect(result.shouldShow).toBe(false);
    });
  });

  describe('POSSIBLE → LIKELY via sampling', () => {
    it('transitions to LIKELY with stable direction movement', () => {
      sm.onMouseDown(100, 100);
      expect(sm.state).toBe(STATES.POSSIBLE);

      // Simulate steady horizontal drag (condition A: direction stability)
      const now = Date.now();
      for (let i = 1; i <= 15; i++) {
        sm.onMouseMove(100 + i * 5, 100, now + i * CONFIG.SAMPLE_INTERVAL);
      }

      // Should have reached LIKELY or CONFIRMED by now
      expect([STATES.LIKELY, STATES.CONFIRMED]).toContain(sm.state);
    });
  });

  describe('multi-click detection', () => {
    it('detects double-click pattern', () => {
      const now = Date.now();

      // First click
      sm.onMouseDown(100, 100, now);
      sm.onMouseUp(100, 100, now + 50);

      // Second click within threshold
      sm.onMouseDown(100, 100, now + 150);

      // Should detect multi-click and fast-track to LIKELY
      expect([STATES.LIKELY, STATES.CONFIRMED]).toContain(sm.state);
    });

    it('does not detect click as double-click if too far apart in time', () => {
      const now = Date.now();

      sm.onMouseDown(100, 100, now);
      sm.onMouseUp(100, 100, now + 50);

      // Second click well beyond double-click time window
      sm.onMouseDown(100, 100, now + CONFIG.DOUBLE_CLICK_TIME + 100);

      // Should just be POSSIBLE (normal mousedown), not fast-tracked
      expect(sm.state).toBe(STATES.POSSIBLE);
    });

    it('does not detect click as double-click if too far apart in space', () => {
      const now = Date.now();

      sm.onMouseDown(100, 100, now);
      sm.onMouseUp(100, 100, now + 50);

      // Second click far from first
      sm.onMouseDown(200, 200, now + 100);
      expect(sm.state).toBe(STATES.POSSIBLE);
    });
  });

  describe('CONFIRMED → result', () => {
    it('mouseup from LIKELY returns shouldShow true', () => {
      sm.onMouseDown(100, 100);

      // Force into LIKELY state for testing
      sm.transitionTo(STATES.LIKELY);

      const result = sm.onMouseUp(200, 100);
      expect(result.shouldShow).toBe(true);
      expect(sm.state).toBe(STATES.CONFIRMED);
    });

    it('mouseup from POSSIBLE returns shouldShow false', () => {
      sm.onMouseDown(100, 100);
      // Stay in POSSIBLE (no movement)
      expect(sm.state).toBe(STATES.POSSIBLE);

      const result = sm.onMouseUp(102, 100);  // tiny movement
      expect(result.shouldShow).toBe(false);
    });
  });

  describe('reset', () => {
    it('resets to IDLE', () => {
      sm.onMouseDown(100, 100);
      sm.transitionTo(STATES.LIKELY);
      sm.reset();
      expect(sm.state).toBe(STATES.IDLE);
    });

    it('clears sampling data on reset', () => {
      sm.onMouseDown(100, 100);
      sm.onMouseMove(150, 100);
      sm.reset();

      expect(sm._samples).toEqual([]);
      expect(sm._directions).toEqual([]);
    });
  });

  describe('peekMultiClick', () => {
    it('returns true during a multi-click sequence', () => {
      const now = Date.now();

      sm.onMouseDown(100, 100, now);
      sm.onMouseUp(100, 100, now + 50);

      // Check right before second mousedown
      const isPeek = sm.peekMultiClick(100, 100, now + 100);
      expect(isPeek).toBe(true);
    });

    it('returns false when no prior click', () => {
      expect(sm.peekMultiClick(100, 100, Date.now())).toBe(false);
    });

    it('returns false after timeout', () => {
      const now = Date.now();

      sm.onMouseDown(100, 100, now);
      sm.onMouseUp(100, 100, now + 50);

      // Way after double-click window
      const isPeek = sm.peekMultiClick(100, 100, now + 1000);
      expect(isPeek).toBe(false);
    });
  });

  describe('CONFIG', () => {
    it('has reasonable defaults', () => {
      expect(CONFIG.SAMPLE_INTERVAL).toBeGreaterThan(0);
      expect(CONFIG.DIRECTION_THRESHOLD).toBeGreaterThan(0);
      expect(CONFIG.DOUBLE_CLICK_TIME).toBeGreaterThan(100);
      expect(CONFIG.DOUBLE_CLICK_DISTANCE).toBeGreaterThan(0);
      expect(CONFIG.POSSIBLE_TIMEOUT).toBeGreaterThan(1000);
    });
  });
});
