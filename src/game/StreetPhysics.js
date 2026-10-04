import * as THREE from 'three';
import { ParkCollision } from './ParkCollision.js';
import { TransitionGuide } from './TransitionGuide.js';
import { RailNetwork } from './RailNetwork.js';
import { SkateTricks } from './SkateTricks.js';

export const PHYSICS = Object.freeze({
  step: 1 / 120, push: 6.8, maxSpeed: 11.5, gravity: 20, brake: 13,
  minJump: 4.5, maxJump: 7.6, chargeTime: 0.6, coyoteTime: 0.09, jumpBuffer: 0.12,
});
const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = new THREE.Vector3(0, -PHYSICS.gravity, 0);
const clamp = THREE.MathUtils.clamp;

function headingFrom(direction, fallback = 0) {
  const flat = direction.clone(); flat.y = 0;
  if (flat.lengthSq() < 1e-8) return fallback;
  flat.normalize();
  return Math.atan2(-flat.x, -flat.z);
}

/** Metres, seconds, Y up, local -Z travel. Presentation never changes trajectory. */
export class StreetPhysics {
  constructor({ collision, spawn, rails = [] }) {
    this.surface = new ParkCollision(collision);
    this.transitions = new TransitionGuide(rails);
    this.railNetwork = new RailNetwork(rails);
    this.tricks = new SkateTricks();
    this.spawn = new THREE.Vector3(...spawn);
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.normal = UP.clone();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.config = PHYSICS;
    this.reset();
  }

  reset(position = this.spawn, heading = 0) {
    this.position.copy(position);
    const support = this.surface.ground(this.position, 5, 10);
    if (support) this.position.copy(support.point).addScaledVector(UP, 0.015);
    this.normal.copy(support?.normal || UP);
    this.velocity.set(0, 0, 0);
    this.heading = heading;
    this.airHeading = heading;
    this.grounded = Boolean(support);
    this.speed = 0; this.charge = 0; this.airSpin = 0;
    this.flipState = null; this.grabState = null; this.manual = null; this.flatland = null;
    this.grind = null; this.wallRide = null; this.stance = 1;
    this.airTime = 0; this.accumulator = 0; this.coyote = 0; this.jumpBuffer = 0; this.jumpCharge = 0;
    this.distance = 0; this.justLanded = false; this.steer = 0; this.bailTime = 0;
    this.score = 0; this.feedback = ''; this.feedbackTime = 0; this.stableGroundTime = 0;
    this.transitionAir = null; this.pendingGrindTrick = null;
    this.vertJumpPending = 0; this.vertJumpTimer = 0;
    this.tricks.reset();
    this.groundDirection();
  }

  groundDirection() {
    this.forward.set(-Math.sin(this.heading), 0, -Math.cos(this.heading)).projectOnPlane(this.normal).normalize();
  }

  airDirection() {
    this.forward.set(-Math.sin(this.heading), 0, -Math.cos(this.heading)).normalize();
  }

  releaseJump() {
    this.jumpBuffer = PHYSICS.jumpBuffer;
    this.jumpCharge = Math.max(this.charge, 0.05);
    this.charge = 0;
  }

  takeoff(impulse = 0, transition = null) {
    const onSurface = this.grounded;
    this.grounded = false;
    this.manual = null;
    this.flatland = null;
    this.velocity.y += impulse;
    if (onSurface) {
      const edge = transition || this.transitions.launchAt(this.position, this.normal, this.velocity);
      this.transitionAir = edge ? this.transitions.begin(this.position, this.velocity, edge) : null;
    }
    this.airSpin = 0; this.airTime = 0; this.grabState = null;
    this.jumpBuffer = 0; this.coyote = impulse || this.transitionAir ? 0 : PHYSICS.coyoteTime;
    this.airHeading = this.heading;
    this.stableGroundTime = 0;
    this.vertJumpPending = 0; this.vertJumpTimer = 0;
    if (impulse > 0.1) this.recordTrick('Ollie', 50);
  }

  recordTrick(name, points) {
    this.tricks.record(name, points);
    this.feedback = this.tricks.comboText();
    this.feedbackTime = 2.2;
  }

  settleCombo() {
    const result = this.tricks.settle();
    if (!result) return;
    this.score += result.points;
    this.feedback = `${result.names} · ${result.multiplier}X · +${result.points}`;
    this.feedbackTime = 2.6;
  }

  handleEvents(events) {
    if (events.switchStance) {
      this.stance *= -1;
      this.recordTrick(this.stance < 0 ? 'Switch Stance' : 'Regular Stance', 50);
    }
    if (events.manual && this.grounded && !this.grind && !this.bailTime) {
      this.manual = events.manual;
      this.flatland = null;
      const info = this.tricks.manualInfo(events.manual);
      this.recordTrick(info?.name || 'Manual', info?.points || 100);
      this.stableGroundTime = 0;
    }
    if (events.flatland && this.manual) {
      this.flatland = events.flatland.name;
      this.recordTrick(events.flatland.name, events.flatland.points);
    }
    if (events.flip && !this.grounded && !this.grind && !this.wallRide) {
      if (this.flipState && this.flipState.name === 'Kickflip' && this.flipState.progress < 0.62) {
        this.flipState.name = 'Double Kickflip';
        this.flipState.roll = 2;
        this.flipState.duration = 0.66;
        this.recordTrick('Double Kickflip', 250);
      } else if (!this.flipState) {
        this.flipState = { ...events.flip, progress: 0 };
        this.recordTrick(events.flip.name, events.flip.points);
      }
    }
    if (events.grab && !this.grounded && !this.grind && !this.wallRide) {
      this.grabState = { ...events.grab };
      this.recordTrick(events.grab.name, events.grab.points);
    }
    if (events.grind && !this.grounded && !this.grind) this.pendingGrindTrick = events.grind;
    if (events.grindChange && this.grind) {
      this.grind.trick = events.grindChange;
      this.recordTrick(events.grindChange.name, events.grindChange.points);
    }
  }

  advance(delta, input = {}) {
    if (input.reset) { this.reset(); return; }
    this.tricks.tick(delta);
    const context = {
      grounded: this.grounded, grinding: Boolean(this.grind), manual: this.manual,
      speed: Math.abs(this.speed), airborne: !this.grounded,
    };
    this.handleEvents(this.tricks.resolve(input, context));

    if (input.ollieReleased) {
      if (this.grind) this.exitGrind(true);
      else this.releaseJump();
    }
    if (!input.grabHeld && this.grabState) this.grabState = null;

    this.justLanded = false;
    this.accumulator += clamp(delta, 0, 0.2);
    let firstStep = true;
    while (this.accumulator + 1e-9 >= PHYSICS.step) {
      this.step(PHYSICS.step, {
        ...input,
        olliePressed: firstStep && input.olliePressed,
        grindPressed: firstStep && input.grindPressed,
      });
      firstStep = false;
      this.accumulator -= PHYSICS.step;
    }
    this.speed = this.grind ? this.grind.speed : this.grounded ? this.velocity.dot(this.forward) : Math.hypot(this.velocity.x, this.velocity.z);
  }

  step(dt, input) {
    const drive = clamp(input.drive || 0, -1, 1);
    const steer = clamp(input.steer || 0, -1, 1);
    this.steer += (steer - this.steer) * (1 - Math.exp(-12 * dt));
    this.feedbackTime = Math.max(0, this.feedbackTime - dt);

    if (this.bailTime > 0) {
      this.bailTime -= dt;
      if (this.bailTime <= 0) this.reset();
      return;
    }

    if (input.ollieHeld) this.charge = Math.min(1, this.charge + dt / PHYSICS.chargeTime);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    this.vertJumpTimer = Math.max(0, this.vertJumpTimer - dt);
    if (this.vertJumpTimer <= 0) this.vertJumpPending = 0;

    if (this.grind) {
      this.stepGrind(dt, input, drive);
      this.finishStep(dt);
      return;
    }
    if (this.wallRide) {
      this.stepWallRide(dt, input);
      this.finishStep(dt);
      return;
    }

    if ((this.grounded || this.coyote > 0) && this.jumpBuffer > 0) {
      const impulse = THREE.MathUtils.lerp(PHYSICS.minJump, PHYSICS.maxJump, this.jumpCharge);
      const vertApproach = this.grounded ? this.transitions.approachAt(this.position, this.normal, this.velocity) : null;
      if (vertApproach) {
        this.vertJumpPending = Math.max(this.vertJumpPending, impulse);
        this.vertJumpTimer = 0.72;
        this.jumpBuffer = 0;
      } else {
        this.takeoff(impulse);
      }
    }

    const before = this.position.clone();
    if (this.grounded) this.stepGround(dt, input, drive);
    else this.stepAir(dt, input, drive, before);

    const wall = this.surface.wall(before, this.position, this.normal, this.grounded);
    if (wall) {
      if (!this.grounded && input.olliePressed) this.wallPlant(wall, before);
      else if (!this.grounded && input.grindPressed) this.startWallRide(wall, before);
      else {
        this.position.copy(before);
        this.velocity.addScaledVector(wall.normal, -Math.min(0, this.velocity.dot(wall.normal)));
        if (this.grounded) this.velocity.multiplyScalar(0.25);
      }
    }

    if (!this.grind && !this.transitionAir) {
      const railHit = this.railNetwork.blockingContact(before, this.position, !this.grounded);
      if (railHit) {
        this.position.copy(before);
        const into = this.velocity.dot(railHit.normal);
        if (into < 0) this.velocity.addScaledVector(railHit.normal, -into);
        this.velocity.multiplyScalar(this.grounded ? 0.28 : 0.68);
      }
    }

    this.distance += this.position.distanceTo(before);
    this.finishStep(dt);
  }

  stepGround(dt, input, drive) {
    let speed = this.velocity.dot(this.forward);
    const rate = THREE.MathUtils.lerp(2.7, 1.2, clamp(Math.abs(speed) / 12, 0, 1));
    this.heading -= this.steer * rate * (speed < -0.15 ? -1 : 1) * dt;
    this.groundDirection();
    speed += GRAVITY.dot(this.forward) * dt;
    if (drive > 0 && speed < PHYSICS.maxSpeed) speed += drive * PHYSICS.push * dt;
    const resistance = 0.26 + 0.012 * speed * speed + ((input.brake || drive < 0) ? PHYSICS.brake : 0);
    speed = Math.sign(speed) * Math.max(0, Math.abs(speed) - resistance * dt);
    speed = clamp(speed, -17, 17);
    this.velocity.copy(this.forward).multiplyScalar(speed);
    this.position.addScaledVector(this.velocity, dt);

    const transition = this.transitions.launchAt(this.position, this.normal, this.velocity);
    const support = this.surface.ground(this.position, 0.28, 0.42);
    if (transition) {
      const vertBoost = this.vertJumpTimer > 0 ? this.vertJumpPending : 0;
      this.takeoff(vertBoost, transition);
    } else if (support && this.position.y - support.point.y < 0.27) {
      this.position.y = support.point.y + 0.015;
      this.normal.copy(support.normal);
      this.groundDirection();
      this.velocity.copy(this.forward).multiplyScalar(speed);
      if (this.manual && Math.abs(speed) < 0.55) { this.manual = null; this.flatland = null; }
    } else {
      const armedVert = this.vertJumpTimer > 0 ? this.transitions.approachAt(this.position, this.normal, this.velocity) : null;
      if (armedVert) this.takeoff(this.vertJumpPending, armedVert);
      else this.takeoff();
    }
  }

  stepAir(dt, input, drive, before) {
    this.airTime += dt;
    const airTurn = clamp(this.steer + clamp(input.spin || 0, -1, 1), -1.65, 1.65);
    this.airSpin -= airTurn * 3.8 * dt;
    this.heading = this.airHeading + this.airSpin;
    this.airDirection();
    this.velocity.y -= PHYSICS.gravity * dt;
    if (this.transitionAir) this.transitions.advance(this.transitionAir, this.position, this.velocity, input.vertExit, dt);
    this.position.addScaledVector(this.velocity, dt);

    if (this.flipState) {
      this.flipState.progress += dt / this.flipState.duration;
      if (this.flipState.progress >= 1) this.flipState = null;
    }

    if (this.pendingGrindTrick) {
      if (this.enterGrind(this.pendingGrindTrick)) { this.pendingGrindTrick = null; return; }
      if (!input.grindPressed) this.pendingGrindTrick = null;
    }

    const support = this.surface.ground(this.position, Math.max(0.15, before.y - this.position.y + 0.04), 0.4);
    if (support && this.velocity.dot(support.normal) < 0 && before.y >= support.point.y - 0.04 && this.position.y <= support.point.y + 0.015) {
      this.land(support);
    }
  }

  land(support) {
    this.position.y = support.point.y + 0.015;
    this.normal.copy(support.normal);
    this.groundDirection();
    const planar = this.velocity.clone().projectOnPlane(this.normal);
    const alignment = planar.length() > 1 ? this.forward.dot(planar.clone().normalize()) : 1;
    const unfinishedFlip = this.flipState && this.flipState.progress > 0.12 && this.flipState.progress < 0.88;
    if (Math.abs(alignment) < 0.44 || unfinishedFlip) {
      this.bail('BAIL · align your board before landing');
      return;
    }

    const spin = Math.floor((Math.abs(this.airSpin) * 180 / Math.PI + 25) / 180) * 180;
    if (spin >= 180) this.recordTrick(`${spin}°`, spin);
    this.grounded = true;
    this.coyote = 0;
    this.justLanded = true;
    this.transitionAir = null;
    this.wallRide = null;
    this.velocity.copy(this.forward).multiplyScalar(planar.length() * Math.sign(alignment || 1));
    this.flipState = null;
    this.grabState = null;
    this.airSpin = 0;
    this.stableGroundTime = 0;
  }

  enterGrind(trick) {
    const capture = this.railNetwork.capture(this.position, this.velocity, 0.92);
    if (!capture) return false;
    const sample = this.railNetwork.sample(capture.rail, capture.s);
    if (!sample) return false;
    this.grind = { ...capture, trick, speed: Math.max(2.8, capture.speed) };
    this.grounded = false;
    this.manual = null; this.flatland = null; this.transitionAir = null; this.wallRide = null;
    this.position.copy(sample.point);
    const travel = sample.tangent.multiplyScalar(this.grind.direction);
    this.velocity.copy(travel).multiplyScalar(this.grind.speed);
    this.heading = headingFrom(travel, this.heading);
    this.airHeading = this.heading;
    this.recordTrick(trick.name, trick.points);
    return true;
  }

  stepGrind(dt, input, drive) {
    if (!this.grind) return;
    if (input.ollieReleased) { this.exitGrind(true); return; }
    this.grind.speed = clamp(this.grind.speed + Math.max(0, drive) * 1.1 * dt - 0.65 * dt, 2.2, 16);
    this.grind.s += this.grind.direction * this.grind.speed * dt;
    const sample = this.railNetwork.sample(this.grind.rail, this.grind.s);
    if (!sample) { this.exitGrind(false); return; }
    const before = this.position.clone();
    this.position.copy(sample.point);
    const travel = sample.tangent.multiplyScalar(this.grind.direction);
    this.velocity.copy(travel).multiplyScalar(this.grind.speed);
    this.heading = headingFrom(travel, this.heading);
    this.airHeading = this.heading;
    this.airDirection();
    this.distance += this.position.distanceTo(before);
    this.stableGroundTime = 0;
  }

  exitGrind(pop) {
    if (!this.grind) return;
    const sample = this.railNetwork.sample(this.grind.rail, clamp(this.grind.s, 0, this.grind.rail.length));
    const tangent = sample?.tangent || this.forward.clone();
    const travel = tangent.multiplyScalar(this.grind.direction);
    this.velocity.copy(travel).multiplyScalar(this.grind.speed);
    this.grind = null;
    this.grounded = false;
    this.transitionAir = null;
    this.airHeading = headingFrom(travel, this.heading);
    this.heading = this.airHeading;
    this.airSpin = 0;
    if (pop) {
      const impulse = THREE.MathUtils.lerp(PHYSICS.minJump * 0.72, PHYSICS.maxJump * 0.82, Math.max(this.charge, 0.15));
      this.velocity.y += impulse;
      this.charge = 0;
      this.recordTrick('Ollie Out', 75);
    } else this.velocity.y += 0.25;
  }

  startWallRide(wall, before) {
    const tangent = this.velocity.clone().projectOnPlane(wall.normal);
    if (tangent.lengthSq() < 2) return;
    this.position.copy(before);
    tangent.y = Math.max(tangent.y, 1.2);
    this.velocity.copy(tangent);
    this.wallRide = { normal: wall.normal.clone(), time: 0, duration: 0.95 };
    this.transitionAir = null;
    this.heading = headingFrom(tangent, this.heading);
    this.airHeading = this.heading;
    this.recordTrick('Wall Ride', 250);
  }

  stepWallRide(dt, input) {
    if (!this.wallRide) return;
    if (input.olliePressed) {
      const normal = this.wallRide.normal.clone();
      this.velocity.projectOnPlane(normal).addScaledVector(normal, 4.2);
      this.velocity.y = Math.max(this.velocity.y, 4.8);
      this.wallRide = null;
      this.airHeading = headingFrom(this.velocity, this.heading);
      this.heading = this.airHeading;
      this.recordTrick('Wallie', 300);
      return;
    }

    this.wallRide.time += dt;
    const normal = this.wallRide.normal;
    this.velocity.projectOnPlane(normal);
    this.velocity.y -= PHYSICS.gravity * 0.34 * dt;
    const candidate = this.position.clone().addScaledVector(this.velocity, dt);
    const contact = this.surface.wallContact(candidate, normal, 0.62);
    if (!contact || this.wallRide.time > this.wallRide.duration) {
      this.wallRide = null;
      return;
    }
    this.position.copy(candidate);
    this.position.x = contact.point.x + normal.x * 0.13;
    this.position.z = contact.point.z + normal.z * 0.13;
    this.heading = headingFrom(this.velocity, this.heading);
    this.airHeading = this.heading;
    this.airDirection();
    this.stableGroundTime = 0;
  }

  wallPlant(wall, before) {
    this.position.copy(before);
    const incoming = Math.min(0, this.velocity.dot(wall.normal));
    this.velocity.addScaledVector(wall.normal, Math.max(4.3, -incoming * 1.8));
    this.velocity.y = Math.max(4.6, Math.abs(this.velocity.y) * 0.45 + 3.2);
    this.transitionAir = null;
    this.wallRide = null;
    this.airHeading = headingFrom(this.velocity, this.heading);
    this.heading = this.airHeading;
    this.recordTrick('Wall Plant', 300);
  }

  finishStep(dt) {
    for (const [axis, limit] of [['x', 33.2], ['z', 22.1]]) {
      if (Math.abs(this.position[axis]) > limit) {
        this.position[axis] = clamp(this.position[axis], -limit, limit);
        this.velocity[axis] = 0;
      }
    }
    if (this.grounded && !this.manual && !this.grind && !this.bailTime) {
      this.stableGroundTime += dt;
      if (this.stableGroundTime > 0.38 && this.tricks.combo.length) this.settleCombo();
    } else this.stableGroundTime = 0;
    if (this.position.y < -6 || !Number.isFinite(this.position.lengthSq())) this.reset();
  }

  bail(message) {
    this.velocity.set(0, 0, 0); this.bailTime = 0.9;
    this.transitionAir = null; this.grind = null; this.wallRide = null; this.manual = null; this.flatland = null;
    this.tricks.combo = []; this.tricks.comboBase = 0; this.tricks.comboMultiplier = 0;
    this.feedback = message; this.feedbackTime = 2;
  }
}
