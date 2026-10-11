# 얼음 블록(Ice_Break.glb)을 절차적으로 생성하는 Blender 헤드리스 스크립트.
#
# 사용법:
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup \
#       --python tools/gen_ice_block.py -- assets/models/Ice_Break.glb
#
# ar-scene/trash.js가 의존하는 계약(바꾸면 코드도 같이 고쳐야 함):
#   - 노드 Ice_Intact(온전한 얼음), Ice_Shard_00~15(파편), Ice_Crack_00~06(균열)
#   - 애니메이션 클립 Ice_Break_1_5s(1.5초), 0.5초(=12프레임)에 Ice_Intact가 사라지고 파편이 튐
#     (ICE_SHATTER_MOMENT_MS = 500)
#   - 기본 포즈(0프레임)는 온전한 얼음 — 파편/균열은 scale 0으로 숨겨둠
#   - 반투명 재질이라 얼음 안에 넣어둔 장생이가 비쳐 보여야 함
import math
import random
import sys

import bmesh
import bpy
from mathutils import Vector

FPS = 24
SHATTER_FRAME = 12  # 0.5초
END_FRAME = 36  # 1.5초

# 블록 크기(Blender Z-up 기준, half extents). 세로로 조금 긴 원석형 얼음 덩어리.
HX, HY, HZ = 0.5, 0.42, 0.56

rng = random.Random(7)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out_path = argv[0] if argv else 'Ice_Break.glb'

# ---------------------------------------------------------------- 초기화
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start = 0
scene.frame_end = END_FRAME
bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'


# ---------------------------------------------------------------- 머테리얼
def make_material(name, rgba, roughness, transmission=0.0, emission=None, emission_strength=0.0,
                  double_sided=True):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (rgba[0], rgba[1], rgba[2], 1.0)
    bsdf.inputs['Alpha'].default_value = rgba[3]
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['IOR'].default_value = 1.31
    bsdf.inputs['Transmission Weight'].default_value = transmission
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    # 몸체는 단면(single-sided)이라야 뒤쪽 면 테두리가 비쳐서 철사 틀처럼 보이지 않는다.
    mat.use_backface_culling = not double_sided
    mat.surface_render_method = 'BLENDED'
    return mat


MAT_BODY = make_material('Ice body', (0.55, 0.88, 1.0, 0.45), 0.08, transmission=0.6, double_sided=False)
MAT_FROST = make_material('Frost rim', (0.88, 0.97, 1.0, 0.9), 0.3,
                          emission=(0.6, 0.85, 1.0), emission_strength=0.35, double_sided=False)
MAT_GLINT = make_material('Ice glint', (1.0, 1.0, 1.0, 0.85), 0.2,
                          emission=(1.0, 1.0, 1.0), emission_strength=0.6)


# ---------------------------------------------------------------- 유틸
def mesh_object(name, verts, faces, mats):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    for m in mats:
        me.materials.append(m)
    return obj


def apply_modifiers(obj):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def rough_chunk(name, hx, hy, hz, edge_w, tilt=0.06, corner_depth=(0.18, 0.32), edge_depth=(0.08, 0.2),
                edge_cuts=8):
    # 참고 이미지의 얼음은 반듯한 각얼음이 아니라 큰 평면 몇 개에 모서리·꼭짓점이 깎여 나간 원석 같은
    # 덩어리라, 상자에서 시작해 랜덤 평면으로 여러 번 잘라낸다(평면 컷이라 면이 깨끗하게 평평함).
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.scale(bm, vec=Vector((hx, hy, hz)), verts=bm.verts[:])
    h = Vector((hx, hy, hz))

    def cut(co, no):
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no.normalized(), clear_outer=True)
        cut_edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if cut_edges:
            bmesh.ops.holes_fill(bm, edges=bm.edges[:], sides=0)

    def noise(a):
        return Vector((rng.uniform(-a, a), rng.uniform(-a, a), rng.uniform(-a, a)))

    # 6면을 살짝씩 기울여 반듯한 상자 느낌을 없앤다
    for axis in range(3):
        for sgn in (-1, 1):
            n = Vector((0, 0, 0))
            n[axis] = sgn
            cut(n * h[axis] * rng.uniform(0.94, 1.0), n + noise(tilt))
    # 꼭짓점 8개를 비스듬히 깎는다
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                c = Vector((sx * hx, sy * hy, sz * hz))
                n = Vector((sx / hx, sy / hy, sz / hz)).normalized() + noise(0.35)
                cut(c * (1 - rng.uniform(*corner_depth)), n)
    # 모서리 일부를 길게 깎는다
    edges = []
    for a in range(3):
        b, c = [i for i in range(3) if i != a]
        for sb in (-1, 1):
            for sc in (-1, 1):
                edges.append((b, sb, c, sc))
    for (b, sb, c, sc) in rng.sample(edges, edge_cuts):
        p = Vector((0, 0, 0))
        p[b], p[c] = sb * h[b], sc * h[c]
        n = Vector((0, 0, 0))
        n[b], n[c] = sb / h[b], sc / h[c]
        cut(p * (1 - rng.uniform(*edge_depth)), n.normalized() + noise(0.25))
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1), verts=bm.verts[:], edges=bm.edges[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    me.materials.append(MAT_BODY)
    me.materials.append(MAT_FROST)
    # 면 경계를 얇게 깎아 흰 서리 테두리(카툰 얼음의 하이라이트 선)로
    mod = obj.modifiers.new('Bevel', 'BEVEL')
    mod.width = edge_w
    mod.segments = 1
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(5)
    mod.material = 1
    apply_modifiers(obj)
    for p in obj.data.polygons:
        p.use_smooth = False
    return obj


def surface_hit(obj, axis, sign, u, w):
    # 축 방향 바깥에서 블록 표면으로 레이를 쏴서 (u, w) 위치의 표면점과 법선을 얻는다.
    if axis == 'y':
        o, d = Vector((u, sign * 2, w)), Vector((0, -sign, 0))
    elif axis == 'x':
        o, d = Vector((sign * 2, u, w)), Vector((-sign, 0, 0))
    else:
        o, d = Vector((u, w, sign * 2)), Vector((0, 0, -sign))
    ok, loc, nor, _ = obj.ray_cast(o, d)
    assert ok, (axis, sign, u, w)
    return loc, nor


def strip_on_surface(name, obj, axis, sign, pts2, width, mat, lift=0.006, taper=True):
    # 2D 폴리라인(pts2)을 블록 표면에 붙인 얇은 띠 메시로. 원점은 첫 점(=퍼지기 시작하는 지점).
    verts = []
    n = len(pts2)
    for i, p in enumerate(pts2):
        d = (pts2[min(i + 1, n - 1)] - pts2[max(i - 1, 0)]).normalized()
        off = Vector((-d.y, d.x)) * width * ((1 - i / (n + 1)) if taper else 1.0)
        for q in (p + off, p - off):
            loc, nor = surface_hit(obj, axis, sign, q.x, q.y)
            verts.append(loc + nor * lift)
    origin = (verts[0] + verts[1]) / 2
    verts = [v - origin for v in verts]
    faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(n - 1)]
    strip = mesh_object(name, verts, faces, [mat])
    strip.location = origin
    return strip


def join(objs, name):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


def paint_gradient(obj, z_min, z_max):
    # 아래는 진한 하늘색, 위는 흰빛 — 카툰 얼음의 위에서 빛 받는 느낌. glTF COLOR_0으로 나가서
    # baseColor에 곱해진다(텍스처 없이 용량 증가 거의 없음).
    me = obj.data
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    me.color_attributes.active_color = attr
    lo, hi = (0.6, 0.8, 1.0), (1.0, 1.0, 1.0)
    for loop in me.loops:
        z = (obj.matrix_world @ me.vertices[loop.vertex_index].co).z
        t = min(1.0, max(0.0, (z - z_min) / (z_max - z_min)))
        t = t * t * (3 - 2 * t)
        attr.data[loop.index].color = (*[lo[i] + (hi[i] - lo[i]) * t for i in range(3)], 1.0)


def line(p0, angle, length):
    return [Vector(p0), Vector(p0) + Vector((math.cos(angle), math.sin(angle))) * length]


# ---------------------------------------------------------------- 온전한 얼음
block = rough_chunk('Ice_Intact', HX, HY, HZ, 0.016)
bpy.context.view_layer.update()

# 카툰풍 반사광(앞뒤 면 왼쪽 위에 비스듬한 흰 줄 두 개, 양 옆면에 하나씩)
glints = []
for side, sign in enumerate((-1, 1)):
    u = -0.2 * -sign  # 뒷면은 좌우가 뒤집혀 보이므로 반대쪽
    glints.append(strip_on_surface(f'glint_{side}_a', block, 'y', sign,
                                   line((u - 0.1, 0.12), 0.85, 0.3), 0.02, MAT_GLINT, taper=False))
    glints.append(strip_on_surface(f'glint_{side}_b', block, 'y', sign,
                                   line((u + 0.01, 0.22), 0.85, 0.13), 0.014, MAT_GLINT, taper=False))
for side, sign in enumerate((-1, 1)):
    glints.append(strip_on_surface(f'glint_s{side}', block, 'x', sign,
                                   line((-0.1, 0.15), 0.9, 0.2), 0.014, MAT_GLINT, taper=False))


# ---------------------------------------------------------------- 균열(합치기 전에 블록 표면 기준으로 만듦)
def crack(name, axis, sign, start, steps):
    # 표면을 따라 지그재그로 뻗는 얇은 띠. 원점=시작점이라 scale 0->1로 "퍼지는" 연출이 된다.
    pts = [Vector(start)]
    ang = rng.uniform(0, 2 * math.pi)
    for _ in range(steps):
        ang += rng.uniform(-0.9, 0.9)
        nxt = pts[-1] + Vector((math.cos(ang), math.sin(ang))) * rng.uniform(0.06, 0.1)
        nxt.x = max(-0.28, min(0.28, nxt.x))
        nxt.y = max(-0.38, min(0.38, nxt.y))
        pts.append(nxt)
    return strip_on_surface(name, block, axis, sign, pts, 0.012, MAT_FROST, lift=0.008)


crack_defs = [('y', -1, (0.05, 0.02), 5), ('y', -1, (-0.1, -0.15), 4), ('x', 1, (0.0, 0.1), 5),
              ('x', -1, (-0.05, -0.05), 4), ('y', 1, (0.1, 0.05), 5), ('z', 1, (0.0, 0.0), 3),
              ('y', -1, (0.15, 0.25), 3)]
cracks = [crack(f'Ice_Crack_{i:02d}', a, sg, st, n) for i, (a, sg, st, n) in enumerate(crack_defs)]

ice_intact = join([block] + glints, 'Ice_Intact')
paint_gradient(ice_intact, -HZ, HZ)

# ---------------------------------------------------------------- 파편
# 블록 부피를 2x2x4 격자로 나눈 칸마다 크기가 조금씩 다른 원석 조각을 둔다.
shards = []
idx = 0
for iz in range(4):
    for ix in range(2):
        for iy in range(2):
            cx = (ix - 0.5) * HX
            cy = (iy - 0.5) * HY
            cz = -HZ + (iz + 0.5) * (2 * HZ / 4)
            s = rough_chunk(f'Ice_Shard_{idx:02d}', HX / 2 * rng.uniform(0.55, 0.8),
                            HY / 2 * rng.uniform(0.55, 0.8), HZ / 4 * rng.uniform(0.7, 1.0), 0.01,
                            tilt=0.25, corner_depth=(0.25, 0.5), edge_depth=(0.15, 0.4), edge_cuts=5)
            s.location = (cx, cy, cz)
            s.rotation_euler = (rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(-0.5, 0.5))
            shards.append(s)
            idx += 1


# ---------------------------------------------------------------- 애니메이션
def key(obj, frame, loc=None, rot=None, scale=None):
    if loc is not None:
        obj.location = loc
        obj.keyframe_insert('location', frame=frame)
    if rot is not None:
        obj.rotation_euler = rot
        obj.keyframe_insert('rotation_euler', frame=frame)
    if scale is not None:
        obj.scale = (scale, scale, scale)
        obj.keyframe_insert('scale', frame=frame)


# 온전한 얼음: 균열이 퍼지는 동안 점점 세게 떨리다가 12프레임에 사라짐
for f in range(0, SHATTER_FRAME):
    amp = 0.0 if f < 2 else 0.012 * (f / SHATTER_FRAME) * (1 if f % 2 else -1)
    key(ice_intact, f, rot=(amp, -amp * 0.7, amp * 0.5), scale=1.0)
key(ice_intact, SHATTER_FRAME, rot=(0, 0, 0), scale=0.0)
key(ice_intact, END_FRAME, rot=(0, 0, 0), scale=0.0)

# 균열: 2~11프레임 사이에 하나씩 퍼지고, 깨지는 순간 같이 사라짐
for i, c in enumerate(cracks):
    appear = 2 + i
    key(c, 0, scale=0.0)
    key(c, appear, scale=0.0)
    key(c, min(appear + 3, SHATTER_FRAME - 1), scale=1.0)
    key(c, SHATTER_FRAME - 1, scale=1.0)
    key(c, SHATTER_FRAME, scale=0.0)
    key(c, END_FRAME, scale=0.0)

# 파편: 12프레임에 제자리에 나타나 바깥+위로 튄 뒤 포물선으로 떨어지며 회전, 끝에 작아지며 사라짐
G = -5.5
for s in shards:
    p0 = s.location.copy()
    r0 = s.rotation_euler.copy()
    out = Vector((p0.x, p0.y, p0.z * 0.4))
    out = out.normalized() if out.length > 1e-4 else Vector((0, 0, 1))
    speed = rng.uniform(1.4, 2.2)
    v = out * speed + Vector((0, 0, rng.uniform(1.2, 2.0)))
    spin = Vector((rng.uniform(-9, 9), rng.uniform(-9, 9), rng.uniform(-6, 6)))
    key(s, 0, loc=p0, rot=r0, scale=0.0)
    key(s, SHATTER_FRAME - 1, loc=p0, rot=r0, scale=0.0)
    for f in range(SHATTER_FRAME, END_FRAME + 1, 2):
        t = (f - SHATTER_FRAME) / FPS
        loc = p0 + v * t + Vector((0, 0, 0.5 * G * t * t))
        rot = (r0.x + spin.x * t, r0.y + spin.y * t, r0.z + spin.z * t)
        sc = 1.0 if f <= 26 else max(0.0, 1.0 - (f - 26) / (END_FRAME - 26))
        key(s, f, loc=loc, rot=rot, scale=sc)

scene.frame_set(0)

# ---------------------------------------------------------------- 내보내기
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format='GLB',
    export_apply=True,
    export_animations=True,
    export_animation_mode='ACTIVE_ACTIONS',
    export_frame_range=True,
    export_force_sampling=True,
    export_yup=True,
    export_texcoords=False,
    export_normals=True,
    export_materials='EXPORT',
    export_vertex_color='ACTIVE',
)


# ACTIVE_ACTIONS 모드는 오브젝트별 액션을 애니메이션 하나로 합쳐 주지만 이름이 "Animation"으로 나와서,
# trash.js가 재생하는 클립 이름(Ice_Break_1_5s)으로 GLB의 JSON 청크를 직접 고쳐 쓴다.
def rename_animation(path, name):
    import json
    import struct
    with open(path, 'rb') as fp:
        data = fp.read()
    json_len = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + json_len])
    rest = data[20 + json_len:]
    assert len(gltf['animations']) == 1, gltf['animations']
    gltf['animations'][0]['name'] = name
    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    body = struct.pack('<I', len(js)) + b'JSON' + js + rest
    with open(path, 'wb') as fp:
        fp.write(data[:8] + struct.pack('<I', 12 + len(body)) + body)


rename_animation(out_path, 'Ice_Break_1_5s')
print('EXPORTED', out_path)
