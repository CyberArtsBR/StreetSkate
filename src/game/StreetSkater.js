import * as THREE from 'three';
import { StatefulSkillStreetPhysics } from './StatefulSkillStreetPhysics.js';
import { UnrealRider } from '../character/UnrealRider.js';
import { StreetBoard } from '../skateboard/StreetBoard.js';
import { ensureBalanceHud } from './BalanceHud.js';
import { captureGameplayState } from './core/GameplayStateSnapshot.js';
import { flipPhaseFor, physicsMovementState, resolvePresentationState } from '../character/PresentationState.js';
import { yawStableSurfaceBasis } from './core/PresentationOrientation.js';

const clamp = THREE.MathUtils.clamp;

export class StreetSkater extends StatefulSkillStreetPhysics {
  constructor(options) {
    super(options);
    this.root = new THREE.Group();
    this.root.name = 'TheanchoURi-skater';
    this.visual = new THREE.Group();
    this.root.add(this.visual);
    this.presentationNormal = new THREE.Vector3(0, 1, 0);
    this._forwardVisual = new THREE.Vector3();
    this._backVisual = new THREE.Vector3();
    this._rightVisual = new THREE.Vector3();
    this._presentationUp = new THREE.Vector3(0, 1, 0);
    this._basis = new THREE.Matrix4();
    this._wallPoseQ = new THREE.Quaternion();
    this._wallPoseAxisX = new THREE.Vector3(1, 0, 0);
    this._wallPoseAxisZ = new THREE.Vector3(0, 0, 1);
    this.debugEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
    this.debugElement = null;
    if (this.debugEnabled && typeof document !== 'undefined') this.initDebugViewer();
    this.presentation = {
      state: 'IDLE', previousState: 'IDLE', stateTime: 0, physicsState: 'IDLE',
      pushClock: 0, pushPhase: 0, pushWeight: 0, popTime: 0, landingTime: 0,
      landingSeverity: 0, flipPhase: null, activeTrick: '', pumpState: 'OFF', vertState: 'OFF',
    };
  }

  initDebugViewer() {
    const panel = document.createElement('pre');
    panel.id = 'animation-debug';
    panel.setAttribute('aria-label', 'Animation debug viewer');
    Object.assign(panel.style, {
      position: 'fixed', top: '72px', right: '16px', zIndex: '9999', margin: '0', padding: '12px 14px',
      maxWidth: '480px', whiteSpace: 'pre-wrap', pointerEvents: 'none', border: '1px solid rgba(255,255,255,.22)',
      borderRadius: '8px', background: 'rgba(7,12,14,.86)', color: '#d9ff64', font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
      boxShadow: '0 10px 40px rgba(0,0,0,.28)',
    });
    document.body.appendChild(panel);
    this.debugElement = panel;
  }

  updateDebugViewer() {
    if (!this.debugElement) return;
    const d = this.getPresentationDebug();
    const s = captureGameplayState(this);
    const rig = d.rig ? `${d.rig.boneCount} bones${d.rig.missing?.length ? ` / missing: ${d.rig.missing.join(', ')}` : ' / semantic rig OK'}` : 'loading';
    const vec = value => value ? value.map(n => n == null ? '—' : n.toFixed(3)).join(', ') : '—';
    this.debugElement.textContent = [
      `PHYSICS      ${d.physicsState}`,
      `MODE         ${s.movementState}`,
      `PRESENTATION ${d.presentationState}`,
      `TRICK        ${d.activeTrick}`,
      `FLIP PHASE   ${d.flipPhase}`,
      `GRAB         ${d.grab}`,
      `GRIND        ${d.grindType}`,
      `MANUAL       ${d.manual}`,
      `HEADING      ${s.heading ?? '—'}`,
      `AIR HEADING  ${s.airHeading ?? '—'}`,
      `AIR SPIN     ${s.airSpin ?? '—'}`,
      `VELOCITY     ${vec(s.velocity)}`,
      `TRAVEL       ${vec(s.travelDirection)}`,
      `NORMAL       ${vec(s.normal)}`,
      `FAKIE        ${s.fakie ?? '—'}`,
      `ROLL SIGN    ${s.rollingSign ?? '—'}`,
      `TRANSITION   ${s.transitionId || (s.transitionActive ? 'ACTIVE' : '—')}`,
      `WHEELS       ${s.wheelSupport ? `${s.wheelSupport.count} / F${s.wheelSupport.frontSupported} R${s.wheelSupport.rearSupported}` : '—'}`,
      `GRIND BAL    ${d.grindBalance.toFixed(3)}`,
      `MANUAL BAL   ${d.manualBalance.toFixed(3)}`,
      `STANCE       ${d.stance}`,
      `PUMP         ${d.pumpState}`,
      `VERT         ${d.vertState}`,
      `RIG          ${rig}`,
    ].join('\n');
  }

  async load() {
    [this.board, this.rider] = await Promise.all([
      new StreetBoard('/assets/rider/skateboard.glb').load(),
      new UnrealRider('/assets/rider/TheanchoURi.glb').load(),
    ]);
    this.visual.add(this.board.root, this.rider.root);
    this.rider.deckHeight = this.board.deckHeight;
    this.setBoardContactRig(this.board.contactRig);
    this.balanceHud = ensureBalanceHud();
    this.update(0, {}, 0);
    return this;
  }

  updatePresentation(delta, input, before) {
    const p = this.presentation;
    const grounded = this.grounded;
    const speed = Math.abs(this.speed);
    const speedRatio = Math.min(speed / this.config.maxSpeed, 1);
    const justTookOff = before.grounded && !grounded && !this.grind && !this.wallRide;
    if (justTookOff) p.popTime = 0.18;
    else p.popTime = Math.max(0, p.popTime - delta);

    if (this.justLanded) {
      const downward = Math.max(0, -before.velocityY);
      const airFactor = clamp(before.airTime / 1.35, 0, 1);
      const slopeFactor = clamp(1 - this.normal.y, 0, 0.75);
      p.landingSeverity = clamp(downward / 11 + airFactor * 0.35 + slopeFactor * 0.2, 0.12, 1);
      p.landingTime = 0.28;
    } else p.landingTime = Math.max(0, p.landingTime - delta);

    const braking = grounded && speed > 0.35 && (Boolean(input.brake) || (!this.manual && (input.drive || 0) < -0.12));
    const pushDemand = grounded && !this.manual && !this.grind && !this.wallRide && !braking
      && (input.drive || 0) > 0.16 && speed < this.config.maxSpeed * 0.985;
    if (pushDemand) {
      const frequency = 1.25 + speedRatio * 1.65 + clamp((input.drive || 0), 0, 1) * 0.35;
      p.pushClock += delta * frequency;
      p.pushPhase = p.pushClock % 1;
      p.pushWeight = p.pushPhase < 0.78 ? Math.sin((p.pushPhase / 0.78) * Math.PI) : 0;
    } else {
      p.pushPhase = 0;
      p.pushWeight = 0;
    }

    const pumpSource = this.pumpState ?? this.pump ?? this.pumping ?? null;
    const pumpActive = Boolean(pumpSource && pumpSource !== 'OFF' && pumpSource !== 'idle');
    p.pumpState = typeof pumpSource === 'string' ? pumpSource : pumpActive ? 'ACTIVE' : 'OFF';
    const vert = Boolean(this.transitionAir && !this.grounded);
    p.vertState = vert ? (this.velocity.y > 0.45 ? 'ASCENDING' : this.velocity.y < -0.45 ? 'DESCENDING' : 'APEX') : 'OFF';
    p.flipPhase = flipPhaseFor(this.flipState);
    p.activeTrick = this.flipState?.name || this.grabState?.name || this.grind?.trick?.name || this.flatland || '';

    const context = {
      grounded, speed, charge: this.charge, braking, pushDemand,
      popActive: p.popTime > 0, landingActive: p.landingTime > 0, pumpActive, vert,
      manual: this.manual, grind: this.grind, wallRide: this.wallRide, flatland: this.flatland, bail: this.bailTime > 0,
    };
    p.physicsState = physicsMovementState(context);
    const next = resolvePresentationState(context);
    if (next !== p.state) { p.previousState = p.state; p.state = next; p.stateTime = 0; }
    else p.stateTime += delta;
    return { speedRatio, vert };
  }

  wallImpactPoseWeight() {
    const duration = Math.max(0.001, Number(this.wallImpactDuration) || 0.52);
    const remaining = clamp((Number(this.wallImpactTime) || 0) / duration, 0, 1);
    if (remaining <= 0) return 0;
    const phase = 1 - remaining;
    return Math.pow(Math.sin(Math.PI * clamp(phase, 0, 1)), 0.72);
  }

  applyWallImpactPose(weight) {
    if (!this.rider || weight <= 0.001) return;
    const rootQ = this.rider.root.getWorldQuaternion(this._wallPoseQ);
    const side = Math.sign(this.wallImpactSide || 1);

    // Hands-up impact reaction: shoulders rise quickly, elbows open and the torso
    // recoils slightly. This is presentation only; gameplay trajectory is already
    // resolved by the wall-recovery physics layer.
    this.rider.rotate('upperarm_l', this._wallPoseAxisZ, -1.18 * weight, rootQ);
    this.rider.rotate('upperarm_r', this._wallPoseAxisZ, 1.18 * weight, rootQ);
    this.rider.rotate('lowerarm_l', this._wallPoseAxisZ, -0.34 * weight, rootQ);
    this.rider.rotate('lowerarm_r', this._wallPoseAxisZ, 0.34 * weight, rootQ);
    this.rider.rotate('upperarm_l', this._wallPoseAxisX, -0.18 * weight, rootQ);
    this.rider.rotate('upperarm_r', this._wallPoseAxisX, -0.18 * weight, rootQ);
    this.rider.rotate('spine_02', this._wallPoseAxisX, 0.13 * weight, rootQ);
    this.rider.rotate('spine_03', this._wallPoseAxisZ, side * 0.08 * weight, rootQ);
    this.rider.root.updateWorldMatrix(true, true);
  }

  update(delta, input, elapsed) {
    const before = { grounded: this.grounded, velocityY: this.velocity.y, airTime: this.airTime };
    this.advance(delta, input);
    const present = this.updatePresentation(delta, input, before);

    this.root.position.copy(this.position);
    const surfaceUp = this.bodyUp();
    this.presentationNormal.lerp(surfaceUp, 1 - Math.exp(-18 * Math.max(delta, 1 / 120))).normalize();
    yawStableSurfaceBasis(
      this.heading,
      this.presentationNormal,
      this._rightVisual,
      this._backVisual,
      this._presentationUp,
    );
    this._forwardVisual.copy(this._backVisual).negate();
    this.visual.quaternion.setFromRotationMatrix(
      this._basis.makeBasis(this._rightVisual, this._presentationUp, this._backVisual),
    );

    const grabActive = Boolean(this.grabState && input.grabHeld);
    const manualBalance = Number.isFinite(this.manualBalance) ? this.manualBalance : 0;
    const grindBalance = Number.isFinite(this.grind?.balance) ? this.grind.balance : Number.isFinite(this.grindBalance) ? this.grindBalance : 0;
    const bailProgress = this.bailTime > 0 ? clamp(1 - this.bailTime / 0.9, 0, 1) : 0;
    const common = {
      presentation: this.presentation,
      flipState: this.flipState,
      flipPhase: this.presentation.flipPhase,
      grabState: grabActive ? this.grabState : null,
      manual: this.manual,
      manualBalance,
      grind: this.grind,
      grindType: this.grind?.trick?.name || null,
      grindBalance,
      wallRide: this.wallRide,
      vert: present.vert,
      verticalVelocity: this.velocity.y,
      bail: this.bailTime > 0,
      bailProgress,
      stance: this.stance,
      flatland: this.flatland,
      time: elapsed,
      dt: delta,
    };
    this.board?.update({ ...common, airborne: !this.grounded && !this.grind });
    this.rider?.update({
      ...common,
      board: this.board,
      speedRatio: present.speedRatio,
      crouch: this.charge,
      steer: this.steer,
      pushWeight: this.presentation.pushWeight,
      pushPhase: this.presentation.pushPhase,
      landingSeverity: this.presentation.landingSeverity * clamp(this.presentation.landingTime / 0.28, 0, 1),
      pumpState: this.presentation.pumpState,
    });
    this.applyWallImpactPose(this.wallImpactPoseWeight());
    this.balanceHud?.update(this.balanceMode(), this.balanceValue());
    this.updateDebugViewer();
    return { speedRatio: present.speedRatio };
  }

  getPresentationDebug() {
    return {
      physicsState: this.presentation.physicsState,
      presentationState: this.presentation.state,
      activeTrick: this.presentation.activeTrick || '—',
      flipPhase: this.presentation.flipPhase || '—',
      grab: this.grabState?.name || '—',
      grindType: this.grind?.trick?.name || '—',
      manual: this.manual || '—',
      grindBalance: Number.isFinite(this.grind?.balance) ? this.grind.balance : Number(this.grindBalance) || 0,
      manualBalance: Number(this.manualBalance) || 0,
      stance: this.stance < 0 ? 'SWITCH' : 'REGULAR',
      pumpState: this.presentation.pumpState,
      vertState: this.presentation.vertState,
      rig: this.rider?.rigAudit || null,
    };
  }
}
