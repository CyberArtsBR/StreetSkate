import * as THREE from 'three';
import { UnrealRider } from '../character/UnrealRider.js';
import { StreetBoard } from '../skateboard/StreetBoard.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class StreetSkater {
  constructor({ collision, spawn }) {
    this.root = new THREE.Group();
    this.root.name = 'street-skater';
    this.visual = new THREE.Group();
    this.root.add(this.visual);
    this.collision = collision;
    this.spawn = new THREE.Vector3(...spawn);
    this.raycaster = new THREE.Raycaster();
    this.speed = 0;
    this.verticalSpeed = 0;
    this.heading = Math.PI;
    this.grounded = false;
    this.normal = new THREE.Vector3(0, 1, 0);
    this.forward = new THREE.Vector3(0, 0, 1);
    this.distance = 0;
    this.charge = 0;
    this.airSpin = 0;
    this.flipProgress = 0;
    this.flipActive = false;
    this.justLanded = false;
    this.config = { maxSpeed: 13.5, pushAcceleration: 7.2, brakeAcceleration: 14, gravity: 21, maxOllieSpeed: 7.7 };
  }

  async load() {
    this.board = await new StreetBoard('/assets/rider/skateboard.glb').load();
    this.rider = await new UnrealRider('/assets/rider/TheanchoURi.glb').load();
    this.visual.add(this.board.root, this.rider.root);
    this.rider.root.position.y = 0.13;
    this.reset();
    return this;
  }

  _groundAt(position, height = 3.2) {
    const origin = position.clone();
    origin.y += height;
    this.raycaster.set(origin, DOWN);
    this.raycaster.far = height + 6;
    const hit = this.raycaster.intersectObject(this.collision, true)[0];
    if (!hit || hit.face.normal.y <= 0.04) return null;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    return { point: hit.point, normal };
  }

  reset() {
    this.root.position.copy(this.spawn);
    const ground = this._groundAt(this.root.position, 6);
    if (ground) this.root.position.y = ground.point.y + 0.02;
    this.speed = 0;
    this.verticalSpeed = 0;
    this.heading = Math.PI;
    this.grounded = true;
    this.normal.set(0, 1, 0);
    this.airSpin = 0;
    this.flipActive = false;
    this.flipProgress = 0;
    this.charge = 0;
    this._orientVisual();
  }

  _orientVisual() {
    const flatForward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const up = this.grounded ? this.normal : WORLD_UP;
    const forward = flatForward.clone().projectOnPlane(up).normalize();
    if (forward.lengthSq() < 0.2) forward.copy(this.forward);
    const right = new THREE.Vector3().crossVectors(up, forward).normalize();
    forward.crossVectors(right, up).normalize();
    this.forward.copy(forward);
    const matrix = new THREE.Matrix4().makeBasis(right, up, forward);
    const base = new THREE.Quaternion().setFromRotationMatrix(matrix);
    const spin = new THREE.Quaternion().setFromAxisAngle(up, this.airSpin);
    this.visual.quaternion.copy(base).multiply(spin);
  }

  update(dt, input, elapsed) {
    dt = Math.min(dt, 1 / 30);
    this.justLanded = false;
    if (input.reset || this.root.position.y < -8) this.reset();
    const absSpeed = Math.abs(this.speed);
    const steerStrength = this.grounded ? THREE.MathUtils.lerp(2.2, 0.85, Math.min(absSpeed / 12, 1)) : 1.45;
    const directionSign = this.speed < -0.1 ? -1 : 1;
    if (this.grounded) this.heading += input.steer * steerStrength * directionSign * dt;

    if (this.grounded) {
      if (input.drive > 0) this.speed += this.config.pushAcceleration * input.drive * dt;
      if (input.drive < 0 || input.brake) {
        const brake = (input.brake ? 1 : -input.drive) * this.config.brakeAcceleration * dt;
        this.speed = Math.sign(this.speed) * Math.max(0, Math.abs(this.speed) - brake);
      }
      if (!input.drive) this.speed *= Math.exp(-0.38 * dt);
      this.speed = THREE.MathUtils.clamp(this.speed, -3.2, this.config.maxSpeed);
      this.charge = input.ollieHeld ? Math.min(1, this.charge + dt / 0.72) : this.charge;
      if (input.ollieReleased && this.charge > 0.02) {
        const rampCarry = Math.max(0, this.forward.y * Math.max(this.speed, 0));
        this.verticalSpeed = rampCarry + THREE.MathUtils.lerp(4.6, this.config.maxOllieSpeed, this.charge);
        this.grounded = false;
        this.root.position.y += 0.08;
        this.charge = 0;
      }
    } else {
      this.verticalSpeed -= this.config.gravity * dt;
      this.root.position.y += this.verticalSpeed * dt;
      this.airSpin += input.steer * 2.3 * dt;
      if (input.flip && !this.flipActive) {
        this.flipActive = true;
        this.flipProgress = 0;
      }
      if (this.flipActive) {
        this.flipProgress += dt * 2.7;
        if (this.flipProgress >= 1) {
          this.flipProgress = 0;
          this.flipActive = false;
        }
      }
    }

    const movement = this.forward.clone().multiplyScalar(this.speed * dt);
    const previous = this.root.position.clone();
    this.root.position.add(movement);
    this.distance += movement.length() * Math.sign(this.speed || 1);
    const ground = this._groundAt(this.root.position);
    if (this.grounded) {
      if (ground && Math.abs(this.root.position.y - ground.point.y) < 1.15) {
        this.root.position.y = ground.point.y + 0.02;
        this.normal.lerp(ground.normal, 1 - Math.exp(-14 * dt)).normalize();
        const gravityAlongSlope = new THREE.Vector3(0, -9.81, 0).projectOnPlane(this.normal);
        this.speed += gravityAlongSlope.dot(this.forward) * dt;
      } else {
        this.grounded = false;
        this.verticalSpeed = this.forward.y * this.speed;
      }
    } else if (ground && this.verticalSpeed <= 0 && this.root.position.y <= ground.point.y + 0.14 && previous.y >= ground.point.y - 0.2) {
      this.root.position.y = ground.point.y + 0.02;
      this.normal.copy(ground.normal);
      this.verticalSpeed = 0;
      this.grounded = true;
      this.heading += this.airSpin;
      this.airSpin = 0;
      this.justLanded = true;
    }

    this._orientVisual();
    const speedRatio = Math.min(Math.abs(this.speed) / this.config.maxSpeed, 1);
    this.rider.update({ speedRatio, crouch: this.charge, airborne: !this.grounded, steer: input.steer, grab: input.grab, time: elapsed });
    this.board.update({ distance: this.distance, airborne: !this.grounded, flip: this.flipActive ? this.flipProgress : 0, grab: input.grab });
    return { speedRatio };
  }
}
