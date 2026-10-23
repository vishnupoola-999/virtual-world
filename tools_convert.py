import json,math
LAT,LON=18.0057650,79.5318986
R=6378137;kx=math.cos(math.radians(LAT))*math.pi/180*R;ky=math.pi/180*R
def p(lat,lon): return [round((lon-LON)*kx,1),round(-(lat-LAT)*ky,1)]  # x east, z south
d=json.load(open('data/raw.json'))
out={"center":{"lat":LAT,"lon":LON,"name":"100 Feet Road (Vaddepally Rd), Manikanta Colony, Hanamkonda, Warangal"},"buildings":[],"water":[],"labels":[],"roads":[],"areas":[],"shops":[],"parks":[]}
def h(t):
  try:
    if 'height' in t: return float(t['height'].split()[0])
  except: pass
  try:
    if 'building:levels' in t: return float(t['building:levels'])*3.2
  except: pass
  return 6+ (hash(str(t))%3)*3
for e in d['elements']:
  t=e.get('tags',{})
  if e['type']=='node':
    if 'place' in t or 'amenity' in t or 'land mark' in t:
      if t.get('name'): out['labels'].append({"p":p(e['lat'],e['lon']),"name":t['name'],"kind":t.get('place') or t.get('amenity') or 'landmark'})
      continue
    out['shops'].append({"p":p(e['lat'],e['lon']),"name":t.get('name',t.get('shop','shop'))});continue
  if e['type']=='relation':
    for m in e.get('members',[]):
      g=[p(q['lat'],q['lon']) for q in m.get('geometry',[])]
      if len(g)>2 and m.get('role')=='outer': out['water'].append({"pts":g,"name":t.get('name')})
    continue
  g=[p(q['lat'],q['lon']) for q in e.get('geometry',[])]
  if len(g)<2: continue
  if t.get('natural')=='water' or 'waterway' in t:
    out['water'].append({"pts":g,"name":t.get('name'),"line":'waterway' in t})
    if t.get('name'):
      c=[sum(a[0] for a in g)/len(g),sum(a[1] for a in g)/len(g)];out['labels'].append({"p":c,"name":t['name'],"kind":"water"})
    continue
  if 'building' in t: out['buildings'].append({"pts":g,"h":round(h(t),1),"name":t.get('name')})
  elif 'highway' in t: out['roads'].append({"pts":g,"type":t['highway'],"name":t.get('name')})
  else:
    k=t.get('leisure') or t.get('landuse');out['areas'].append({"pts":g,"type":k})
    if k in('park','garden','playground','recreation_ground','grass'):
      c=[sum(a[0] for a in g)/len(g),sum(a[1] for a in g)/len(g)];out['parks'].append({"p":c,"name":t.get('name',k)})
json.dump(out,open('data/world.json','w'),separators=(',',':'))
print({k:len(v) for k,v in out.items() if isinstance(v,list)})
