const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
export class SkateInput {
  constructor() {
    this.keys = new Set(); this.pressed = new Set(); this.released = new Set();
    this.enabled = false; this.padPrevious = {};
    this._down = e => {
      if (!this.enabled || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    };
    this._up = e => {
      if (this.enabled && PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      if (this.keys.has(e.code)) this.released.add(e.code);
      this.keys.delete(e.code);
    };
    this._blur = () => this.clear();
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    window.addEventListener('blur', this._blur);
  }

  clear() {
    this.keys.clear(); this.pressed.clear(); this.released.clear();
    this.padPrevious = {};
  }

  read() {
    const pad = [...(navigator.getGamepads?.() || [])].find(p => p?.connected);
    const axis = v => Math.abs(v || 0) < 0.16 ? 0 : Math.sign(v) * (Math.abs(v) - 0.16) / 0.84;
    const held = (...codes) => codes.some(code => this.keys.has(code));
    const buttons = { ollie: !!pad?.buttons[0]?.pressed, flip: !!pad?.buttons[2]?.pressed, reset: !!pad?.buttons[9]?.pressed };
    const steer = Number(held('KeyD', 'ArrowRight')) - Number(held('KeyA', 'ArrowLeft'));
    const drive = Number(held('KeyW', 'ArrowUp')) - Number(held('KeyS', 'ArrowDown'));
    const state = {
      steer: steer || axis(pad?.axes[0]), drive: drive || -axis(pad?.axes[1]),
      brake: held('ShiftLeft', 'ShiftRight') || !!pad?.buttons[1]?.pressed,
      ollieHeld: held('Space') || buttons.ollie,
      ollieReleased: this.released.has('Space') || (!buttons.ollie && this.padPrevious.ollie && !!pad),
      flip: this.pressed.has('KeyQ') || (buttons.flip && !this.padPrevious.flip),
      grab: held('KeyE') || !!pad?.buttons[3]?.pressed,
      reset: this.pressed.has('KeyR') || (buttons.reset && !this.padPrevious.reset),
    };
    this.padPrevious = buttons;
    this.pressed.clear(); this.released.clear();
    return state;
  }

  dispose() {
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
    window.removeEventListener('blur', this._blur);
  }
}
