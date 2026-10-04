const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class SkateInput {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.enabled = false;
    this._onDown = (event) => {
      if (!this.enabled) return;
      if (PREVENT_DEFAULT.has(event.code)) event.preventDefault();
      if (!event.repeat) this.pressed.add(event.code);
      this.keys.add(event.code);
    };
    this._onUp = (event) => {
      if (!this.enabled) return;
      if (PREVENT_DEFAULT.has(event.code)) event.preventDefault();
      this.keys.delete(event.code);
      this.released.add(event.code);
    };
    window.addEventListener('keydown', this._onDown, { passive: false });
    window.addEventListener('keyup', this._onUp, { passive: false });
  }

  value(positive, negative) {
    return (this.keys.has(positive) ? 1 : 0) - (this.keys.has(negative) ? 1 : 0);
  }

  read() {
    const pads = navigator.getGamepads?.() || [];
    const pad = [...pads].find(Boolean);
    const deadzone = (value) => Math.abs(value) < 0.14 ? 0 : value;
    const keyboardSteer = this.value('KeyD', 'KeyA') || this.value('ArrowRight', 'ArrowLeft');
    const keyboardDrive = this.value('KeyW', 'KeyS') || this.value('ArrowUp', 'ArrowDown');
    return {
      steer: pad ? deadzone(pad.axes[0] || 0) : keyboardSteer,
      drive: pad ? -deadzone(pad.axes[1] || 0) : keyboardDrive,
      brake: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || Boolean(pad?.buttons[1]?.pressed),
      ollieHeld: this.keys.has('Space') || Boolean(pad?.buttons[0]?.pressed),
      olliePressed: this.pressed.has('Space') || Boolean(pad?.buttons[0]?.pressed && !this._padOllie),
      ollieReleased: this.released.has('Space') || Boolean(!pad?.buttons[0]?.pressed && this._padOllie),
      flip: this.pressed.has('KeyQ') || Boolean(pad?.buttons[2]?.pressed && !this._padFlip),
      grab: this.keys.has('KeyE') || Boolean(pad?.buttons[3]?.pressed),
      reset: this.pressed.has('KeyR') || Boolean((pad?.buttons[9]?.pressed || pad?.buttons[8]?.pressed) && !this._padReset),
      pad,
    };
  }

  endFrame(state) {
    this._padOllie = Boolean(state.pad?.buttons[0]?.pressed);
    this._padFlip = Boolean(state.pad?.buttons[2]?.pressed);
    this._padReset = Boolean(state.pad?.buttons[9]?.pressed || state.pad?.buttons[8]?.pressed);
    this.pressed.clear();
    this.released.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
  }
}
