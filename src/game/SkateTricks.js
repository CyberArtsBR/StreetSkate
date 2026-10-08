import { directionKey, flipFor, doubleFlipFor, grabFor, grindFor, FLATLAND_TRICKS, MANUALS } from './TrickCatalog.js';

const TAP_WINDOW = 0.46;
const COMBO_WINDOW = 0.38;
const LANDING_GRACE = 0.24;
const AIR_FLIP_GRACE = 0.18;
const AIR_QUEUE_WINDOW = 0.72;
const MAX_QUEUED_AIR_TRICKS = 2;
const REPEAT_VALUES = [1, 0.75, 0.5, 0.25, 0.1];

export class SkateTricks {
  constructor() { this.reset(); }

  reset() {
    this.time = 0;
    this.lastDirectionTap = null;
    this.pendingManual = null;
    this.pendingAirFlip = null;
    this.pendingAirGrab = null;
    this.airTrickQueue = [];
    this.buttonBuffer = [];
    this.combo = [];
    this.comboBase = 0;
    this.comboMultiplier = 0;
    this.durationFraction = 0;
    this.comboStartedAt = 0;
    this.settleTimer = 0;
    this.lastLabel = '';
  }

  cancelCombo() {
    const time = this.time;
    this.reset();
    this.time = time;
    this.comboStartedAt = time;
  }

  // Pause and mode changes discard button history without cashing or losing a combo.
  clearPendingInput() {
    this.lastDirectionTap = null;
    this.pendingManual = null;
    this.pendingAirFlip = null;
    this.pendingAirGrab = null;
    this.buttonBuffer.length = 0;
    this.clearAirQueue();
  }

  tick(dt) {
    this.time += dt;
    this.buttonBuffer = this.buttonBuffer.filter(x => this.time - x.time <= COMBO_WINDOW);
    if (this.pendingManual && this.time > this.pendingManual.expires) this.pendingManual = null;
    if (this.pendingAirFlip && this.time > this.pendingAirFlip.expires) this.pendingAirFlip = null;
    if (this.pendingAirGrab && this.time > this.pendingAirGrab.expires) this.pendingAirGrab = null;
    this.airTrickQueue = this.airTrickQueue.filter(x => this.time <= x.expires);
    if (this.lastDirectionTap && this.time - this.lastDirectionTap.time > TAP_WINDOW) this.lastDirectionTap = null;
  }

  resolve(input, context) {
    if (context.bailing) { this.cancelCombo(); return {}; }
    const events = {};
    const direction = directionKey(input.steer, input.drive);

    for (const tap of input.directionTaps || []) {
      if ((tap === 'up' || tap === 'down') && !context.grinding && context.speed > 0.55) {
        if (this.lastDirectionTap && this.time - this.lastDirectionTap.time <= TAP_WINDOW) {
          let manual = null;
          if (this.lastDirectionTap.dir === 'up' && tap === 'down') manual = 'manual';
          if (this.lastDirectionTap.dir === 'down' && tap === 'up') manual = 'noseManual';
          if (manual) {
            if (context.grounded) events.manual = manual;
            else this.pendingManual = { kind: manual, expires: this.time + LANDING_GRACE };
            // A completed sequence consumes both taps; a third tap cannot reuse one.
            this.lastDirectionTap = null;
            continue;
          }
        }
        this.lastDirectionTap = { dir: tap, time: this.time };
      }
    }

    if (context.grounded && !context.grinding && this.pendingManual && this.time <= this.pendingManual.expires) {
      events.manual = this.pendingManual.kind;
      this.pendingManual = null;
    }

    // A flip press can occur on the same render frame as an Ollie release.
    // The fixed-step takeoff happens after input resolution, so retain that press
    // briefly and consume it on the first airborne frame instead of dropping it.
    if (context.grounded && !context.grinding && !context.manual && input.flipPressed) {
      this.pendingAirFlip = {
        trick: { ...flipFor(direction) },
        expires: this.time + AIR_FLIP_GRACE,
      };
    }

    if (context.grounded && !context.grinding && !context.manual && input.grabPressed) {
      this.pendingAirGrab = { trick: { ...grabFor(direction) }, expires: this.time + AIR_FLIP_GRACE };
    }
    if (!input.grabHeld && !input.grabPressed) this.pendingAirGrab = null;

    if (context.grounded || context.grinding || context.wallRiding) this.clearAirQueue();
    if (!input.grabHeld && !input.grabPressed) {
      this.airTrickQueue = this.airTrickQueue.filter(x => x.kind !== 'grab');
    }

    if (!context.grounded && !context.grinding && !context.wallRiding) {
      const flip = input.flipPressed ? flipFor(direction) : this.pendingAirFlip?.trick;
      const grab = input.grabPressed ? grabFor(direction) : input.grabHeld && this.pendingAirGrab?.trick;
      this.pendingAirFlip = null;
      this.pendingAirGrab = null;
      if (flip) {
        const upgrade = input.flipPressed && context.flipState?.name === flip.name
          && context.flipState.progress < 0.62 && doubleFlipFor(flip.name);
        if (upgrade) events.flipUpgrade = { ...upgrade };
        else this.queueAirTrick('flip', flip);
      }
      if (grab && context.grabState?.name !== grab.name) this.queueAirTrick('grab', grab);

      // A held grab can be released by a new flip, but a rotating deck must finish
      // before another flip or a grab starts. Each button edge is consumed once.
      if (!context.flipState && !events.flipUpgrade) {
        while (this.airTrickQueue.length) {
          const next = this.airTrickQueue.shift();
          if (next.kind === 'grab' && next.trick.name === context.grabState?.name) continue;
          events[next.kind] = { ...next.trick };
          break;
        }
      }
      if (input.grindPressed) events.grind = { ...grindFor(direction, input.brake || input.vertExit) };
    }
    if (context.grinding || context.wallRiding) {
      this.pendingAirFlip = null;
      this.pendingAirGrab = null;
      if (context.grinding && input.grindPressed) {
        const next = grindFor(direction, input.brake || input.vertExit);
        if (next.name !== context.grindName) events.grindChange = { ...next };
      }
    }

    if (context.manual) {
      for (const [token, pressed] of [['flip', input.flipPressed], ['grab', input.grabPressed], ['grind', input.grindPressed]]) {
        if (!pressed) continue;
        this.buttonBuffer.push({ token, time: this.time });
        if (this.buttonBuffer.length >= 2) {
          const pair = this.buttonBuffer.slice(-2).map(x => x.token).join('+');
          const trick = FLATLAND_TRICKS[pair];
          if (trick) {
            if (trick.name !== context.flatland) events.flatland = { ...trick };
            this.buttonBuffer.length = 0;
          }
        }
      }
    } else this.buttonBuffer.length = 0;

    if (input.switchStancePressed) events.switchStance = true;
    return events;
  }

  clearAirQueue() { this.airTrickQueue.length = 0; }

  queueAirTrick(kind, trick) {
    if (this.airTrickQueue.length >= MAX_QUEUED_AIR_TRICKS) return;
    this.airTrickQueue.push({ kind, trick: { ...trick }, expires: this.time + AIR_QUEUE_WINDOW });
  }

  record(name, points = 0, { stance = 1 } = {}) {
    if (!name) return;
    if (!this.combo.length) this.comboStartedAt = this.time;
    const entry = { name, basePoints: Math.max(0, points), stance: stance < 0 ? -1 : 1, durationPoints: 0 };
    this.combo.push(entry);
    this.recalculateCombo();
    this.comboMultiplier += 1;
    this.lastLabel = name;
    this.settleTimer = 0;
    return entry;
  }

  upgrade(entry, name, points) {
    if (!entry || !this.combo.includes(entry)) return false;
    entry.name = name;
    entry.basePoints = points;
    this.recalculateCombo();
    this.lastLabel = name;
    // The extra rotation improves this trick; it is not a second multiplier.
    return true;
  }

  recalculateCombo() {
    const counts = new Map();
    let base = 0;
    let duration = 0;
    for (const entry of this.combo) {
      const key = `${entry.stance}:${entry.name}`;
      const repeated = counts.get(key) || 0;
      entry.repeatFactor = REPEAT_VALUES[Math.min(repeated, REPEAT_VALUES.length - 1)];
      entry.points = Math.round(entry.basePoints * entry.repeatFactor);
      base += entry.points;
      duration += entry.durationPoints * entry.repeatFactor;
      counts.set(key, repeated + 1);
    }
    const wholeDuration = Math.floor(duration + 1e-9);
    this.comboBase = base + wholeDuration;
    this.durationFraction = Math.max(0, duration - wholeDuration);
  }

  addDuration(points, entry = this.combo.at(-1)) {
    if (!entry || !this.combo.includes(entry) || !Number.isFinite(points) || points <= 0) return 0;
    entry.durationPoints += points;
    this.durationFraction += points * entry.repeatFactor;
    const whole = Math.floor(this.durationFraction + 1e-9);
    if (whole > 0) {
      this.durationFraction -= whole;
      this.comboBase += whole;
    }
    return whole;
  }

  settle() {
    if (!this.combo.length) return null;
    this.comboBase += Math.round(this.durationFraction);
    this.durationFraction = 0;
    const multiplier = Math.max(1, this.comboMultiplier);
    const points = this.comboBase * multiplier;
    const names = this.combo.slice(-4).map(t => t.name).join(' + ');
    this.combo = [];
    this.comboBase = 0;
    this.comboMultiplier = 0;
    this.comboStartedAt = this.time;
    this.settleTimer = 0;
    return { points, multiplier, names };
  }

  comboText() {
    if (!this.combo.length) return '';
    return `${this.combo.at(-1).name} · ${this.comboBase} × ${Math.max(1, this.comboMultiplier)}`;
  }

  comboDuration() { return this.combo.length ? Math.max(0, this.time - this.comboStartedAt) : 0; }
  manualBridgePending() {
    if (this.pendingManual && this.time <= this.pendingManual.expires) return true;
    return Boolean(this.lastDirectionTap && (this.lastDirectionTap.dir === 'up' || this.lastDirectionTap.dir === 'down') && this.time - this.lastDirectionTap.time <= TAP_WINDOW);
  }
  manualInfo(kind) { return MANUALS[kind] || null; }
}
