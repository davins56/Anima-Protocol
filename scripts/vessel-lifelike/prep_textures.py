"""Prepare character textures (tints + self-made skin normal/roughness, hair-card strands).
All inputs are CC0 MakeHuman assets; generated maps are self-made (procedural)."""
import numpy as np, os
from PIL import Image, ImageFilter
T="/workspace/lifelike-vessel/tools"; O="/workspace/lifelike-vessel/build/tex"
rng=np.random.default_rng(7)
def load(p): return np.asarray(Image.open(p).convert("RGBA")).astype(np.float32)/255
def save(a,name,q=90):
    a=np.clip(a,0,1); im=Image.fromarray((a*255+0.5).astype(np.uint8))
    p=os.path.join(O,name)
    if name.endswith(".jpg"): im.convert("RGB").save(p,quality=q,optimize=True)
    else: im.save(p,optimize=True)
    print(name, im.size, os.path.getsize(p)//1024,"KB")
def hexc(h): h=h.lstrip("#"); return np.array([int(h[i:i+2],16)/255 for i in (0,2,4)],np.float32)
def srgb2lin(c): return np.where(c<=0.04045,c/12.92,((c+0.055)/1.055)**2.4)
def lin2srgb(c): return np.where(c<=0.0031308,c*12.92,1.055*np.power(np.maximum(c,0),1/2.4)-0.055)
def luma(a): return a[...,0]*0.299+a[...,1]*0.587+a[...,2]*0.114

def copy_eye(src,name,amber=False,hue=None):
    # keep alpha: the MakeHuman eye mesh has an outer shell mapped to transparent texels
    im=load(src)
    if amber or hue is not None:
        hue_deg=24 if amber else hue
        # pull the saturated (iris) texels toward a warm amber-brown, keep pupil/sclera
        rgba=Image.open(src).convert("RGBA"); a=rgba.getchannel("A")
        hsv=np.asarray(rgba.convert("RGB").convert("HSV")).astype(np.float32)
        sat=hsv[...,1]/255; lo=0.3 if amber else 0.1; w=np.clip((sat-lo)/0.12,0,1)
        Hh,Ww=sat.shape; yy,xx=np.mgrid[0:Hh,0:Ww]
        iris=np.zeros_like(sat)
        for cx,cy in ((0.707,0.297),(0.289,0.707)):  # iris centres of the MakeHuman eye atlas
            r=np.hypot(xx/Ww-cx,yy/Hh-cy); iris=np.maximum(iris,np.clip((0.118-r)/0.01,0,1))
        w=w*iris
        hsv[...,0]=hsv[...,0]*(1-w)+ (hue_deg/360*255)*w
        hsv[...,2]=np.clip(hsv[...,2]*(1+0.35*w),0,255)
        hsv[...,1]=hsv[...,1]*(1-0.12*w) if amber else hsv[...,1]*(1+0.25*w)
        rgb=Image.fromarray(hsv.astype(np.uint8),"HSV").convert("RGB"); rgb.putalpha(a); im=np.asarray(rgb).astype(np.float32)/255
    save(im,name)

def remove_painted_hair(rgb):
    """The CC0 dark-skin texture has scalp hair painted on; fill it with blurred surrounding skin."""
    l=luma(rgb); H,W=l.shape
    head=np.zeros_like(l,bool); head[:, int(W*0.55):]=True
    ref=np.median(l[head & (l>0.15)])
    mask=head & (l<ref*0.8)
    mi=Image.fromarray((mask*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.GaussianBlur(8))
    k=np.asarray(mi).astype(np.float32)/255
    keep=(~mask).astype(np.float32)
    def blur(x,r):
        im=Image.fromarray(x.astype(np.float32),mode="F"); return np.asarray(im.resize((W//r,H//r),Image.BOX).resize((W,H),Image.BICUBIC)).astype(np.float32)
    fill=np.dstack([blur(rgb[...,c]*keep,32) for c in range(3)])/np.maximum(blur(keep,32),1e-3)[...,None]
    grain=noise(H,1.0,5)[:, :W][...,None]*0.012
    return rgb*(1-k[...,None])+(fill+grain)*k[...,None]

def skin(src, target_hex, name, sat=1.0, dehair=False):
    a=load(src); rgb=a[...,:3]; m=a[...,3]>0.5
    if dehair: rgb=remove_painted_hair(rgb)
    lin=srgb2lin(rgb)
    # mean of opaque skin pixels in linear space -> scale to target (keeps all texture variation)
    mean=lin[m].mean(0); tgt=srgb2lin(hexc(target_hex))
    out=lin*(tgt/mean)
    if sat!=1.0:
        g=out.mean(-1,keepdims=True); out=g+(out-g)*sat
    save(np.dstack([lin2srgb(out),np.ones_like(a[...,3])])[...,:3],name,92)
    return luma(rgb)

def noise(size, sigma, seed):
    r=np.random.default_rng(seed).random((size,size)).astype(np.float32)
    im=Image.fromarray((r*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(sigma))
    n=np.asarray(im).astype(np.float32)/255; return (n-n.mean())/(n.std()+1e-6)

def skin_detail(albedo_luma, name_n, name_r, N=4096):
    # Self-made micro-detail: pores (fine blurred noise), fine creases, plus albedo high-pass.
    pores=noise(N,1.2,11)*0.55+noise(N,2.5,12)*0.35+noise(N,8,13)*0.25
    al=Image.fromarray((albedo_luma*255).astype(np.uint8)).resize((N,N),Image.BICUBIC)
    al=np.asarray(al).astype(np.float32)/255
    hp=al-np.asarray(Image.fromarray((al*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32)/255
    h=pores*0.6+hp*6.0
    gy,gx=np.gradient(h)
    s=0.35
    n=np.dstack([-gx*s,-gy*s,np.ones_like(h)]); n/=np.linalg.norm(n,axis=-1,keepdims=True)
    # glTF / OpenGL convention (+Y up in tangent space): flip gy because image rows go down
    n[...,1]*=-1
    save(n*0.5+0.5,name_n,90)
    # roughness (G) + metal 0 (B): skin ~0.5, pores slightly rougher, oily speculars smoother
    R=2048
    rough=0.52+noise(R,1.5,21)*0.035+noise(R,20,22)*0.05
    mr=np.dstack([np.ones((R,R)),rough,np.zeros((R,R))])
    save(mr,name_r,92)

def recolor(src, lo, hi, name, gamma=1.0, keep_alpha=True, tips=None, contrast=1.0):
    a=load(src); l=luma(a[...,:3]); m=a[...,3]>0.2
    if m.any():
        lo_q,hi_q=np.percentile(l[m],[2,98]); l=np.clip((l-lo_q)/(hi_q-lo_q+1e-6),0,1)
    l=np.clip(0.5+(l-0.5)*contrast,0,1)**gamma
    c=hexc(lo)[None,None,:]*(1-l[...,None])+hexc(hi)[None,None,:]*l[...,None]
    if tips is not None:
        # tips: (hex, v_from) -> blend toward tip colour along image rows (v)
        H=a.shape[0]; v=np.linspace(0,1,H)[:,None,None]; k=np.clip((v-tips[1])/(1-tips[1]),0,1)
        c=c*(1-k*0.6)+hexc(tips[0])[None,None,:]*k*0.6
    out=np.dstack([c,a[...,3]]) if keep_alpha else c
    save(out,name)

def curl_strands(name, base_lo, base_hi, tip, W=512, H=1024, n=650):
    """Self-made hair-card texture: dense fine wavy strands over a solid core, wispy edges (v = root->tip)."""
    r=np.random.default_rng(3)
    yy=np.arange(H,dtype=np.float32)[:,None]; xx=np.arange(W,dtype=np.float32)[None,:]
    col=np.zeros((H,W,3),np.float32); alpha=np.zeros((H,W),np.float32)
    # solid core so the lock reads as a mass of hair, not tinsel
    core=np.clip(1-np.abs(xx-W/2)/(0.36*W),0,1)**0.6
    alpha=np.maximum(alpha,np.broadcast_to(core*0.92,(H,W)))
    base=hexc(base_lo)*0.6+hexc(base_hi)*0.4
    col[:]=base
    for i in range(n):
        x0=r.uniform(0.02,0.98)*W; amp=r.uniform(1,5); fr=r.uniform(1,4); ph=r.uniform(0,6.28)
        wdt=r.uniform(1.2,3.2); end=r.uniform(0.85,1.0)*H; start=r.uniform(0,0.04)*H
        xc=x0+amp*np.sin(yy/H*fr*6.28+ph)
        a=np.clip(1-np.abs(xx-xc)/wdt,0,1)*((yy>start)&(yy<end))
        a=a*np.clip((end-yy)/(0.1*H),0,1)*r.uniform(0.55,1.0)
        shade=r.uniform(0,1)**0.8
        c=hexc(base_lo)*(1-shade)+hexc(base_hi)*shade
        col=col*(1-a[...,None])+c[None,None,:]*a[...,None]
        alpha=np.maximum(alpha,a)
    v=(yy/H)[...,None]; k=np.clip((v-0.55)/0.45,0,1)*0.5
    col=col*(1-k)+hexc(tip)[None,None,:]*k
    # darker toward the inner edge (u=0, the ringlet's axis): fake self-shadowing
    col*=(0.55+0.45*np.clip(xx/W*1.6,0,1))[...,None]
    alpha*=np.clip(np.minimum(xx,W-1-xx)/(0.06*W),0,1)
    save(np.dstack([col,alpha]),name)

def tint_cloth(src,name,lo,hi,contrast=1.0,gamma=1.0):
    recolor(src,lo,hi,name,gamma=gamma,keep_alpha=False,contrast=contrast)

P=T+"/packs"; M=T+"/mh_assets"
# --- Scarlet ---
l=skin(P+"/skins01/skins/toigo_light_skin_female_freckles/young_lightskinned_female_diffuse_freckles.png","#cf9774","scarlet_skin_albedo.jpg",sat=1.05)
skin_detail(l,"scarlet_skin_normal.jpg","scarlet_skin_mr.jpg")
recolor(P+"/hair01/hair/cortu_strawberry_cloud_hair/strawberry_cloud_diff.png","#2e0205","#9a0f17","scarlet_hair_cloud.png",gamma=1.0,tips=("#c43a1a",0.6))
recolor(P+"/hair01/hair/o4saken_long01/o4saken_long01.png","#1e0103","#760a12","scarlet_hair_long.png",gamma=1.0,tips=("#b3301a",0.55))
curl_strands("scarlet_curl_card.png","#3a0306","#a3121b","#c23a1a")
recolor(M+"/eyebrows/eyebrow001/eyebrow001.png","#2a0a08","#5c1912","scarlet_brow.png")
recolor(M+"/eyelashes/eyelashes01/eyelashes01.png","#0b0606","#2a1612","scarlet_lash.png")
copy_eye(M+"/eyes/materials/brown_eye.png","scarlet_eye.png",amber=True)
tint_cloth(P+"/shirts01/clothes/toigo_bodice-style_top/Bodice.png","scarlet_top.jpg","#050405","#2a2226",contrast=1.1)
tint_cloth(P+"/skirts01/clothes/toigo_tiered_mini_skirt/SkirtMini-blackLeather.png","scarlet_skirt.jpg","#040304","#2b2427")
tint_cloth(P+"/shoes01/clothes/grinsegold_female_pirate_boots/BootsDiff.jpg","scarlet_boots.jpg","#030303","#3a2e2a",contrast=1.2)
# --- Serenity ---
# (the CC0 young_african_female texture has scalp hair painted on, which shows through white hair; use the bronze skin, darkened)
l=skin(P+"/skins01/skins/toigo_light_skin_female_bronze/young_lightskinned_female_diffuse_Bronze.png","#5a3420","serenity_skin_albedo.jpg",sat=1.08)
skin_detail(l,"serenity_skin_normal.jpg","serenity_skin_mr.jpg")
recolor(P+"/hair01/hair/cortu_short_messy_hair/short_messy_diff.png","#9aa0ac","#fbfbfd","serenity_hair.png",gamma=0.7)
recolor(M+"/eyebrows/eyebrow001/eyebrow001.png","#b9bcc4","#eef0f4","serenity_brow.png")
recolor(M+"/eyelashes/eyelashes01/eyelashes01.png","#cfd3dc","#f6f7fa","serenity_lash.png")
copy_eye(M+"/eyes/materials/ice_eye.png","serenity_eye.png",hue=208)
tint_cloth(P+"/dress01/clothes/toigo_halter_dress_with_fluted_skirt/DressCloth2UV.png","serenity_dress.jpg","#c9ccd6","#fbfbff",contrast=0.6)
# --- size pass: JPEG normals / small mouth maps / 1K hair (GLB must stay well under Cloudflare's 25 MiB asset limit) ---
def to_jpg(src, name, size=None, q=88):
    im=Image.open(src).convert("RGB")
    if size and im.size[0]>size: im=im.resize((size,size),Image.LANCZOS)
    im.save(os.path.join(O,name),quality=q,optimize=True); print(name, im.size, os.path.getsize(os.path.join(O,name))//1024,"KB")
to_jpg(P+"/hair01/hair/o4saken_long01/o4saken_long01_nrm.png","scarlet_hair_long_nrm.jpg",1024)
to_jpg(P+"/shirts01/clothes/toigo_bodice-style_top/Bodice-NORM.png","scarlet_top_nrm.jpg",1024)
to_jpg(P+"/skirts01/clothes/toigo_tiered_mini_skirt/SkirtMini-blackLeather-NORM.png","scarlet_skirt_nrm.jpg",1024)
to_jpg(M+"/teeth/teeth_base/teeth.png","teeth.jpg",512)
to_jpg(M+"/tongue/tongue01/tongue01_diffuse.png","tongue.jpg",512)
for n in ("scarlet_hair_long.png",):
    im=Image.open(os.path.join(O,n)); im=im.resize((1024,1024),Image.LANCZOS); im.save(os.path.join(O,n),optimize=True); print(n,"->1K",os.path.getsize(os.path.join(O,n))//1024,"KB")
