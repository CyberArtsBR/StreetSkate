import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Feet follow the BOARD NORMAL (nose/tail tilt, bank) but never inherit the
 * board's visual yaw. Pop Shove-it/360 Shove-it can finish with a 180-degree
 * yaw hold even though the rider did not rotate: copying board quaternion
 * to ankle bones twists both shins inside the skinned character.
 *
 * During a flip, grab release or bail, the feet follow rider orientation
 * until the board is safely caught.
 */
export function footWorldOrientation(riderRoot, board, restFootQuaternion, plantOnBoard = true) {
  const riderWorld = riderRoot.getWorldQuaternion(new THREE.Quaternion());
  if (!plantOnBoard || !board?.root) return riderWorld.multiply(restFootQuaternion);
  const riderUp = UP.clone().applyQuaternion(riderWorld);
  const boardUp = UP.clone().applyQuaternion(
    board.root.getWorldQuaternion(new THREE.Quaternion()),
  );
  const tiltOnly = new THREE.Quaternion().setFromUnitVectors(riderUp, boardUp);
  return tiltOnly.multiply(riderWorld).multiply(restFootQuaternion).normalize();
}
