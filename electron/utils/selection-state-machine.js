// Selection state machine — kinematic detection of intentional text-selection gestures.

const logger = require('./logger')('SelectionSM');

// ===== Constants =====

const STATES = {
  IDLE: 'idle',
  POSSIBLE: 'possible',      // Sampling — too early to decide
  LIKELY: 'likely',          // Conditions met — about to show trigger
  CONFIRMED: 'confirmed',    // mouseup confirmed
};

const CONFIG = {
  // Sampling
  SAMPLE_INTERVAL: 25,        // Sampling interval (ms)
  MIN_DISTANCE: 1.5,          // Min valid displacement (px)
  MIN_DELTA_TIME: 10,         // Min valid time delta (ms)
  MIN_DELTA_DISTANCE: 3,      // Min displacement paired with MIN_DELTA_TIME (px)

  // Condition A: direction stability
  DIRECTION_WINDOW_SIZE: 5,
  DIRECTION_THRESHOLD: 15,    // Direction-change tolerance (degrees)
  MIN_TOTAL_DISTANCE: 12,     // Min total displacement (px)
  MIN_DURATION_A: 80,         // Min duration (ms)

  // Condition B: slow & precise (deliberate)
  LOW_SPEED_THRESHOLD: 0.1,   // Max avg speed (px/ms)
  MAX_INSTANT_DISTANCE: 3,    // Max instantaneous jump (px)
  MIN_DURATION_B: 100,        // Min duration (ms)

  // Condition D: fast decisive selection
  // Added to fix auto-detect path missing "user drags fast across a word" cases.
  // Threshold rationale: D fires in ~10ms while A/B need ≥80ms; speed must be >0.2 px/ms
  // (B requires ≤0.1 — non-overlapping); horizontal-dominant motion only (filters out
  // diagonal drags which are typically not selection).
  MIN_DURATION_D: 10,
  MIN_DISTANCE_D: 8,
  MIN_HORIZONTAL_D: 5,
  MIN_SPEED_D: 0.2,
  MAX_VERTICAL_RATIO_D: 0.6,  // dy/dx upper bound

  // Condition C: double / triple click
  DOUBLE_CLICK_TIME: 400,     // Multi-click time window (ms)
  DOUBLE_CLICK_DISTANCE: 15,  // Multi-click distance threshold (px)

  // Sticky-direct: minimum drag before the CapsLock path fires. A pure click
  // (zero drag) must NOT trigger the direct Ctrl+C injection — in a terminal
  // with no selection that Ctrl+C is a SIGINT that kills the running process.
  STICKY_MIN_DISTANCE: 8,

  // Retreat (LIKELY → POSSIBLE rollback)
  GRACE_PERIOD: 120,          // No retreat checks during this window after entering LIKELY (ms)
  RETREAT_ANGLE: 60,          // Min direction-change angle counted as a retreat sample (deg)
  RETREAT_COUNT: 3,           // Consecutive retreat samples required

  // State timeouts
  POSSIBLE_TIMEOUT: 4000,
  LIKELY_TIMEOUT: 2000,
};

// ===== State machine =====

class SelectionStateMachine {
  constructor() {
    this.reset();
    this.clickHistory = [];
    this.isMultiClickTriggered = false;
  }

  reset() {
    // clearTimeout MUST run before nulling timeoutId.
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

    // No-op: already IDLE.
    if (oldState === newState && newState === STATES.IDLE) {
      return;
    }

    this.state = newState;

    logger.debug(`State: ${oldState} -> ${newState}`);

    if (newState === STATES.POSSIBLE) {
      this.setTimeout(CONFIG.POSSIBLE_TIMEOUT);
    } else if (newState === STATES.LIKELY) {
      this.likelyEnteredAt = Date.now();
      this.retreatCount = 0;
      // Sticky direct path needs no watchdog: the user is actively dragging and mouseup
      // resolves the state. The 2s LIKELY_TIMEOUT would falsely kill long slow selections
      // on the direct path.
      if (!this.isHotkeyTriggered) {
        this.setTimeout(CONFIG.LIKELY_TIMEOUT);
      }
    } else if (newState === STATES.IDLE) {
      this.reset();
    }
  }

  // ===== Event handlers =====

  /**
   * @param {number} x
   * @param {number} y
   * @param {boolean} hotkeyActive — sticky direct mode (CapsLock toggle) on at this moment
   */
  onMouseDown(x, y, hotkeyActive = false) {
    const now = Date.now();

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
    // Sticky direct + multi-click together still goes through the direct path
    // (user's explicit intent wins).
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

    const now = Date.now();

    // Throttle by sample interval.
    if (now - this.lastSampleTime < CONFIG.SAMPLE_INTERVAL) {
      return;
    }

    const lastSample = this.samples[this.samples.length - 1];
    if (!lastSample) return;

    const dx = x - lastSample.x;
    const dy = y - lastSample.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const dt = now - lastSample.t;

    // Drop noise: tiny moves or too-fast samples with tiny displacement.
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

  /**
   * @param {number} x
   * @param {number} y
   * @param {boolean} hotkeyActive — sticky direct mode on at this moment
   */
  onMouseUp(x, y, hotkeyActive = false) {
    const now = Date.now();

    // Always stamp upTime (even on hotkey path) — otherwise the next double-click
    // after a sticky direct can be misclassified.
    if (this.clickHistory.length > 0) {
      const lastClick = this.clickHistory[this.clickHistory.length - 1];
      lastClick.upTime = now;
    }

    if (this.state === STATES.LIKELY) {
      this.transitionTo(STATES.CONFIRMED);

      // Sticky direct path: hotkey was active at BOTH mousedown and mouseup.
      // Caller skips the trigger icon and goes straight to capture+translate.
      // Note: direct beats multi-click — both flags true still uses this branch.
      if (this.isHotkeyTriggered && hotkeyActive) {
        // Require a real drag: a pure click must not inject Ctrl+C (SIGINT risk).
        if (this.getTotalDistance() < CONFIG.STICKY_MIN_DISTANCE) {
          logger.debug('Sticky direct: pure click, no drag — skip (no injection)');
          return { shouldShow: false };
        }
        logger.debug('Sticky direct path (skipIcon)');
        return { shouldShow: true, skipIcon: true };
      }

      // Multi-click needs delayed confirm — system needs time to actually select.
      if (this.isMultiClickTriggered) {
        logger.debug('Multi-click needs delayed confirmation');
        return { shouldShow: true, needsDelayedConfirm: true };
      }

      // Normal return — also covers "CapsLock was on at mousedown but off at mouseup"
      // (user released sticky mid-drag). Falls back to ordinary trigger-icon flow.
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

  // Non-mutating peek used during mousedown to decide whether to hide the existing
  // window (avoid flicker when a double-click is about to extend selection).
  peekMultiClick(x, y) {
    const now = Date.now();
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

  // Evaluate POSSIBLE → LIKELY transition. Conditions D / A / B checked in that order;
  // D wins fastest (~10ms) so we test it first.
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

    // Median direction-change across the recent window. Wrapping handled at 180°;
    // outliers (>120°) ignored — they're usually transient noise.
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

    // Speed-check the recent N samples, not the whole trajectory.
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

    // Even with low avg speed, reject if any single hop is large (likely a fast pan).
    for (let i = 1; i < recentSamples.length; i++) {
      const dx = recentSamples[i].x - recentSamples[i - 1].x;
      const dy = recentSamples[i].y - recentSamples[i - 1].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > CONFIG.MAX_INSTANT_DISTANCE) return false;
    }

    return true;
  }

  // Condition D — fixes "user drags fast across one word and FSM misses it" on the
  // auto-detect path. See CONFIG for threshold rationale.
  checkFastDecisive(duration) {
    if (duration < CONFIG.MIN_DURATION_D) return false;
    if (this.samples.length < 2) return false;
    if (!this.startPos) return false;

    const totalDistance = this.getTotalDistance();
    if (totalDistance < CONFIG.MIN_DISTANCE_D) return false;

    // Horizontal vs vertical: from startPos to the latest sample.
    const lastSample = this.samples[this.samples.length - 1];
    const dx = Math.abs(lastSample.x - this.startPos.x);
    const dy = Math.abs(lastSample.y - this.startPos.y);

    // Must be clearly horizontal-dominant.
    if (dx < CONFIG.MIN_HORIZONTAL_D) return false;

    // Reject diagonal drags (dy must not exceed dx by too much).
    if (dx > 0 && dy / dx > CONFIG.MAX_VERTICAL_RATIO_D) return false;

    // Must be fast (distinguishes from Condition B's slow & precise).
    const speed = totalDistance / duration;
    if (speed < CONFIG.MIN_SPEED_D) return false;

    return true;
  }

  // Evaluate LIKELY → POSSIBLE retreat. RETREAT_COUNT consecutive samples with
  // sharp direction change (>RETREAT_ANGLE) rolls the state back.
  evaluateLikely(now) {
    // Refresh the watchdog on every accepted sample so LIKELY_TIMEOUT means
    // "2s without movement", not "2s since entering LIKELY" — otherwise a slow
    // multi-line drag that takes >2s gets killed mid-selection. Hotkey path has
    // no watchdog (see transitionTo), so leave it alone.
    if (!this.isHotkeyTriggered) {
      this.setTimeout(CONFIG.LIKELY_TIMEOUT);
    }

    // No retreat checks during the grace period.
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
