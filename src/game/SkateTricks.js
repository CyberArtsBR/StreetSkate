import { directionKey, flipFor, grabFor, grindFor, FLATLAND_TRICKS, MANUALS } from './TrickCatalog.js';

const TAP_WINDOW = 0.42;
const COMBO_WINDOW = 0.38;

export class SkateTricks {
  constructor() { this.reset(); }

  reset() {
    this.time = 0;
    this.lastDirectionTap = null;
    this.buttonBuffer = [];
    this.combo = [];
    this.comboBase = 0;
    this.comboMultiplier = 0;
    this.settleTimer = 0;
    this.lastLabel = '';
  }

  tick(dt) {
    this.time += dt;
    this.buttonBuffer = this.buttonBuffer.filter(x => this.time - x.time <= COMBO_WINDOW);
  }

  resolve(input, context) {
    const events = {};
    const direction = directionKey(input.steer, input.drive);

    for (const tap of input.directionTaps || []) {
      if (context.grounded && !context.grinding && context.speed > 0.8 && this.lastDirectionTap && this.time - this.lastDirectionTap.time <= TAP_WINDOW) {
        if (this.lastDirectionTap.dir === 'up' && tap === 'down') events.manual = 'manual';
        if (this.lastDirectionTap.dir === 'down' && tap === 'up') events.manual = 'noseManual';
      }
      this.lastDirectionTap = { dir: tap, time: this.time };
    }

    if (!context.grounded && !context.grinding && input.flipPressed) events.flip = { ...flipFor(direction) };
    if (!context.grounded && !context.grinding && input.grabPressed) events.grab = { ...grabFor(direction) };
    if (!context.grounded && !context.grinding && input.grindPressed) events.grind = { ...grindFor(direction) };
    if (context.grinding && input.grindPressed) events.grindChange = { ...grindFor(direction) };

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
    const previousSame = this.combo.at(-1)?.name === name;
    const awarded = Math.round(points * (previousSame ? 0.55 : 1));
    this.combo.push({ name, points: awarded });
    this.comboBase += awarded;
    this.comboMultiplier += 1;
    this.lastLabel = name;
    this.settleTimer = 0;
  }

  settle() {
    if (!this.combo.length) return null;
    const multiplier = Math.max(1, this.comboMultiplier);
    const points = this.comboBase * multiplier;
    const names = this.combo.slice(-4).map(t => t.name).join(' + ');
    this.combo = [];
    this.comboBase = 0;
    this.comboMultiplier = 0;
    this.settleTimer = 0;
    return { points, multiplier, names };
  }

  comboText() {
    if (!this.combo.length) return '';
    return `${this.combo.at(-1).name} · ${this.comboBase} × ${Math.max(1, this.comboMultiplier)}`;
  }

  manualInfo(kind) { return MANUALS[kind] || null; }
}
