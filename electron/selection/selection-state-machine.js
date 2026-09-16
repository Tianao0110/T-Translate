// Kinematic detection of a deliberate text-selection gesture from the global
// mouse hook (controller.js feeds it). Conditions and numbers:
// docs/design/selection.md §1.

const logger = require('../platform/logger')('SelectionSM');

// ===== Constants =====

const STATES = {
  IDLE: 'idle',
  POSSIBLE: 'possible',      // Sampling — too early to decide
  LIKELY: 'likely',          // Conditions met — about to show trigger
  CONFIRMED: 'confirmed',    // mouseup confirmed
};

const CONFIG = {
  // Sampling
  SAMPLE_INTERVAL: 25,
  MIN_DISTANCE: 1.5,
  MIN_DELTA_TIME: 10,
  MIN_DELTA_DISTANCE: 3,

  // Condition A: direction stability
  DIRECTION_WINDOW_SIZE: 5,
  DIRECTION_THRESHOLD: 15,
  MIN_TOTAL_DISTANCE: 12,
  MIN_DURATION_A: 80,

  // Condition B: slow and precise
  LOW_SPEED_THRESHOLD: 0.1,
  MAX_INSTANT_DISTANCE: 3,
  MIN_DURATION_B: 100,

  // Condition D: fast decisive, horizontal-dominant
  MIN_DURATION_D: 10,
  MIN_DISTANCE_D: 8,
  MIN_HORIZONTAL_D: 5,
  MIN_SPEED_D: 0.2,
  MAX_VERTICAL_RATIO_D: 0.6,

  // Condition C: double / triple click
  DOUBLE_CLICK_TIME: 400,
  DOUBLE_CLICK_DISTANCE: 15,

  // Sticky-direct: minimum drag before the CapsLock path may inject Ctrl+C.
  STICKY_MIN_DISTANCE: 8,

  // Retreat (LIKELY -> POSSIBLE rollback)
  GRACE_PERIOD: 120,
  RETREAT_ANGLE: 60,
  RETREAT_COUNT: 3,

  // State timeouts
  POSSIBLE_TIMEOUT: 4000,
  LIKELY_TIMEOUT: 2000,
};

// ===== State machine =====

class SelectionStateMachine {
  // Injectable clock: the conditions divide distance by time, so tests control it.
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.reset();
    this.clickHistory = [];
    this.isMultiClickTriggered = false;
  }

  reset() {
    this.clearTimeout();

    this.state = STATES.IDLE;
    this.samples = [];           // [{x, y, t}, ...]
    this.directions = [];        // Direction angles
    this.startPos = null;
    this.startTime = null;
    this.lastSampleTime = 0;
    this.likelyEnteredAt = null;
    this.retreatCount = 0;
    this.isMultiClickTriggered = false;
    this.isHotkeyTriggered = false;
  }

  clearTimeout() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  setTimeout(duration, nextState = STATES.IDLE) {
    this.clearTimeout();
    this.timeoutId = setTimeout(() => {
      logger.debug(`State timeout: ${this.state} -> ${nextState}`);
      this.transitionTo(nextState);
    }, duration);
  }

  transitionTo(newState) {
    const oldState = this.state;

    if (oldState === newState && newState === STATES.IDLE) {
      return;
    }

    this.state = newState;

    logger.debug(`State: ${oldState} -> ${newState}`);

    if (newState === STATES.POSSIBLE) {
      this.setTimeout(CONFIG.POSSIBLE_TIMEOUT);
    } else if (newState === STATES.LIKELY) {
      this.likelyEnteredAt = this.now();
      this.retreatCount = 0;
      // The sticky direct path has no watchdog: mouseup resolves it.
      if (!this.isHotkeyTriggered) {
        this.setTimeout(CONFIG.LIKELY_TIMEOUT);
      }
    } else if (newState === STATES.IDLE) {
      this.reset();
    }
  }

  // ===== Event handlers =====

  // hotkeyActive: sticky direct mode (CapsLock toggle) on at this moment.
  onMouseDown(x, y, hotkeyActive = false) {
    const now = this.now();

    const isMulti = this.isMultiClick(x, y, now);

    this.clickHistory.push({ x, y, t: now });
    if (this.clickHistory.length > 3) {
      this.clickHistory.shift();
    }

    this.reset();
    this.isMultiClickTriggered = isMulti;
    this.isHotkeyTriggered = hotkeyActive;
    this.startPos = { x, y };
    this.startTime = now;
    this.samples.push({ x, y, t: now });
    this.lastSampleTime = now;

    // Priority: sticky direct > multi-click > normal flow.
    if (hotkeyActive) {
      logger.debug('Sticky direct (CapsLock on) detected, entering LIKELY direct');
      this.transitionTo(STATES.LIKELY);
    } else if (isMulti) {
      logger.debug('Multi-click detected, entering Likely (needs delayed confirm)');
      this.transitionTo(STATES.LIKELY);
    } else {
      this.transitionTo(STATES.POSSIBLE);
    }
  }

  onMouseMove(x, y) {
    if (this.state === STATES.IDLE) return;

    const now = this.now();

    if (now - this.lastSampleTime < CONFIG.SAMPLE_INTERVAL) {
      return;
    }

    const lastSample = this.samples[this.samples.length - 1];
    if (!lastSample) return;

    const dx = x - lastSample.x;
    const dy = y - lastSample.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const dt = now - lastSample.t;

    // Drop noise.
    if (distance < CONFIG.MIN_DISTANCE) {
      return;
    }
    if (dt < CONFIG.MIN_DELTA_TIME && distance < CONFIG.MIN_DELTA_DISTANCE) {
      return;
    }

    this.samples.push({ x, y, t: now });
    this.lastSampleTime = now;

    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    this.directions.push(angle);

    if (this.state === STATES.POSSIBLE) {
      this.evaluatePossible(now);
    } else if (this.state === STATES.LIKELY) {
      this.evaluateLikely(now);
    }
  }

  // Returns { shouldShow, skipIcon?, needsDelayedConfirm? } for controller.js.
  onMouseUp(x, y, hotkeyActive = false) {
    const now = this.now();

    // Always stamp upTime, the hotkey path included.
    if (this.clickHistory.length > 0) {
      const lastClick = this.clickHistory[this.clickHistory.length - 1];
      lastClick.upTime = now;
    }

    if (this.state === STATES.LIKELY) {
      this.transitionTo(STATES.CONFIRMED);

      // Sticky direct: hotkey active at both mousedown and mouseup, with a real drag.
      if (this.isHotkeyTriggered && hotkeyActive) {
        if (this.getTotalDistance() < CONFIG.STICKY_MIN_DISTANCE) {
          logger.debug('Sticky direct: pure click, no drag — skip (no injection)');
          return { shouldShow: false };
        }
        logger.debug('Sticky direct path (skipIcon)');
        return { shouldShow: true, skipIcon: true };
      }

      if (this.isMultiClickTriggered) {
        logger.debug('Multi-click needs delayed confirmation');
        return { shouldShow: true, needsDelayedConfirm: true };
      }

      return { shouldShow: true };
    } else if (this.state === STATES.POSSIBLE) {
      this.transitionTo(STATES.IDLE);
      return { shouldShow: false };
    }

    return { shouldShow: false };
  }

  // ===== Conditions =====

  isMultiClick(x, y, now) {
    if (this.clickHistory.length === 0) return false;

    const lastClick = this.clickHistory[this.clickHistory.length - 1];
    if (!lastClick.upTime) return false;

    const timeDiff = now - lastClick.upTime;
    const distance = Math.sqrt(
      Math.pow(x - lastClick.x, 2) +
      Math.pow(y - lastClick.y, 2)
    );

    return timeDiff < CONFIG.DOUBLE_CLICK_TIME &&
           distance < CONFIG.DOUBLE_CLICK_DISTANCE;
  }

  // Non-mutating multi-click check for mousedown (controller keeps the trigger up).
  peekMultiClick(x, y) {
    const now = this.now();
    if (this.clickHistory.length === 0) return false;

    const lastClick = this.clickHistory[this.clickHistory.length - 1];
    if (!lastClick.upTime) return false;

    const timeDiff = now - lastClick.upTime;
    const distance = Math.sqrt(
      Math.pow(x - lastClick.x, 2) +
      Math.pow(y - lastClick.y, 2)
    );

    const isMulti = timeDiff < CONFIG.DOUBLE_CLICK_TIME &&
                    distance < CONFIG.DOUBLE_CLICK_DISTANCE;

    if (isMulti) {
      logger.debug(`peekMultiClick: true (timeDiff=${timeDiff}ms, distance=${distance.toFixed(1)}px)`);
    }

    return isMulti;
  }

  // POSSIBLE -> LIKELY: conditions D / A / B in that order.
  evaluatePossible(now) {
    const duration = now - this.startTime;

    if (this.checkFastDecisive(duration)) {
      logger.debug('Condition D met: fast decisive selection');
      this.transitionTo(STATES.LIKELY);
      return;
    }

    if (this.checkDirectionStability(duration)) {
      logger.debug('Condition A met: direction stability');
      this.transitionTo(STATES.LIKELY);
      return;
    }

    if (this.checkLowSpeedPrecision(duration)) {
      logger.debug('Condition B met: low speed precision');
      this.transitionTo(STATES.LIKELY);
      return;
    }
  }

  checkDirectionStability(duration) {
    if (duration < CONFIG.MIN_DURATION_A) return false;
    if (this.directions.length < CONFIG.DIRECTION_WINDOW_SIZE) return false;

    const totalDistance = this.getTotalDistance();
    if (totalDistance < CONFIG.MIN_TOTAL_DISTANCE) return false;

    // Median direction change across the recent window (wrap at 180°, outliers out).
    const recentDirections = this.directions.slice(-CONFIG.DIRECTION_WINDOW_SIZE);
    const changes = [];

    for (let i = 1; i < recentDirections.length; i++) {
      let change = Math.abs(recentDirections[i] - recentDirections[i - 1]);
      if (change > 180) change = 360 - change;
      if (change > 120) continue;
      changes.push(change);
    }

    if (changes.length === 0) return false;

    changes.sort((a, b) => a - b);
    const median = changes[Math.floor(changes.length / 2)];

    return median < CONFIG.DIRECTION_THRESHOLD;
  }

  checkLowSpeedPrecision(duration) {
    if (duration < CONFIG.MIN_DURATION_B) return false;
    if (this.samples.length < 3) return false;

    const recentSamples = this.samples.slice(-5);
    if (recentSamples.length < 2) return false;

    const firstSample = recentSamples[0];
    const lastSample = recentSamples[recentSamples.length - 1];

    const totalDist = Math.sqrt(
      Math.pow(lastSample.x - firstSample.x, 2) +
      Math.pow(lastSample.y - firstSample.y, 2)
    );
    const totalTime = lastSample.t - firstSample.t;

    if (totalTime < CONFIG.MIN_DURATION_B) return false;

    const avgSpeed = totalDist / totalTime;
    if (avgSpeed > CONFIG.LOW_SPEED_THRESHOLD) return false;

    // Reject any single large hop.
    for (let i = 1; i < recentSamples.length; i++) {
      const dx = recentSamples[i].x - recentSamples[i - 1].x;
      const dy = recentSamples[i].y - recentSamples[i - 1].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > CONFIG.MAX_INSTANT_DISTANCE) return false;
    }

    return true;
  }

  // Condition D: fast, horizontal-dominant drag.
  checkFastDecisive(duration) {
    if (duration < CONFIG.MIN_DURATION_D) return false;
    if (this.samples.length < 2) return false;
    if (!this.startPos) return false;

    const totalDistance = this.getTotalDistance();
    if (totalDistance < CONFIG.MIN_DISTANCE_D) return false;

    const lastSample = this.samples[this.samples.length - 1];
    const dx = Math.abs(lastSample.x - this.startPos.x);
    const dy = Math.abs(lastSample.y - this.startPos.y);
    if (dx < CONFIG.MIN_HORIZONTAL_D) return false;
    if (dx > 0 && dy / dx > CONFIG.MAX_VERTICAL_RATIO_D) return false;
    const speed = totalDistance / duration;
    if (speed < CONFIG.MIN_SPEED_D) return false;

    return true;
  }

  // LIKELY -> POSSIBLE retreat on RETREAT_COUNT sharp direction changes.
  evaluateLikely(now) {
    // The watchdog means "LIKELY_TIMEOUT without movement": refresh per sample.
    if (!this.isHotkeyTriggered) {
      this.setTimeout(CONFIG.LIKELY_TIMEOUT);
    }

    if (now - this.likelyEnteredAt < CONFIG.GRACE_PERIOD) {
      return;
    }

    if (this.directions.length < 2) return;

    const lastAngle = this.directions[this.directions.length - 1];
    const prevAngle = this.directions[this.directions.length - 2];

    let change = Math.abs(lastAngle - prevAngle);
    if (change > 180) change = 360 - change;

    if (change > CONFIG.RETREAT_ANGLE) {
      this.retreatCount++;
      if (this.retreatCount >= CONFIG.RETREAT_COUNT) {
        logger.debug('Retreat condition met, back to Possible');
        this.transitionTo(STATES.POSSIBLE);
      }
    } else {
      this.retreatCount = 0;
    }
  }

  // ===== Helpers =====

  getTotalDistance() {
    if (!this.startPos || this.samples.length === 0) return 0;

    const lastSample = this.samples[this.samples.length - 1];
    return Math.sqrt(
      Math.pow(lastSample.x - this.startPos.x, 2) +
      Math.pow(lastSample.y - this.startPos.y, 2)
    );
  }

  getState() {
    return this.state;
  }
}

module.exports = {
  SelectionStateMachine,
  STATES,
  CONFIG,
};
