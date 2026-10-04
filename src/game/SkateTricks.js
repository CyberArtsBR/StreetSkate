import { directionKey, flipFor, grabFor, grindFor, FLATLAND_TRICKS, MANUALS } from './TrickCatalog.js';

const TAP_WINDOW = 0.46;
const COMBO_WINDOW = 0.38;
const LANDING_GRACE = 0.24;

export class SkateTricks {
  constructor() { this.reset(); }

  reset() {
    this.time = 0;
    this.lastDirectionTap = null;
    this.pendingManual = null;
    this.buttonBuffer = [];
    this.combo = [];
    this.comboBase = 0;
    this.comboMultiplier = 0;
    this.durationFraction = 0;
    this.comboStartedAt = 0;
    this.settleTimer = 0;
    this.lastLabel = '';
  }

  tick(dt) {
    this.time += dt;
    this.buttonBuffer = this.buttonBuffer.filter(x => this.time - x.time <= COMBO_WINDOW);
    if (this.pendingManual && this.time > this.pendingManual.expires) this.pendingManual = null;
    if (this.lastDirectionTap && this.time - this.lastDirectionTap.time > TAP_WINDOW) this.lastDirectionTap = null;
  }

  resolve(input, context) {
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
          }
        }
        this.lastDirectionTap = { dir: tap, time: this.time };
      }
    }

    if (context.grounded && !context.grinding && this.pendingManual && this.time <= this.pendingManual.expires) {
      events.manual = this.pendingManual.kind;
      this.pendingManual = null;
    }

    if (!context.grounded && !context.grinding && input.flipPressed) events.flip = { ...flipFor(direction) };
    if (!context.grounded && !context.grinding && input.grabPressed) events.grab = { ...grabFor(direction) };
    if (!context.grounded && !context.grinding && input.grindPressed) events.grind = { ...grindFor(direction, input.brake || input.vertExit) };
    if (context.grinding && input.grindPressed) events.grindChange = { ...grindFor(direction, input.brake || input.vertExit) };

    if (context.manual) {
      for (const [token, pressed] of [['flip', input.flipPressed], ['grab', input.grabPressed], ['grind', input.grindPressed]]) {
        if (!pressed) continue;
        this.buttonBuffer.push({ token, time: this.time });
        if (this.buttonBuffer.length >= 2) {
          const pair = this.buttonBuffer.slice(-2).map(x => x.token).join('+');
          const trick = FLATLAND_TRICKS[pair];
          if (trick) {
            events.flatland = { ...trick };
            this.buttonBuffer.length = 0;
          }
        }
      }
    } else this.buttonBuffer.length = 0;

    if (input.switchStancePressed) events.switchStance = true;
    return events;
  }

  record(name, points = 0) {
    if (!name) return;
    if (!this.combo.length) this.comboStartedAt = this.time;
    const previousSame = this.combo.at(-1)?.name === name;
    const awarded = Math.round(points * (previousSame ? 0.55 : 1));
    this.combo.push({ name, points: awarded });
    this.comboBase += awarded;
    this.comboMultiplier += 1;
    this.lastLabel = name;
    this.settleTimer = 0;
  }

  addDuration(points) {
    if (!this.combo.length || points <= 0) return 0;
    this.durationFraction += points;
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
