import { DirectionTapDetector } from './DirectionTapDetector.js';

const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class SkateInput {
  constructor(element = window) {
    this.element = element;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.enabled = false;
    this.padPrevious = {};
    this.analogTaps = new DirectionTapDetector({ activation: 0.65, neutral: 0.30 });
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.pointerLook = false;

    this._down = e => {
      if (!this.enabled || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName) || e.target?.isContentEditable) return;
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      if (e.ctrlKey && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    };
    this._up = e => {
      if (this.enabled && PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      if (this.keys.has(e.code)) this.released.add(e.code);
      this.keys.delete(e.code);
    };
    this._blur = () => this.clear();
    this._pointerDown = e => {
      if (!this.enabled || e.button !== 0) return;
      this.pointerLook = true;
      this.element?.setPointerCapture?.(e.pointerId);
    };
    this._pointerUp = e => {
      if (e.type !== 'pointercancel' && e.button !== 0) return;
      this.pointerLook = false;
      if (this.element?.hasPointerCapture?.(e.pointerId)) this.element.releasePointerCapture(e.pointerId);
    };
    this._pointerMove = e => {
      if (!this.enabled || !this.pointerLook) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };

    window.addEventListener('keydown', this._down, { passive: false });
    window.addEventListener('keyup', this._up, { passive: false });
    window.addEventListener('blur', this._blur);
    this.element?.addEventListener?.('pointerdown', this._pointerDown);
    this.element?.addEventListener?.('pointerup', this._pointerUp);
    this.element?.addEventListener?.('pointercancel', this._pointerUp);
    this.element?.addEventListener?.('pointermove', this._pointerMove);
  }

  clear() {
    this.keys.clear(); this.pressed.clear(); this.released.clear();
    // Keep physical button edges: clearing on pause must not retrigger held Start.
    this.analogTaps.reset();
    this.mouseDX = 0; this.mouseDY = 0; this.pointerLook = false;
  }

  read() {
    const pad = [...(navigator.getGamepads?.() || [])].find(p => p?.connected);
    const axis = v => Math.abs(v || 0) < 0.16 ? 0 : Math.sign(v) * (Math.abs(v) - 0.16) / 0.84;
    const held = (...codes) => codes.some(code => this.keys.has(code));
    const just = (...codes) => codes.some(code => this.pressed.has(code));

    const buttons = {
      ollie: !!pad?.buttons[0]?.pressed,
      grab: !!pad?.buttons[1]?.pressed,
      flip: !!pad?.buttons[2]?.pressed,
      grind: !!pad?.buttons[3]?.pressed,
      spinLeft: !!pad?.buttons[4]?.pressed,
      spinRight: !!pad?.buttons[5]?.pressed,
      vertExit: !!pad?.buttons[6]?.pressed,
      switchStance: !!pad?.buttons[7]?.pressed,
      pause: !!pad?.buttons[9]?.pressed,
      cameraMode: !!pad?.buttons[11]?.pressed,
      dpadUp: !!pad?.buttons[12]?.pressed,
      dpadDown: !!pad?.buttons[13]?.pressed,
      dpadLeft: !!pad?.buttons[14]?.pressed,
      dpadRight: !!pad?.buttons[15]?.pressed,
    };
    const edge = key => buttons[key] && !this.padPrevious[key];
    const release = key => !buttons[key] && this.padPrevious[key] && !!pad;

    const keyboardSteer = Number(held('KeyD')) - Number(held('KeyA'));
    const dpadSteer = Number(buttons.dpadRight) - Number(buttons.dpadLeft);
    const keyboardDrive = Number(held('KeyW')) - Number(held('KeyS'));
    const dpadDrive = Number(buttons.dpadUp) - Number(buttons.dpadDown);
    const rawStickX = pad?.axes?.[0] || 0;
    const rawStickY = -(pad?.axes?.[1] || 0);
    const steer = keyboardSteer || dpadSteer || axis(rawStickX);
    const drive = keyboardDrive || dpadDrive || axis(rawStickY);

    const directionTaps = new Set(this.analogTaps.update(rawStickX, rawStickY));
    if (just('KeyW') || edge('dpadUp')) directionTaps.add('up');
    if (just('KeyS') || edge('dpadDown')) directionTaps.add('down');
    if (just('KeyA') || edge('dpadLeft')) directionTaps.add('left');
    if (just('KeyD') || edge('dpadRight')) directionTaps.add('right');

    const state = {
      steer,
      drive,
      directionTaps: [...directionTaps],
      brake: held('ShiftLeft', 'ShiftRight'),
      ollieHeld: held('Space') || buttons.ollie,
      olliePressed: (just('Space') && !this.padPrevious.ollie) || (edge('ollie') && !held('Space')),
      ollieReleased: !held('Space') && !buttons.ollie && (this.released.has('Space') || release('ollie')),
      flipPressed: just('ArrowLeft') || edge('flip'),
      grabPressed: just('ArrowRight') || edge('grab'),
      grabHeld: held('ArrowRight') || buttons.grab,
      grindPressed: just('ArrowUp') || edge('grind'),
      grindHeld: held('ArrowUp') || buttons.grind,
      spin: (Number(held('KeyE')) + Number(buttons.spinRight)) - (Number(held('KeyQ')) + Number(buttons.spinLeft)),
      vertExit: held('ControlLeft') || buttons.vertExit,
      switchStancePressed: just('ControlRight') || edge('switchStance'),
      pausePressed: just('Escape') || edge('pause'),
      cameraModePressed: (just('KeyC') && !held('ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight')) || edge('cameraMode'),
      reset: just('KeyR'),
      cameraX: axis(pad?.axes[2]),
      cameraY: axis(pad?.axes[3]),
      mouseDX: this.mouseDX,
      mouseDY: this.mouseDY,
      cameraActive: this.pointerLook || Math.abs(axis(pad?.axes[2])) > 0 || Math.abs(axis(pad?.axes[3])) > 0,
    };

    this.padPrevious = buttons;
    this.mouseDX = 0; this.mouseDY = 0;
    this.pressed.clear(); this.released.clear();
    return state;
  }

  dispose() {
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
    window.removeEventListener('blur', this._blur);
    this.element?.removeEventListener?.('pointerdown', this._pointerDown);
    this.element?.removeEventListener?.('pointerup', this._pointerUp);
    this.element?.removeEventListener?.('pointercancel', this._pointerUp);
    this.element?.removeEventListener?.('pointermove', this._pointerMove);
  }
}
