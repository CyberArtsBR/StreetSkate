import bpy
import math
import sys
import json
from pathlib import Path
from mathutils import Vector


def log(msg):
    print(f"[TUXR-RIG] {msg}", flush=True)


def dist_sq_point_segment(p, a, b):
    ab = b - a
    d = ab.length_squared
    if d <= 1e-12:
        return (p - a).length_squared
    t = max(0.0, min(1.0, (p - a).dot(ab) / d))
    q = a + ab * t
    return (p - q).length_squared


def activate(obj):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def snapshot_edit_bones(arm_obj):
    activate(arm_obj)
    bpy.ops.object.mode_set(mode='EDIT')
    rows = []
    for eb in arm_obj.data.edit_bones:
        rows.append({
            'name': eb.name,
            'head': tuple(eb.head),
            'tail': tuple(eb.tail),
            'roll': float(eb.roll),
            'parent': eb.parent.name if eb.parent else None,
            'use_connect': bool(eb.use_connect),
            'use_deform': bool(eb.use_deform),
        })
    bpy.ops.object.mode_set(mode='OBJECT')
    return rows


def create_new_armature(old_obj, bone_rows):
    arm_data = bpy.data.armatures.new('TUXR_Rig_Data')
    new_obj = bpy.data.objects.new('TUXR_Rig', arm_data)
    target_collection = old_obj.users_collection[0] if old_obj.users_collection else bpy.context.scene.collection
    target_collection.objects.link(new_obj)
    new_obj.matrix_world = old_obj.matrix_world.copy()
    new_obj.show_in_front = True
    try:
        new_obj.display_type = old_obj.display_type
    except Exception:
        pass

    activate(new_obj)
    bpy.ops.object.mode_set(mode='EDIT')
    for row in bone_rows:
        eb = arm_data.edit_bones.new(row['name'])
        eb.head = Vector(row['head'])
        eb.tail = Vector(row['tail'])
        if (eb.tail - eb.head).length < 1e-6:
            eb.tail = eb.head + Vector((0.0, 0.01, 0.0))
        eb.roll = row['roll']
        eb.use_deform = row['use_deform']
    for row in bone_rows:
        eb = arm_data.edit_bones.get(row['name'])
        if row['parent']:
            eb.parent = arm_data.edit_bones.get(row['parent'])
            eb.use_connect = row['use_connect']
    bpy.ops.object.mode_set(mode='OBJECT')
    return new_obj


def rebind_meshes(old_obj, new_obj):
    bone_names = {b.name for b in new_obj.data.bones}
    rebound = []
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH':
            continue
        hit = False
        for mod in obj.modifiers:
            if mod.type == 'ARMATURE' and mod.object == old_obj:
                mod.object = new_obj
                hit = True
        if obj.parent == old_obj:
            world = obj.matrix_world.copy()
            obj.parent = new_obj
            obj.matrix_world = world
            hit = True
        if not hit and any(vg.name in bone_names for vg in obj.vertex_groups):
            arm_mod = next((m for m in obj.modifiers if m.type == 'ARMATURE'), None)
            if arm_mod is None:
                arm_mod = obj.modifiers.new(name='Armature', type='ARMATURE')
            arm_mod.object = new_obj
            hit = True
        if hit:
            rebound.append(obj)
    return rebound


def ensure_all_weighted(new_obj, meshes):
    deform_names = {b.name for b in new_obj.data.bones if b.use_deform}
    candidate_bones = [b for b in new_obj.data.bones if b.use_deform and 'twist' not in b.name.lower()]
    if not candidate_bones:
        candidate_bones = [b for b in new_obj.data.bones if b.use_deform]
    inv_arm = new_obj.matrix_world.inverted()
    filled_total = 0
    unweighted_after = 0

    for obj in meshes:
        group_by_index = {vg.index: vg.name for vg in obj.vertex_groups}
        group_by_name = {vg.name: vg for vg in obj.vertex_groups}
        for bn in deform_names:
            if bn not in group_by_name:
                group_by_name[bn] = obj.vertex_groups.new(name=bn)
        group_by_index = {vg.index: vg.name for vg in obj.vertex_groups}

        missing = []
        for v in obj.data.vertices:
            total = 0.0
            for g in v.groups:
                if group_by_index.get(g.group) in deform_names:
                    total += g.weight
            if total <= 1e-8:
                missing.append(v)

        for v in missing:
            co_arm = inv_arm @ (obj.matrix_world @ v.co)
            best = min(candidate_bones, key=lambda b: dist_sq_point_segment(co_arm, b.head_local, b.tail_local))
            group_by_name[best.name].add([v.index], 1.0, 'REPLACE')
            filled_total += 1

        # Normalize only deform groups by direct arithmetic, preserving non-rig groups.
        group_by_index = {vg.index: vg.name for vg in obj.vertex_groups}
        for v in obj.data.vertices:
            rig_entries = [(g, group_by_index.get(g.group)) for g in v.groups if group_by_index.get(g.group) in deform_names]
            total = sum(g.weight for g, _ in rig_entries)
            if total <= 1e-8:
                unweighted_after += 1
                continue
            if abs(total - 1.0) > 1e-5:
                for g, name in rig_entries:
                    group_by_name[name].add([v.index], g.weight / total, 'REPLACE')

    return filled_total, unweighted_after


def tail_weight_report(new_obj, meshes):
    tail_names = [f'tail_{i:02d}' for i in range(1, 10) if new_obj.data.bones.get(f'tail_{i:02d}')]
    result = {name: 0 for name in tail_names}
    for obj in meshes:
        index_to_name = {vg.index: vg.name for vg in obj.vertex_groups}
        for v in obj.data.vertices:
            for g in v.groups:
                name = index_to_name.get(g.group)
                if name in result and g.weight > 0.001:
                    result[name] += 1
    return result


def key_rot(pb, frame, xyz):
    if not pb:
        return
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = xyz
    pb.keyframe_insert(data_path='rotation_euler', frame=frame, group=pb.name)


def key_loc(pb, frame, xyz):
    if not pb:
        return
    pb.location = xyz
    pb.keyframe_insert(data_path='location', frame=frame, group=pb.name)


def build_idle(new_obj):
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.frame_start = 1
    scene.frame_end = 96

    if new_obj.animation_data:
        new_obj.animation_data_clear()
    new_obj.animation_data_create()
    action = bpy.data.actions.new('Idle_Loop')
    new_obj.animation_data.action = action

    # Character scale for tiny pelvis breathing translation.
    mesh_points = []
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            for c in obj.bound_box:
                mesh_points.append(obj.matrix_world @ Vector(c))
    if mesh_points:
        zmin = min(p.z for p in mesh_points)
        zmax = max(p.z for p in mesh_points)
        char_h = max(0.1, zmax - zmin)
    else:
        char_h = 1.0

    frames = [1, 25, 49, 73, 97]
    pbs = new_obj.pose.bones
    animated_names = [
        'pelvis','spine_01','spine_02','spine_03','neck_01','head',
        'clavicle_l','clavicle_r','upperarm_l','upperarm_r','lowerarm_l','lowerarm_r',
        'hand_l','hand_r','thigh_l','thigh_r','calf_l','calf_r',
    ] + [f'tail_{i:02d}' for i in range(1,10)]

    for frame in frames:
        t = 2.0 * math.pi * ((frame - 1) / 96.0)
        s = math.sin(t)
        c = math.cos(t)
        s2 = math.sin(t * 2.0)

        # Reset only the animated channels before applying the pose sample.
        for name in animated_names:
            pb = pbs.get(name)
            if pb:
                pb.rotation_mode = 'XYZ'
                pb.rotation_euler = (0.0, 0.0, 0.0)
                pb.location = (0.0, 0.0, 0.0)
                pb.scale = (1.0, 1.0, 1.0)

        pelvis = pbs.get('pelvis')
        key_loc(pelvis, frame, (0.0, 0.0, char_h * (0.0025 + 0.0025 * s)))
        key_rot(pelvis, frame, (0.010 * s, 0.006 * c, 0.010 * s2))

        key_rot(pbs.get('spine_01'), frame, (0.012 * s, 0.004 * c, -0.006 * s2))
        key_rot(pbs.get('spine_02'), frame, (0.018 * s, -0.004 * c, 0.008 * s2))
        key_rot(pbs.get('spine_03'), frame, (0.020 * s, 0.006 * c, -0.008 * s2))
        key_rot(pbs.get('neck_01'), frame, (-0.008 * s, 0.005 * c, 0.010 * s2))
        key_rot(pbs.get('head'), frame, (-0.006 * s, -0.006 * c, 0.014 * s2))

        # Very small arm/shoulder counter-motion so the idle stays safe on any imported rest pose.
        key_rot(pbs.get('clavicle_l'), frame, (0.0, 0.0, 0.010 * s))
        key_rot(pbs.get('clavicle_r'), frame, (0.0, 0.0, -0.010 * s))
        key_rot(pbs.get('upperarm_l'), frame, (0.006 * s, 0.008 * c, 0.014 * s))
        key_rot(pbs.get('upperarm_r'), frame, (-0.006 * s, -0.008 * c, -0.014 * s))
        key_rot(pbs.get('lowerarm_l'), frame, (0.005 * s, 0.0, 0.006 * c))
        key_rot(pbs.get('lowerarm_r'), frame, (-0.005 * s, 0.0, -0.006 * c))
        key_rot(pbs.get('hand_l'), frame, (0.004 * c, 0.004 * s, 0.0))
        key_rot(pbs.get('hand_r'), frame, (-0.004 * c, -0.004 * s, 0.0))

        # Tiny weight shift in the legs without moving planted feet.
        key_rot(pbs.get('thigh_l'), frame, (0.004 * s, 0.0, 0.004 * c))
        key_rot(pbs.get('thigh_r'), frame, (-0.004 * s, 0.0, -0.004 * c))
        key_rot(pbs.get('calf_l'), frame, (-0.003 * s, 0.0, 0.0))
        key_rot(pbs.get('calf_r'), frame, (0.003 * s, 0.0, 0.0))

        # Tail gets a smooth traveling wave; amplitude increases toward the tip.
        for i in range(1, 10):
            pb = pbs.get(f'tail_{i:02d}')
            if not pb:
                continue
            phase = (i - 1) * 0.38
            amp = 0.025 + (i - 1) * 0.006
            x = amp * math.sin(t + phase)
            z = (amp * 0.65) * math.cos(t + phase * 0.8)
            key_rot(pb, frame, (x, 0.0, z))

    # Try to make curves smooth/cyclic while remaining compatible with Blender's action API revisions.
    try:
        for fc in action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'BEZIER'
                kp.handle_left_type = 'AUTO_CLAMPED'
                kp.handle_right_type = 'AUTO_CLAMPED'
            fc.modifiers.new(type='CYCLES')
    except Exception as exc:
        log(f"FCurve compatibility note: {exc}")

    scene.frame_set(1)
    return action


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    output = Path(args[0] if args else '/tmp/tuxr_rerig_idle.blend')
    report_path = Path(args[1] if len(args) > 1 else '/tmp/tuxr_rig_report.json')

    armatures = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if not armatures:
        raise RuntimeError('No armature found in source file')
    old_obj = max(armatures, key=lambda o: len(o.data.bones))
    log(f"Source armature: {old_obj.name}, bones={len(old_obj.data.bones)}")

    bone_rows = snapshot_edit_bones(old_obj)
    source_bones = [r['name'] for r in bone_rows]
    required_tail = [f'tail_{i:02d}' for i in range(1, 10)]
    missing_tail_source = [n for n in required_tail if n not in source_bones]
    if missing_tail_source:
        raise RuntimeError(f"Source skeleton is missing expected tail bones: {missing_tail_source}")

    new_obj = create_new_armature(old_obj, bone_rows)
    meshes = rebind_meshes(old_obj, new_obj)
    if not meshes:
        raise RuntimeError('No mesh objects were rebound to the new armature')
    log('Rebound meshes: ' + ', '.join(o.name for o in meshes))

    filled, unweighted_after = ensure_all_weighted(new_obj, meshes)
    tail_weights = tail_weight_report(new_obj, meshes)
    log(f"Filled previously unweighted vertices: {filled}")
    log(f"Unweighted vertices after cleanup: {unweighted_after}")
    log(f"Tail weighted-vertex counts: {tail_weights}")

    if not any(v > 0 for v in tail_weights.values()):
        raise RuntimeError('Tail bones exist but no tail vertex weights were found; refusing to save an unrigged tail')

    old_data = old_obj.data
    bpy.data.objects.remove(old_obj, do_unlink=True)
    if old_data.users == 0:
        bpy.data.armatures.remove(old_data)

    action = build_idle(new_obj)
    new_obj['rig_rebuilt'] = True
    new_obj['rig_version'] = 'TUXR_FullBodyTail_v1'
    new_obj['idle_action'] = action.name

    report = {
        'source_armature_removed': True,
        'new_armature': new_obj.name,
        'bone_count': len(new_obj.data.bones),
        'tail_bones': [n for n in required_tail if new_obj.data.bones.get(n)],
        'rebound_meshes': [o.name for o in meshes],
        'filled_unweighted_vertices': filled,
        'unweighted_vertices_after': unweighted_after,
        'tail_weighted_vertex_counts': tail_weights,
        'idle_action': action.name,
        'idle_frame_start': 1,
        'idle_frame_end': 96,
        'fps': 30,
    }
    report_path.write_text(json.dumps(report, indent=2), encoding='utf-8')

    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    log(f"Saved: {output}")
    print('RIG_REBUILD_SUCCESS', flush=True)


if __name__ == '__main__':
    main()
