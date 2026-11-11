import json,struct,sys,collections
f=open(sys.argv[1],'rb').read(); n=struct.unpack('<I',f[12:16])[0]; j=json.loads(f[20:20+n])
bv=j['bufferViews']; acc=j['accessors']; use=collections.Counter()
seen=set()
for m in j['meshes']:
    for p in m['primitives']:
        for k,a in p['attributes'].items():
            i=acc[a].get('bufferView'); 
            if i is not None and i not in seen: seen.add(i); use['attr_'+k]+=bv[i]['byteLength']
        if 'indices' in p:
            i=acc[p['indices']]['bufferView']
            if i not in seen: seen.add(i); use['indices']+=bv[i]['byteLength']
        for t in p.get('targets',[]):
            for k,a in t.items():
                A=acc[a]; i=A.get('bufferView')
                if i is not None and i not in seen: seen.add(i); use['morph_'+k]+=bv[i]['byteLength']
                if 'sparse' in A:
                    for part in ('indices','values'):
                        i=A['sparse'][part]['bufferView']
                        if i not in seen: seen.add(i); use['morph_sparse_'+k]+=bv[i]['byteLength']
for im in j.get('images',[]):
    i=im['bufferView']; seen.add(i); use['img:'+im.get('name','?')]+=bv[i]['byteLength']
rest=sum(b['byteLength'] for k,b in enumerate(bv) if k not in seen); use['other']+=rest
for k,v in use.most_common(): print(f"{v/1024/1024:7.2f} MB  {k}")
print("total", len(f)/1024/1024)
