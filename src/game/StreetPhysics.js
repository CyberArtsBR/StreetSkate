import * as THREE from 'three';
import { ParkCollision } from './ParkCollision.js';

export const PHYSICS = Object.freeze({ step: 1 / 120, push: 6.8, maxSpeed: 11.5, gravity: 20,
  brake: 13, minJump: 4.5, maxJump: 7.6, chargeTime: 0.6, coyoteTime: 0.09, jumpBuffer: 0.12 });
const UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = new THREE.Vector3(0, -PHYSICS.gravity, 0);
const clamp = THREE.MathUtils.clamp;

/** Metres, seconds, Y up, local -Z travel. Presentation never changes trajectory. */
export class StreetPhysics {
  constructor({ collision, spawn }) {
    this.surface = new ParkCollision(collision);
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
    this.grounded = Boolean(support);
    this.speed = 0; this.charge = 0; this.airSpin = 0; this.flipProgress = 0;
    this.flipActive = false; this.airFlips = 0; this.grabbed = false; this.airTime = 0;
    this.accumulator = 0; this.coyote = 0; this.jumpBuffer = 0; this.jumpCharge = 0;
    this.distance = 0; this.justLanded = false; this.steer = 0; this.bailTime = 0;
    this.score = 0; this.feedback = ''; this.feedbackTime = 0;
    this.groundDirection();
  }

  groundDirection() {
    this.forward.set(-Math.sin(this.heading), 0, -Math.cos(this.heading)).projectOnPlane(this.normal).normalize();
  }

  releaseJump() {
    this.jumpBuffer = PHYSICS.jumpBuffer;
    this.jumpCharge = Math.max(this.charge, 0.05);
    this.charge = 0;
  }

  takeoff(impulse = 0) {
    this.grounded = false;
    // Tangential ramp velocity is already in velocity; add jump impulse once.
    this.velocity.y += impulse;
    this.airSpin = 0; this.airTime = 0; this.airFlips = 0; this.grabbed = false;
    this.jumpBuffer = 0; this.coyote = impulse ? 0 : PHYSICS.coyoteTime;
    this.airHeading = this.heading;
  }

  advance(delta, input = {}) {
    if (input.reset) { this.reset(); return; }
    if (input.ollieReleased) this.releaseJump();
    if (input.flip && !this.grounded && !this.flipActive && !this.bailTime) {
      this.flipActive = true; this.flipProgress = 0;
    }
    this.justLanded = false;
    this.accumulator += clamp(delta, 0, 0.2);
    while (this.accumulator + 1e-9 >= PHYSICS.step) {
      this.step(PHYSICS.step, input);
      this.accumulator -= PHYSICS.step;
    }
    this.speed = this.grounded ? this.velocity.dot(this.forward) : Math.hypot(this.velocity.x, this.velocity.z);
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
    if ((this.grounded || this.coyote > 0) && this.jumpBuffer > 0) {
      this.takeoff(THREE.MathUtils.lerp(PHYSICS.minJump, PHYSICS.maxJump, this.jumpCharge));
    }

    const before = this.position.clone();
    if (this.grounded) {
      let speed = this.velocity.dot(this.forward);
      const rate = THREE.MathUtils.lerp(2.7, 1.2, clamp(Math.abs(speed) / 12, 0, 1));
      // Camera follows local -Z. A positive (right) input decreases Y yaw.
      this.heading -= this.steer * rate * (speed < -0.15 ? -1 : 1) * dt;
      this.groundDirection();
      speed += GRAVITY.dot(this.forward) * dt;
      if (drive > 0 && speed < PHYSICS.maxSpeed) speed += drive * PHYSICS.push * dt;
      const resistance = 0.26 + 0.012 * speed * speed + ((input.brake || drive < 0) ? PHYSICS.brake : 0);
      speed = Math.sign(speed) * Math.max(0, Math.abs(speed) - resistance * dt);
      speed = clamp(speed, -17, 17);
      this.velocity.copy(this.forward).multiplyScalar(speed);
      this.position.addScaledVector(this.velocity, dt);

      const support = this.surface.ground(this.position, 0.22, 0.3);
      if (support && this.position.y - support.point.y < 0.27) {
        // Preserve speed as the tangent changes instead of adding artificial energy.
        this.position.y = support.point.y + 0.015;
        this.normal.copy(support.normal);
        this.groundDirection();
        this.velocity.copy(this.forward).multiplyScalar(speed);
      } else this.takeoff();
    } else {
      this.airTime += dt;
      this.airSpin -= this.steer * 3.8 * dt;
      this.heading = this.airHeading + this.airSpin;
      this.velocity.y -= PHYSICS.gravity * dt;
      this.position.addScaledVector(this.velocity, dt);
      if (input.grab) this.grabbed = true;
      if (this.flipActive) {
        this.flipProgress += dt / 0.42;
        if (this.flipProgress >= 1) { this.flipActive = false; this.flipProgress = 0; this.airFlips++; }
      }
      // Sweep from previous altitude to the new contact point; landing must cross a surface.
      const support = this.surface.ground(this.position, Math.max(0.15, before.y - this.position.y + 0.04), 0.4);
      if (support && this.velocity.dot(support.normal) < 0 && before.y >= support.point.y - 0.04 && this.position.y <= support.point.y + 0.015) {
        this.position.y = support.point.y + 0.015;
        this.normal.copy(support.normal);
        this.groundDirection();
        const planar = this.velocity.clone().projectOnPlane(this.normal);
        const alignment = planar.length() > 1 ? this.forward.dot(planar.clone().normalize()) : 1;
        if (Math.abs(alignment) < 0.48 || (this.flipActive && this.flipProgress > 0.16 && this.flipProgress < 0.90)) {
          this.bail('BAIL · align your board before landing');
        } else {
          this.grounded = true; this.coyote = 0; this.justLanded = true;
          this.velocity.copy(this.forward).multiplyScalar(planar.length() * Math.sign(alignment));
          this.flipActive = false; this.flipProgress = 0;
          if (this.airTime > 0.15) {
            const spin = Math.floor((Math.abs(this.airSpin) * 180 / Math.PI + 20) / 180) * 180;
            const points = 100 + this.airFlips * 500 + (this.grabbed ? 200 : 0) + spin;
            this.score += points;
            this.feedback = [spin ? `${spin}` : '', this.airFlips ? 'KICKFLIP' : this.grabbed ? 'GRAB' : 'OLLIE', `+${points}`].filter(Boolean).join(' · ');
            this.feedbackTime = 2.4;
          }
          this.airSpin = 0;
        }
      }
    }

    const wall = this.surface.wall(before, this.position, this.normal, this.grounded);
    if (wall) {
      this.position.copy(before);
      this.velocity.addScaledVector(wall.normal, -Math.min(0, this.velocity.dot(wall.normal)));
      if (this.grounded) this.velocity.multiplyScalar(0.25);
    }
    // Perimeter is closed to the rider; decoration is not a collision substitute.
    for (const [axis, limit] of [['x', 33.2], ['z', 22.1]]) {
      if (Math.abs(this.position[axis]) > limit) {
        this.position[axis] = clamp(this.position[axis], -limit, limit);
        this.velocity[axis] = 0;
      }
    }
    this.distance += this.position.distanceTo(before);
    if (this.position.y < -6 || !Number.isFinite(this.position.lengthSq())) this.reset();
  }

  bail(message) {
    this.velocity.set(0, 0, 0); this.bailTime = 0.9;
    this.feedback = message; this.feedbackTime = 2;
  }
}
