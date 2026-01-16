// electron/utils/selection-state-machine.js
// 划词翻译状态机 - 智能识别文本选择行为

const logger = require('./logger')('SelectionSM');

// ==================== 常量定义 ====================

const STATES = {
  IDLE: 'idle',
  POSSIBLE: 'possible',      // PossibleSelection - 采样中
  LIKELY: 'likely',          // LikelyTextSelection - 准备显示
  CONFIRMED: 'confirmed',    // ConfirmedSelection - 确认显示
};

const CONFIG = {
  // 采样配置
  SAMPLE_INTERVAL: 25,        // 采样间隔 (ms)
  MIN_DISTANCE: 1.5,          // 最小有效位移 (px)
  MIN_DELTA_TIME: 10,         // 最小有效时间间隔 (ms)
  MIN_DELTA_DISTANCE: 3,      // 配合 MIN_DELTA_TIME 的最小位移 (px)
  
  // 条件 A: 方向稳定
  DIRECTION_WINDOW_SIZE: 5,   // 方向计算窗口大小
  DIRECTION_THRESHOLD: 15,    // 方向变化阈值 (度)
  MIN_TOTAL_DISTANCE: 12,     // 最小总位移 (px)
  MIN_DURATION_A: 80,         // 最小持续时间 (ms)
  
  // 条件 B: 低速精细
  LOW_SPEED_THRESHOLD: 0.1,   // 低速阈值 (px/ms)
  MAX_INSTANT_DISTANCE: 3,    // 最大瞬时位移 (px)
  MIN_DURATION_B: 100,        // 最小持续时间 (ms)
  
  // 条件 C: 双击/三击
  DOUBLE_CLICK_TIME: 300,     // 双击时间窗口 (ms)
  DOUBLE_CLICK_DISTANCE: 5,   // 双击距离阈值 (px)
  
  // 回退配置
  GRACE_PERIOD: 120,          // 进入 Likely 后的宽容期 (ms)
  RETREAT_ANGLE: 60,          // 回退角度阈值 (度)
  RETREAT_COUNT: 3,           // 连续异常次数
  
  // 超时配置
  POSSIBLE_TIMEOUT: 4000,     // Possible 状态超时 (ms)
  LIKELY_TIMEOUT: 2000,       // Likely 状态超时 (ms)
};

// ==================== 状态机类 ====================

class SelectionStateMachine {
  constructor() {
    this.reset();
    this.clickHistory = [];   // 点击历史，用于检测双击/三击
    this.onStateChange = null; // 状态变化回调
  }
  
  /**
   * 重置状态机
   */
  reset() {
    // 先清除定时器（必须在设置 timeoutId = null 之前）
    this.clearTimeout();
    
    this.state = STATES.IDLE;
    this.samples = [];           // 采样点 [{x, y, t}, ...]
    this.directions = [];        // 方向角序列
    this.startPos = null;
    this.startTime = null;
    this.lastSampleTime = 0;
    this.likelyEnteredAt = null; // 进入 Likely 的时间
    this.retreatCount = 0;       // 连续异常计数
  }
  
  /**
   * 清除超时定时器
   */
  clearTimeout() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
  
  /**
   * 设置超时
   */
  setTimeout(duration, nextState = STATES.IDLE) {
    this.clearTimeout();
    this.timeoutId = setTimeout(() => {
      logger.debug(`State timeout: ${this.state} -> ${nextState}`);
      this.transitionTo(nextState);
    }, duration);
  }
  
  /**
   * 状态转换
   */
  transitionTo(newState) {
    const oldState = this.state;
    
    // 避免无意义的状态转换（已经是 IDLE 就不再处理）
    if (oldState === newState && newState === STATES.IDLE) {
      return;
    }
    
    this.state = newState;
    
    logger.debug(`State: ${oldState} -> ${newState}`);
    
    // 设置超时
    if (newState === STATES.POSSIBLE) {
      this.setTimeout(CONFIG.POSSIBLE_TIMEOUT);
    } else if (newState === STATES.LIKELY) {
      this.likelyEnteredAt = Date.now();
      this.retreatCount = 0;
      this.setTimeout(CONFIG.LIKELY_TIMEOUT);
    } else if (newState === STATES.IDLE) {
      this.reset();  // 重置所有状态（reset 内部会清除定时器）
    }
    
    // 触发回调
    if (this.onStateChange) {
      this.onStateChange(newState, oldState);
    }
  }
  
  // ==================== 事件处理 ====================
  
  /**
   * 鼠标按下
   */
  onMouseDown(x, y) {
    const now = Date.now();
    
    // 检测双击/三击 (条件 C)
    if (this.isMultiClick(x, y, now)) {
      logger.debug('Multi-click detected, skip to Likely');
      this.startPos = { x, y };
      this.startTime = now;
      this.transitionTo(STATES.LIKELY);
      return;
    }
    
    // 记录点击历史
    this.clickHistory.push({ x, y, t: now });
    // 只保留最近 3 次
    if (this.clickHistory.length > 3) {
      this.clickHistory.shift();
    }
    
    // 正常流程：进入 Possible
    this.reset();
    this.startPos = { x, y };
    this.startTime = now;
    this.samples.push({ x, y, t: now });
    this.lastSampleTime = now;
    this.transitionTo(STATES.POSSIBLE);
  }
  
  /**
   * 鼠标移动
   */
  onMouseMove(x, y) {
    if (this.state === STATES.IDLE) return;
    
    const now = Date.now();
    
    // 节流采样
    if (now - this.lastSampleTime < CONFIG.SAMPLE_INTERVAL) {
      return;
    }
    
    const lastSample = this.samples[this.samples.length - 1];
    if (!lastSample) return;
    
    const dx = x - lastSample.x;
    const dy = y - lastSample.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const dt = now - lastSample.t;
    
    // 过滤无意义点
    if (distance < CONFIG.MIN_DISTANCE) {
      return;
    }
    if (dt < CONFIG.MIN_DELTA_TIME && distance < CONFIG.MIN_DELTA_DISTANCE) {
      return;
    }
    
    // 添加采样点
    this.samples.push({ x, y, t: now });
    this.lastSampleTime = now;
    
    // 计算方向角
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    this.directions.push(angle);
    
    // 根据当前状态处理
    if (this.state === STATES.POSSIBLE) {
      this.evaluatePossible(now);
    } else if (this.state === STATES.LIKELY) {
      this.evaluateLikely(now);
    }
  }
  
  /**
   * 鼠标释放
   */
  onMouseUp(x, y) {
    const now = Date.now();
    
    // 更新点击历史（用于双击检测）
    if (this.clickHistory.length > 0) {
      const lastClick = this.clickHistory[this.clickHistory.length - 1];
      lastClick.upTime = now;
    }
    
    if (this.state === STATES.LIKELY) {
      // 从 Likely 进入 Confirmed
      this.transitionTo(STATES.CONFIRMED);
      return { shouldShow: true, rect: this.getSelectionRect() };
    } else if (this.state === STATES.POSSIBLE) {
      // 还在 Possible，不显示
      this.transitionTo(STATES.IDLE);
      return { shouldShow: false };
    }
    
    return { shouldShow: false };
  }
  
  // ==================== 条件判断 ====================
  
  /**
   * 检测双击/三击
   */
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
  
  /**
   * 在 Possible 状态下评估是否进入 Likely
   */
  evaluatePossible(now) {
    const duration = now - this.startTime;
    
    // 条件 A: 方向稳定
    if (this.checkDirectionStability(duration)) {
      logger.debug('Condition A met: direction stability');
      this.transitionTo(STATES.LIKELY);
      return;
    }
    
    // 条件 B: 低速精细
    if (this.checkLowSpeedPrecision(duration)) {
      logger.debug('Condition B met: low speed precision');
      this.transitionTo(STATES.LIKELY);
      return;
    }
  }
  
  /**
   * 条件 A: 方向稳定性检测
   */
  checkDirectionStability(duration) {
    if (duration < CONFIG.MIN_DURATION_A) return false;
    if (this.directions.length < CONFIG.DIRECTION_WINDOW_SIZE) return false;
    
    // 检查总位移
    const totalDistance = this.getTotalDistance();
    if (totalDistance < CONFIG.MIN_TOTAL_DISTANCE) return false;
    
    // 计算最近 N 个方向变化的中位数
    const recentDirections = this.directions.slice(-CONFIG.DIRECTION_WINDOW_SIZE);
    const changes = [];
    
    for (let i = 1; i < recentDirections.length; i++) {
      let change = Math.abs(recentDirections[i] - recentDirections[i - 1]);
      // 处理 180° 边界
      if (change > 180) change = 360 - change;
      // 忽略离群值
      if (change > 120) continue;
      changes.push(change);
    }
    
    if (changes.length === 0) return false;
    
    // 计算中位数
    changes.sort((a, b) => a - b);
    const median = changes[Math.floor(changes.length / 2)];
    
    return median < CONFIG.DIRECTION_THRESHOLD;
  }
  
  /**
   * 条件 B: 低速精细检测
   */
  checkLowSpeedPrecision(duration) {
    if (duration < CONFIG.MIN_DURATION_B) return false;
    if (this.samples.length < 3) return false;
    
    // 检查最近一段时间的速度
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
    
    // 检查最大瞬时位移
    for (let i = 1; i < recentSamples.length; i++) {
      const dx = recentSamples[i].x - recentSamples[i - 1].x;
      const dy = recentSamples[i].y - recentSamples[i - 1].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > CONFIG.MAX_INSTANT_DISTANCE) return false;
    }
    
    return true;
  }
  
  /**
   * 在 Likely 状态下评估是否回退
   */
  evaluateLikely(now) {
    // 宽容期内不检测
    if (now - this.likelyEnteredAt < CONFIG.GRACE_PERIOD) {
      return;
    }
    
    // 检查是否需要回退
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
  
  // ==================== 辅助方法 ====================
  
  /**
   * 获取总位移
   */
  getTotalDistance() {
    if (!this.startPos || this.samples.length === 0) return 0;
    
    const lastSample = this.samples[this.samples.length - 1];
    return Math.sqrt(
      Math.pow(lastSample.x - this.startPos.x, 2) +
      Math.pow(lastSample.y - this.startPos.y, 2)
    );
  }
  
  /**
   * 获取选区矩形
   */
  getSelectionRect() {
    if (!this.startPos || this.samples.length === 0) {
      return null;
    }
    
    const lastSample = this.samples[this.samples.length - 1];
    return {
      x: Math.min(this.startPos.x, lastSample.x),
      y: Math.min(this.startPos.y, lastSample.y),
      width: Math.abs(lastSample.x - this.startPos.x),
      height: Math.abs(lastSample.y - this.startPos.y),
    };
  }
  
  /**
   * 获取当前状态
   */
  getState() {
    return this.state;
  }
  
  /**
   * 获取最后位置
   */
  getLastPosition() {
    if (this.samples.length === 0) return this.startPos;
    return this.samples[this.samples.length - 1];
  }
}

// ==================== 导出 ====================

module.exports = {
  SelectionStateMachine,
  STATES,
  CONFIG,
};
