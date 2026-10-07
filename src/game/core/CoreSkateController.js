import { PlayerState } from './PlayerState.js';
import { TransitionController } from '../transitions/TransitionController.js';
import { CollisionResolver } from '../collision/CollisionResolver.js';
import { interpretOllieRelease } from '../../input/InputInterpreter.js';
import { resolveTravelState } from './TravelState.js';

/**
 * Phase 1 composition root.
 *
 * The legacy class hierarchy remains temporarily for behavior parity, but the
 * canonical state/transition/collision services are owned here and shared by all
 * adapters. New core authorities should be attached here rather than introduced
 * as another physics subclass.
 */
export class CoreSkateController {
  constructor({
    rails = [],
    surface = null,
    playerState = null,
  } = {}) {
    this.state = playerState || new PlayerState();
    this.transitions = new TransitionController({ rails });
    this.collision = surface ? new CollisionResolver(surface) : null;
  }

  syncState(runtime) {
    return this.state.syncFromLegacy(runtime);
  }

  interpretOllieRelease(context) {
    return interpretOllieRelease(context);
  }

  syncTravel(runtime, {
    preserveIfSlow = true,
    signMemoryThreshold = 0.18,
    directionThreshold = signMemoryThreshold,
  } = {}) {
    if (!runtime) return null;
    const resolved = resolveTravelState({
      velocity: runtime.velocity,
      deckHeading: runtime.heading,
      previousDirection: runtime.travelDirection || this.state.travelDirection,
      previousSign: runtime.rollingSign,
      preserveDirectionIfSlow: preserveIfSlow,
      config: { signMemoryThreshold, directionThreshold },
    });

    // Canonical state receives the resolved relationship first.
    this.state.deckHeading = Number.isFinite(Number(runtime.heading))
      ? Number(runtime.heading)
      : this.state.deckHeading;
    this.state.travelDirection.copy(resolved.travelDirection);
    this.state.stance = Number(runtime.stance) < 0 ? -1 : 1;

    // Compatibility fields remain outputs while old callers migrate away.
    runtime.travelDirection ||= resolved.travelDirection.clone();
    runtime.travelDirection.copy(this.state.travelDirection);
    runtime.rollingSign = resolved.rollingSign;
    runtime.fakie = this.state.fakie;
    return resolved;
  }

  ensureCollision(surface) {
    if (!surface) return null;
    if (!this.collision || this.collision.surface !== surface) {
      this.collision = new CollisionResolver(surface);
    }
    return this.collision;
  }

  bindLegacyRuntime(runtime) {
    if (!runtime) return this;
    runtime.playerState = this.state;
    runtime.transitionController = this.transitions;
    runtime.transitions = this.transitions;
    if (this.collision) runtime.collisionResolver = this.collision;
    return this;
  }
}
