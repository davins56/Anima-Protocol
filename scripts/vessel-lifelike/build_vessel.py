"""Headless Blender build of a lifelike vessel base (MakeHuman CC0 base mesh via MPFB).
Usage: blender -b --python build_vessel.py -- <serenity|scarlet> <out.glb>"""
import importlib, sys, bpy, os, math, bmesh
from mathutils import Vector, Matrix, kdtree, bvhtree
def di(p,k):
    for m in list(sys.modules):
        if m.endswith(p): return getattr(importlib.import_module(m),k)
    raise ValueError(p)
HumanService=di("mpfb.services.humanservice","HumanService")
TargetService=di("mpfb.services.targetservice","TargetService")
LocationService=di("mpfb.services.locationservice","LocationService")
ExportService=di("mpfb.services.exportservice","ExportService")

CHAR, OUT = sys.argv[sys.argv.index("--")+1:][:2]
TOOLS="/workspace/lifelike-vessel/tools"; TEX="/workspace/lifelike-vessel/build/tex"
P=TOOLS+"/packs"; M=TOOLS+"/mh_assets"

CFG = {
 "serenity": dict(
   macro=dict(gender=0.0, age=0.5, muscle=0.55, weight=0.42, proportions=0.85, height=0.55, cupsize=0.55, firmness=0.6, race={"african":0.85,"caucasian":0.1,"asian":0.05}),
   race="african",
   hair=[P+"/hair01/hair/cortu_short_messy_hair/cortu_short_messy_hair.mhclo"],
   hair_tex=["serenity_hair.png"], brow="serenity_brow.png", lash="serenity_lash.png", eye="serenity_eye.png",
   clothes=[(P+"/dress01/clothes/toigo_halter_dress_with_fluted_skirt/toigo_halter_dress_with_fluted_skirt.mhclo","Dress","serenity_dress.jpg",None,0.78)],
   skin="serenity", sash=dict(kind="diagonal", color=(0.03,0.07,0.45)), curls=0, jewelry=dict(gem=(0.55,0.75,1.0), metal=(0.85,0.68,0.32))),
 "scarlet": dict(
   macro=dict(gender=0.0, age=0.48, muscle=0.5, weight=0.45, proportions=0.85, height=0.5, cupsize=0.65, firmness=0.6, race={"caucasian":0.6,"african":0.2,"asian":0.2}),
   race="caucasian",
   hair=[P+"/hair01/hair/o4saken_long01/o4saken_long01.mhclo"],
   hair_tex=["scarlet_hair_long.png"], hair_nrm=["scarlet_hair_long_nrm.jpg"], brow="scarlet_brow.png", lash="scarlet_lash.png", eye="scarlet_eye.png",
   clothes=[(P+"/shirts01/clothes/toigo_bodice-style_top/toigo_bodice-style_top.mhclo","Top","scarlet_top.jpg","scarlet_top_nrm.jpg",0.55),
            (P+"/skirts01/clothes/toigo_tiered_mini_skirt/toigo_tiered_mini_skirt.mhclo","Skirt","scarlet_skirt.jpg","scarlet_skirt_nrm.jpg",0.45),
            (P+"/shoes01/clothes/grinsegold_female_pirate_boots/grinsegold_female_pirate_boots.mhclo","Boots","scarlet_boots.jpg",P+"/shoes01/clothes/grinsegold_female_pirate_boots/BootsNormals.jpg",0.4)],
   skin="scarlet", sash=dict(kind="waist", color=(0.16,0.004,0.012)), curls=170, jewelry=dict(gem=(0.75,0.02,0.06), metal=(0.85,0.66,0.3))),
}[CHAR]

for o in list(bpy.data.objects): bpy.data.objects.remove(o)
macro=TargetService.get_default_macro_info_dict(); macro.update(CFG["macro"])
bm=HumanService.create_human(macro_detail_dict=macro)
TargetService.bake_targets(bm)  # macro shape -> basis

# ---------------- ARKit face shape keys from CC0 MakeHuman expression units ----------------
U=os.path.join(LocationService.get_mpfb_data("targets"),"expression/units",CFG["race"])
def unit(name):
    TargetService.load_target(bm,os.path.join(U,name+".target.gz"),weight=0.0)
    kb=bm.data.shape_keys.key_blocks[-1]; base=bm.data.shape_keys.key_blocks[0]
    d=[kb.data[i].co-base.data[i].co for i in range(len(base.data))]
    bm.shape_key_remove(kb)
    return d
base_co=[v.co.copy() for v in bm.data.vertices]
N=len(base_co)
def side(d, s):
    """Keep one side (s=+1 character left = +x). Smooth 1cm crossover at the midline."""
    out=[]
    for i,v in enumerate(d):
        x=base_co[i].x*s; k=min(1,max(0,(x+0.005)/0.01))
        out.append(v*k)
    return out
def add(a,b,kb=1.0): return [x+y*kb for x,y in zip(a,b)]
def scale(a,k): return [x*k for x in a]
u={n:unit(n) for n in ["eye-left-closure","eye-right-closure","mouth-open","mouth-corner-puller","mouth-protusion","mouth-pursing",
   "eyebrows-left-down","eyebrows-right-down","eyebrows-left-inner-up","eyebrows-right-inner-up","mouth-depression","eye-left-opened-up","eye-right-opened-up","eye-left-slit","eye-right-slit","mouth-compression"]}
KEYS={
 "eyeBlinkLeft": u["eye-left-closure"], "eyeBlinkRight": u["eye-right-closure"],
 "jawOpen": u["mouth-open"],
 "mouthSmileLeft": side(u["mouth-corner-puller"],1), "mouthSmileRight": side(u["mouth-corner-puller"],-1),
 "mouthFunnel": add(u["mouth-protusion"],u["mouth-open"],0.18), "mouthPucker": u["mouth-pursing"],
 "browDownLeft": u["eyebrows-left-down"], "browDownRight": u["eyebrows-right-down"],
 "browInnerUp": add(u["eyebrows-left-inner-up"],u["eyebrows-right-inner-up"]),
 "mouthFrownLeft": side(u["mouth-depression"],1), "mouthFrownRight": side(u["mouth-depression"],-1),
 "eyeWideLeft": u["eye-left-opened-up"], "eyeWideRight": u["eye-right-opened-up"],
 "eyeSquintLeft": u["eye-left-slit"], "eyeSquintRight": u["eye-right-slit"],
 "mouthPressLeft": side(u["mouth-compression"],1), "mouthPressRight": side(u["mouth-compression"],-1),
}
if not bm.data.shape_keys: bm.shape_key_add(name="Basis")
for name,d in KEYS.items():
    kb=bm.shape_key_add(name=name,from_mix=False)
    for i in range(N): kb.data[i].co=base_co[i]+d[i]
print("face keys", len(KEYS))

# ---------------- rig + CC0 proxies ----------------
rig=HumanService.add_builtin_rig(bm,"game_engine")
def mhclo(path,atype,sub=0):
    return HumanService.add_mhclo_asset(path,bm,asset_type=atype,material_type="GAMEENGINE",subdiv_levels=sub)
eyes=mhclo(M+"/eyes/low-poly/low-poly.mhclo","Eyes",1)
brows=mhclo(M+"/eyebrows/eyebrow001/eyebrow001.mhclo","Eyebrows",0)
lashes=mhclo(M+"/eyelashes/eyelashes01/eyelashes01.mhclo","Eyelashes",0)
teeth=mhclo(M+"/teeth/teeth_base/teeth_base.mhclo","Teeth",0)
tongue=mhclo(M+"/tongue/tongue01/tongue01.mhclo","Tongue",0)
hairs=[mhclo(h,"Hair",0) for h in CFG["hair"]]
def clear_face(o):
    """Drop hair-card faces hanging in front of the face (bangs) so the face reads like the reference."""
    hb0=rig.data.bones["head"]; hc=(hb0.head_local+hb0.tail_local)/2
    bmx=bmesh.new(); bmx.from_mesh(o.data)
    kill=[f for f in bmx.faces if (lambda c: c.y<hc.y-0.055 and abs(c.x)<0.085 and c.z<hc.z+0.035)(f.calc_center_median())]
    bmesh.ops.delete(bmx,geom=kill,context='FACES'); bmx.to_mesh(o.data); bmx.free(); print("bangs removed",len(kill))
if CHAR=="scarlet":
    for h in hairs: clear_face(h)
SUBDIV={"Top":1,"Dress":1,"Skirt":0,"Boots":0}
clothes=[(mhclo(c[0],"Clothes",SUBDIV.get(c[1],0)),)+tuple(c[1:]) for c in CFG["clothes"]]
for (o,label,*_) in clothes:
    if label=="Boots":
        d=o.modifiers.new("Decimate",'DECIMATE'); d.ratio=0.3

# body-only KD tree in rest pose (helpers excluded)
body_idx=[i for i in range(N) if any(bm.vertex_groups[g.group].name=="body" for g in bm.data.vertices[i].groups)]
kd=kdtree.KDTree(len(body_idx))
for j,i in enumerate(body_idx): kd.insert(base_co[i],j)
kd.balance()

def transfer_keys(obj, names, k=4):
    me=obj.data
    if not me.shape_keys: obj.shape_key_add(name="Basis")
    co=[v.co.copy() for v in me.vertices]
    near=[kd.find_n(c,k) for c in co]
    for name in names:
        d=KEYS[name]; kb=obj.shape_key_add(name=name,from_mix=False)
        for vi,c in enumerate(co):
            ws=0; acc=Vector()
            for (_,j,dist) in near[vi]:
                w=1/(dist+1e-4); ws+=w; acc+=d[body_idx[j]]*w
            kb.data[vi].co=c+acc/ws
FACE_SOFT=["eyeBlinkLeft","eyeBlinkRight","browDownLeft","browDownRight","browInnerUp","eyeWideLeft","eyeWideRight","eyeSquintLeft","eyeSquintRight"]
transfer_keys(lashes,FACE_SOFT); transfer_keys(brows,FACE_SOFT)

# jaw: rotate lower teeth / tongue about the jaw hinge by the chin's drop under jawOpen
jo=KEYS["jawOpen"]
tz=sorted(v.co.z for v in teeth.data.vertices); t_mid=tz[len(tz)//2]
tys=[v.co.y for v in teeth.data.vertices]; t_front=min(tys); t_back=max(tys)
front_low=Vector((0,t_front,t_mid-0.012))
near=kd.find_n(front_low,6); drop=sum(jo[body_idx[j]].length for (_,j,_) in near)/len(near)
hinge=Vector((0, t_back+0.045, t_mid+0.02))
ang=math.atan2(drop, (front_low-hinge).length)
print("jaw angle deg", math.degrees(ang), "drop", drop, "teeth mid z", t_mid)
def jaw_key(obj, split_z=None, frac=1.0):
    me=obj.data
    if not me.shape_keys: obj.shape_key_add(name="Basis")
    zs=sorted(v.co.z for v in me.vertices); sz=split_z if split_z is not None else zs[len(zs)//2]
    R=Matrix.Rotation(ang*frac,4,'X')  # rotate about +x: front (-y) moves down
    kb=obj.shape_key_add(name="jawOpen",from_mix=False)
    for i,v in enumerate(me.vertices):
        if v.co.z<sz: kb.data[i].co=hinge+(R@(v.co-hinge))
    return sz
sz=jaw_key(teeth); jaw_key(tongue, split_z=10.0, frac=0.8)

# ---------------- self-made geometry ----------------
def body_bvh(objs):
    dg=bpy.context.evaluated_depsgraph_get(); verts=[]; polys=[]
    for o in objs:
        e=o.evaluated_get(dg); me=e.to_mesh(); off=len(verts); mw=o.matrix_world
        verts+= [mw@v.co for v in me.vertices]; polys+=[[off+i for i in p.vertices] for p in me.polygons]; e.to_mesh_clear()
    return bvhtree.BVHTree.FromPolygons(verts,polys)
for o in [bm]+[c[0] for c in clothes]+hairs:
    for md in o.modifiers:
        if md.type=='ARMATURE': md.show_viewport=False
BVH_BODY=body_bvh([bm]); BVH_ALL=body_bvh([bm]+[c[0] for c in clothes])
def torso_bvh(objs, maxx=0.21):
    dg=bpy.context.evaluated_depsgraph_get(); verts=[]; polys=[]
    for o in objs:
        e=o.evaluated_get(dg); me=e.to_mesh(); off=len(verts); mw=o.matrix_world
        vs=[mw@v.co for v in me.vertices]; verts+=vs
        polys+=[[off+i for i in p.vertices] for p in me.polygons if all(abs(vs[i].x)<maxx for i in p.vertices)]; e.to_mesh_clear()
    return bvhtree.BVHTree.FromPolygons(verts,polys)
BVH_TORSO=torso_bvh([bm]+[c[0] for c in clothes])

def copy_weights(obj, src_pts=None, head_blend=None):
    """Skin custom geometry: copy bone weights from the nearest body vertices (optionally blending toward 'head')."""
    vg_names=[g.name for g in bm.vertex_groups if g.name in rig.data.bones]
    for n in vg_names:
        if n not in obj.vertex_groups: obj.vertex_groups.new(name=n)
    for vi,v in enumerate(obj.data.vertices):
        p=v.co; hits=kd.find_n(p,3); acc={}
        for (_,j,dist) in hits:
            w=1/(dist+1e-4)
            for g in bm.data.vertices[body_idx[j]].groups:
                gn=bm.vertex_groups[g.group].name
                if gn in rig.data.bones: acc[gn]=acc.get(gn,0)+g.weight*w
        s=sum(acc.values()) or 1
        hb=head_blend[vi] if head_blend else 0
        for gn,w in acc.items(): obj.vertex_groups[gn].add([vi],(w/s)*(1-hb),'REPLACE')
        if hb>0: obj.vertex_groups["head"].add([vi],hb,'ADD')
    md=obj.modifiers.new("Armature",'ARMATURE'); md.object=rig; obj.parent=rig

def mesh_obj(name, verts, faces, uvs=None):
    me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update()
    if uvs:
        uv=me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices: uv.data[li].uv=uvs[me.loops[li].vertex_index]
    for p in me.polygons: p.use_smooth=True
    o=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(o); return o

def surface_band(center, normal_plane, up, height, offset, n=96, bvh=None, tail=None, outer=False):
    """A cloth band hugging the surface on a (possibly tilted) plane through `center`."""
    bvh=bvh or BVH_TORSO
    e1=normal_plane.orthogonal().normalized(); e2=normal_plane.cross(e1).normalized()
    ring=[]
    for k in range(n):
        t=2*math.pi*k/n; d=(e1*math.cos(t)+e2*math.sin(t)).normalized()
        hit=bvh.ray_cast(center+d*0.4,-d,0.4) if outer else bvh.ray_cast(center,d,0.5)  # outer: outermost layer wins
        p=hit[0] if hit[0] is not None else center+d*0.15
        ring.append(p+d*offset)
    verts=[];faces=[];uvs=[]
    for k,p in enumerate(ring):
        for s in (-0.5,0.5):
            verts.append(p+normal_plane.normalized()*height*s); uvs.append((k/n, s+0.5))
    for k in range(n):
        a,b=2*k,2*((k+1)%n); faces.append([a,b,b+1,a+1])
    return verts,faces,uvs

def ribbon(path, widths, normals, uv_u=(0,1)):
    verts=[];faces=[];uvs=[]; L=len(path)
    for i,(p,w,nrm) in enumerate(zip(path,widths,normals)):
        t=(path[min(i+1,L-1)]-path[max(i-1,0)]).normalized(); b=t.cross(nrm).normalized()
        verts+= [p-b*w*0.5, p+b*w*0.5]; v=i/(L-1); uvs+=[(uv_u[0],1-v),(uv_u[1],1-v)]
    for i in range(L-1): faces.append([2*i,2*i+1,2*i+3,2*i+2])
    return verts,faces,uvs

def push_out(p, bvh, margin):
    loc,nrm,_,dist=bvh.find_nearest(p)
    if loc is None: return p
    if (p-loc).dot(nrm)<margin: return loc+nrm*margin
    return p

extras=[]
hb=rig.data.bones["head"]; head_c=(hb.head_local+hb.tail_local)/2
if CFG["curls"]:
    import random; random.seed(5)
    V=[];F=[];UV=[];HB=[]
    hair_bvh=body_bvh(hairs)
    collide=body_bvh([bm]+[c[0] for c in clothes]+hairs)
    z_tip0=head_c.z-0.62
    for c in range(CFG["curls"]):
        az=random.uniform(-2.05,2.05)  # 0 = back (+y in Blender); face front excluded
        el=random.uniform(-0.25,0.85)
        d=Vector((math.sin(az)*math.cos(el), math.cos(az)*math.cos(el), math.sin(el)))
        far=head_c+d*0.4; hit=hair_bvh.ray_cast(far,-d,0.4)
        root=(hit[0] if hit[0] is not None else head_c+d*0.11)-d*0.006
        z_tip=z_tip0+random.uniform(-0.07,0.09)+0.12*max(0,abs(az)-1.4)
        L=max(0.18,root.z-z_tip)
        r_out=random.uniform(0.022,0.03); r_in=0.002
        pitch=random.uniform(0.03,0.042); ph=random.uniform(0,6.28); spin=random.choice((-1,1))
        out=Vector((d.x,d.y,0)).normalized()
        # axis: drop with gravity, drift outward, kept outside head/body/clothes
        axis=[];s_acc=0; n_ax=40
        for i in range(n_ax):
            t=i/(n_ax-1)
            p=root+Vector((0,0,-L*t))+out*(0.03*math.sqrt(t))
            p=push_out(p,collide,r_out+0.004)
            axis.append(p)
        # arc-length param along the axis
        seglen=[0]+[ (axis[i]-axis[i-1]).length for i in range(1,n_ax)]
        cum=[];acc=0
        for l in seglen: acc+=l; cum.append(acc)
        total=cum[-1]
        def axis_at(sv):
            for i in range(1,n_ax):
                if cum[i]>=sv:
                    f=(sv-cum[i-1])/max(1e-6,cum[i]-cum[i-1]); return axis[i-1].lerp(axis[i],f)
            return axis[-1]
        turns=0; sv=0; rows=[]
        while sv<total:
            t=sv/total; pt=pitch*(1+0.6*t)
            ang=ph+spin*2*math.pi*(sv/pt) if False else None
            rows.append(sv); sv+=pt/10
        rows.append(total)
        theta=ph; prev=0; base=len(V)
        for k,sv in enumerate(rows):
            t=sv/total; pt=pitch*(1+0.6*t)
            if k: theta+=spin*2*math.pi*(sv-prev)/pt
            prev=sv
            A=axis_at(sv); R=Vector((math.cos(theta),math.sin(theta),0))
            ro=r_out*(1-0.35*t)*min(1,0.4+t*6)
            V+=[A+R*r_in, A+R*ro]; UV+=[(0,1-t),(1,1-t)]
            hb=max(0.0,1-t/0.3); HB+=[hb,hb]
        for k in range(len(rows)-1):
            i0=base+2*k; F.append([i0,i0+1,i0+3,i0+2])
    curls=mesh_obj("ScarletCurls",V,F,{i:uv for i,uv in enumerate(UV)})
    copy_weights(curls, head_blend=[min(1,0.4+h) for h in HB])
    extras.append((curls,"VesselHairCurls","scarlet_curl_card.png"))

# sash
sh=CFG["sash"]
if sh["kind"]=="waist":
    pel=rig.data.bones["pelvis"].head_local; c=Vector((0,pel.y,pel.z+0.06))
    v,f,uv=surface_band(c,Vector((0.0,0.08,1)).normalized(),Vector((0,0,1)),0.07,0.008)
    # hanging tail on the character's right hip
    tip=c+Vector((-0.13,-0.06,0)); tail=[];nr=[]
    for i in range(24):
        t=i/23; p=tip+Vector((-0.012*math.sin(t*3),-0.012*math.sin(t*4),-0.3*t)); p=push_out(p,BVH_ALL,0.012); tail.append(p); nr.append(Vector((-0.6,-0.8,0)).normalized())
    tv,tf,tuv=ribbon(tail,[0.06-0.03*t/23 for t in range(24)],nr)
    off=len(v); v+=tv; f+=[[off+i for i in q] for q in tf]; uv+=tuv
else:
    sp=rig.data.bones["spine_02"].head_local; c=Vector((0,sp.y,sp.z-0.02))
    v,f,uv=surface_band(c,Vector((0.55,0.0,1)).normalized(),Vector((0,0,1)),0.06,0.01,n=128,outer=True)
    # the tail falls from the low end of the diagonal band, tapering, with a soft S-sway
    low=min(v,key=lambda q:q.z); tip=low.copy(); out=Vector((low.x,low.y-0.05,0)); out=out.normalized() if out.length>1e-6 else Vector((0,-1,0))
    tail=[];nr=[]
    for i in range(28):
        t=i/27; p=tip+out*0.012+Vector((0.018*math.sin(t*3.4),-0.03*t,-0.46*t)); p=push_out(p,BVH_ALL,0.016); tail.append(p); nr.append(out)
    tv,tf,tuv=ribbon(tail,[0.06-0.022*(t/27) for t in range(28)],nr)
    off=len(v); v+=tv; f+=[[off+i for i in q] for q in tf]; uv+=tuv
sash=mesh_obj("Sash",v,f,{i:x for i,x in enumerate(uv)}); copy_weights(sash)
s=sash.modifiers.new("Solid",'SOLIDIFY'); s.thickness=0.004
extras.append((sash,"VesselCloth_Sash",None))

# jewelry: pendant + earrings (self-made gems)
def gem(center, r, name):
    bmx=bmesh.new(); bmesh.ops.create_icosphere(bmx,subdivisions=1,radius=r)
    for vv in bmx.verts: vv.co=Vector((vv.co.x,vv.co.y*0.6,vv.co.z*1.3))+center
    me=bpy.data.meshes.new(name); bmx.to_mesh(me); o=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(o); return o
neck=rig.data.bones["neck_01"].head_local
hit=BVH_ALL.ray_cast(Vector((0,-0.5,neck.z-0.09)),Vector((0,1,0)),1.0)
pend=gem(hit[0]+Vector((0,-0.008,0)),0.008,"Pendant"); copy_weights(pend)
extras.append((pend,"VesselGem",None))
for sgn in (1,-1):
    h=BVH_BODY.ray_cast(head_c+Vector((sgn*0.3,0.0,-0.035)),Vector((-sgn,0,0)),0.4)
    if h[0] is not None:
        e=gem(h[0]+Vector((sgn*0.004,0,-0.022)),0.0045,"Earring"); copy_weights(e,head_blend=[1.0]*len(e.data.vertices)); extras.append((e,"VesselGem",None))

for o in [bm]+[c[0] for c in clothes]+hairs:
    for md in o.modifiers:
        if md.type=='ARMATURE': md.show_viewport=True

# ---------------- materials ----------------
def img(name):
    p=name if os.path.isabs(name) else os.path.join(TEX,name)
    im=bpy.data.images.load(p,check_existing=True); return im
def mat(name, base=None, color=(1,1,1,1), rough=0.5, metal=0.0, normal=None, nstr=1.0, mr=None, alpha=None, blend='OPAQUE', emissive=None):
    m=bpy.data.materials.new(name); m.use_nodes=True; nt=m.node_tree; b=nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value=color; b.inputs["Roughness"].default_value=rough; b.inputs["Metallic"].default_value=metal
    if base:
        t=nt.nodes.new("ShaderNodeTexImage"); t.image=img(base); nt.links.new(t.outputs["Color"],b.inputs["Base Color"])
        if alpha: nt.links.new(t.outputs["Alpha"],b.inputs["Alpha"])
    if mr:
        t=nt.nodes.new("ShaderNodeTexImage"); t.image=img(mr); t.image.colorspace_settings.name="Non-Color"
        sp=nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(t.outputs["Color"],sp.inputs["Color"])
        nt.links.new(sp.outputs["Green"],b.inputs["Roughness"]); nt.links.new(sp.outputs["Blue"],b.inputs["Metallic"])
    if normal:
        t=nt.nodes.new("ShaderNodeTexImage"); t.image=img(normal); t.image.colorspace_settings.name="Non-Color"
        nm=nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value=nstr
        nt.links.new(t.outputs["Color"],nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"],b.inputs["Normal"])
    if alpha is not None and not base: b.inputs["Alpha"].default_value=alpha
    if blend!='OPAQUE':
        m.blend_method=blend
        if blend=='CLIP': m.alpha_threshold=0.35
    if emissive:
        b.inputs["Emission Color"].default_value=emissive; b.inputs["Emission Strength"].default_value=1.0
    return m
def set_mat(o,m):
    o.data.materials.clear(); o.data.materials.append(m)
sk=CFG["skin"]
set_mat(bm, mat("VesselSkin", base=f"{sk}_skin_albedo.jpg", normal=f"{sk}_skin_normal.jpg", nstr=0.6, mr=f"{sk}_skin_mr.jpg"))
set_mat(eyes, mat("VesselEye", base=CFG["eye"], rough=0.25, alpha=True, blend='CLIP'))
set_mat(brows, mat("VesselBrow", base=CFG["brow"], alpha=True, blend='BLEND', rough=0.8))
set_mat(lashes, mat("VesselLash", base=CFG["lash"], alpha=True, blend='BLEND', rough=0.8))
set_mat(teeth, mat("VesselTeeth", base="teeth.jpg", rough=0.3))
set_mat(tongue, mat("VesselTongue", base="tongue.jpg", rough=0.4))
for i,(h,t) in enumerate(zip(hairs,CFG["hair_tex"])):
    hn=CFG.get("hair_nrm",[None]*len(hairs))[i]
    set_mat(h, mat("VesselHair", base=t, alpha=True, blend='CLIP', rough=0.5, normal=hn, nstr=0.7))
for (o,label,tex,nrm,rough) in clothes:
    set_mat(o, mat("VesselCloth_"+label, base=tex, normal=nrm, nstr=0.8, rough=rough))
J=CFG["jewelry"]
for (o,mname,tex) in extras:
    if mname=="VesselHairCurls": set_mat(o, mat(mname, base=tex, alpha=True, blend='CLIP', rough=0.45))
    elif mname.startswith("VesselCloth"): set_mat(o, mat(mname, color=(*sh["color"],1), rough=0.6))
    else: set_mat(o, mat(mname, color=(*J["gem"],1), rough=0.05, metal=0.0))

# (no separate cornea shell: a transparent duplicate washed the iris out in three.js; the eye material carries a clearcoat instead)

# ---------------- bake: masks/subdiv into geometry, keep shape keys ----------------
sub=bm.modifiers.new("Subdivision",'SUBSURF'); sub.levels=1; sub.render_levels=1
# MPFB wants armature first, then masks, then subdiv
bpy.ops.object.select_all(action='DESELECT')
ExportService.bake_modifiers_remove_helpers(bm, bake_masks=True, bake_subdiv=True, remove_helpers=True)
def apply_all(o, types=('SUBSURF','SOLIDIFY','MASK','DECIMATE')):
    bpy.ops.object.select_all(action='DESELECT'); bpy.context.view_layer.objects.active=o; o.select_set(True)
    for md in list(o.modifiers):
        if md.type in types:
            if o.data.shape_keys: o.modifiers.remove(md); continue
            md.show_viewport=True
            if md.type=='SUBSURF': md.levels=max(md.levels,md.render_levels)
            bpy.ops.object.modifier_apply(modifier=md.name)
for o in [eyes,sash]+[c[0] for c in clothes]+hairs: apply_all(o)

# ---------------- VRM humanoid bone names ----------------
REN={"Root":"root","pelvis":"hips","spine_01":"spine","spine_02":"chest","spine_03":"upperChest","neck_01":"neck","head":"head"}
for s,S in (("l","left"),("r","right")):
    REN.update({f"clavicle_{s}":f"{S}Shoulder",f"upperarm_{s}":f"{S}UpperArm",f"lowerarm_{s}":f"{S}LowerArm",f"hand_{s}":f"{S}Hand",
                f"thigh_{s}":f"{S}UpperLeg",f"calf_{s}":f"{S}LowerLeg",f"foot_{s}":f"{S}Foot",f"ball_{s}":f"{S}Toes",
                f"thumb_01_{s}":f"{S}ThumbMetacarpal",f"thumb_02_{s}":f"{S}ThumbProximal",f"thumb_03_{s}":f"{S}ThumbDistal"})
    for fn,F in (("index","Index"),("middle","Middle"),("ring","Ring"),("pinky","Little")):
        for n,P2 in (("01","Proximal"),("02","Intermediate"),("03","Distal")): REN[f"{fn}_{n}_{s}"]=f"{S}{F}{P2}"
meshes=[o for o in bpy.data.objects if o.type=='MESH']
for o in meshes:
    for g in o.vertex_groups:
        if g.name in REN: g.name=REN[g.name]
    # drop non-bone vertex groups (helpers, body regions) to keep the GLB lean
    for g in list(o.vertex_groups):
        if g.name not in REN.values(): o.vertex_groups.remove(g)
for b in rig.data.bones:
    if b.name in REN: b.name=REN[b.name]
rig.name="VesselRig"; bm.name="VesselBody"

# ---------------- stats + export ----------------
tris=0
dg=bpy.context.evaluated_depsgraph_get()
for o in meshes:
    me=o.evaluated_get(dg).to_mesh(); me.calc_loop_triangles(); t=len(me.loop_triangles); tris+=t
    print("MESH",o.name,"tris",t,"keys",len(o.data.shape_keys.key_blocks)-1 if o.data.shape_keys else 0)
    o.evaluated_get(dg).to_mesh_clear()
print("TOTAL_TRIS",tris)
print("BONES",[b.name for b in rig.data.bones])
print("DIMS",tuple(bm.dimensions),"head",tuple(rig.data.bones["head"].tail_local))
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=False,
    export_draco_mesh_compression_enable=False, export_morph=True, export_morph_normal=True, export_skins=True,
    export_animations=False, export_yup=True, export_image_format='AUTO', export_texcoords=True, export_normals=True,
    export_tangents=False, export_extras=False, export_def_bones=False)
bpy.ops.wm.save_as_mainfile(filepath=OUT.replace(".glb",".blend"))
print("WROTE",OUT,os.path.getsize(OUT)//1024,"KB")
