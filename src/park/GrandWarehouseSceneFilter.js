import { warehouseObjectName } from './ImportedWarehouseCollision.js';

// Several meshes in the uploaded Skatewarehouse GLB form one assembled obstacle.
// Blender can leave hidden-in-viewport objects in an export: the user's screenshot
// identifies this complete Nine stair + access-bank/hubba/handrail complex as
// unwanted. Exclude it exclusively from Grand Warehouse and exclude its contact
// and grind geometry at the same time.
export function isGrandWarehouseNineStair(name) {
  return /^01_STREET_DISTRICT \/ Nine stair(?: \/| (?:parallel access bank|west hubba|east hubba|kinked down rail) \/)/.test(name || '');
}

export function excludeGrandWarehouseNineStair(root) {
  let count=0;
  root.traverse(object => {
    if (!object.isMesh || !isGrandWarehouseNineStair(warehouseObjectName(object))) return;
    object.userData.grandWarehouseExcluded=true;
    count++;
  });
  return count;
}
