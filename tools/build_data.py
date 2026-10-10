"""合併 Google Sheet 餐廳清單 + IG 群組抽出的地點 → data/places.json

用法：python tools/build_data.py <raw_dir>
  raw_dir 需包含：restaurants_raw.json（extract_sheet.py 產生）、ig_places_*.json、ig_links.json
沒有座標的地點會用 OpenStreetMap Nominatim 補（1 秒 1 筆，結果快取在 raw_dir/geocode_cache.json）。
"""
import json, glob, re, sys, time, math, os, urllib.request, urllib.parse

RAW = sys.argv[1] if len(sys.argv) > 1 else '../_raw'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'places.json')
AREAS = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'data', 'areas.json'), encoding='utf-8'))

TYPE_RULES = [  # 依序比對 Sheet 的「餐廳類型」
    ('Bar/居酒屋', r'bar|居酒屋'),
    ('咖啡/甜點', r'咖啡|甜點|飲料|麵包|抹茶|早午餐'),
    ('購物', r'超商|伴手禮'),
]

def sheet_type(cat):
    c = (cat or '').lower()
    for t, rx in TYPE_RULES:
        if re.search(rx, c): return t
    return '餐廳'

def norm(s):
    s = re.sub(r'[（(].*?[)）]', '', str(s or '')).lower()
    return re.sub(r'[\s\W_]+', '', s)

def dist_km(a, b, c, d):
    r = math.pi / 180
    x = (d - b) * r * math.cos((a + c) / 2 * r); y = (c - a) * r
    return 6371 * math.hypot(x, y)

def area_of(lat, lng):
    best = min(AREAS, key=lambda a: dist_km(lat, lng, a['lat'], a['lng']))
    d = dist_km(lat, lng, best['lat'], best['lng'])
    if d <= max(best.get('r', 1.6), 2.5): return best['name']   # 「一帶」即可，不必在圈內
    return '東京其他' if dist_km(lat, lng, 35.68, 139.76) < 30 else '東京以外'

def area_alias(a):
    a = (a or '').strip()
    for ar in AREAS:
        if a and (a == ar['name'] or any(k in a for k in ar.get('alias', []) + ar['name'].split('/'))):
            return ar
    return None

cache_p = os.path.join(RAW, 'geocode_cache.json')
cache = json.load(open(cache_p, encoding='utf-8')) if os.path.exists(cache_p) else {}
def geocode(q):
    if q in cache: return cache[q]
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        dict(q=q, format='json', limit=1, countrycodes='jp', viewbox='139.4,35.9,140.0,35.5', bounded=1))
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'tokyo-trip-planner/1.0'}), timeout=20))
        cache[q] = [float(r[0]['lat']), float(r[0]['lon'])] if r else None
    except Exception:
        cache[q] = None
    time.sleep(1.1)
    return cache[q]

# ---------- Sheet ----------
places = []
for x in json.load(open(os.path.join(RAW, 'restaurants_raw.json'), encoding='utf-8')):
    name = (x['name'] or '').split('\n')[0].strip() or (x['mapName'] or '').strip()
    if not name or not x['lat']: continue           # 超商、整理清單等沒有地點的列不收
    votes = len(re.findall(r'[EＥ]', x['vote'] or ''))
    places.append(dict(id=f"s{int(float(x['id']))}", name=name, name_en=(x['mapName'] or '').strip(),
        type=sheet_type(x['cat']), subcat=(x['cat'] or '').replace('\n', ' '), closed=x['closed'] if x['closed'] not in ('-', None) else '',
        note=(x['note'] or '').strip(), price='', lat=x['lat'], lng=x['lng'], approx=False, map=x['mapUrl'],
        ig=x['ig'], votes=votes, voters=['Eddie'] * votes, src=['sheet'], sharedBy=[], rating=None, ratingCount=None))

# ---------- IG ----------
idx = {}
for p in places:
    for k in (norm(p['name']), norm(p['name_en'])):
        if len(k) >= 3: idx[k] = p
def find(n1, n2):
    for k in (norm(n1), norm(n2)):
        if len(k) < 3: continue
        if k in idx: return idx[k]
        for kk, p in idx.items():
            if len(kk) >= 5 and len(k) >= 5 and (kk in k or k in kk): return p
    return None

NICK = {'Jerry Kan': 'Jerry', 'Aron Lin': 'Aron', 'Chung Kai Yu': 'Kaiyu', '盅舖師': 'Wei'}
SHORT = lambda s: NICK.get(s, 'Eddie' if 'Eddie' in s or '𝑬𝒅𝒅𝒊𝒆' in s else s)
n_ig = 0; n_new = 0
for f in sorted(glob.glob(os.path.join(RAW, 'ig_places_*.json'))):
    for post in json.load(open(f, encoding='utf-8')):
        sender = post.get('sender', '')
        url = (post.get('url') or '').split('?')[0]
        listy = len(post.get('places', [])) > 20     # 「72 間必吃」這種懶人包
        for q in post.get('places', []):
            n_ig += 1
            if q.get('type') == '住宿': continue
            p = find(q.get('name'), q.get('name_en'))
            if not p:
                n_new += 1
                p = dict(id=f"i{n_new}", name=q['name'].strip(), name_en=(q.get('name_en') or '').strip(), type=q.get('type') or '其他',
                    subcat=q.get('subcat', ''), closed='', note=q.get('note', ''), price=q.get('price', ''), address=q.get('address', ''),
                    hintArea=q.get('area', ''), lat=None, lng=None, approx=True, map=None, ig=[], votes=0, voters=[], src=[], sharedBy=[],
                    rating=None, ratingCount=None, fromList=listy)
                places.append(p)
                for k in (norm(p['name']), norm(p['name_en'])):
                    if len(k) >= 3: idx[k] = p
            if 'ig' not in p['src']: p['src'].append('ig')
            if url and url not in p['ig']: p['ig'].append(url)
            s = SHORT(sender)
            if s and s not in p['sharedBy']: p['sharedBy'].append(s)
            if not listy: p['fromList'] = False
            if not p.get('note') and q.get('note'): p['note'] = q['note']
            if not p.get('price') and q.get('price'): p['price'] = q['price']

# ---------- 補座標 ----------
todo = [p for p in places if p['lat'] is None]
print(f'IG 地點 {n_ig}，新增 {n_new}，待補座標 {len(todo)}')
for i, p in enumerate(todo):
    for q in filter(None, [p.get('address'), p['name_en'] and p['name_en'] + ' Tokyo', p['name']]):
        ll = geocode(q)
        ar = area_alias(p.get('hintArea'))
        if ll and ar and dist_km(ll[0], ll[1], ar['lat'], ar['lng']) > 3:
            ll = None   # 跟貼文寫的區域對不上 → 多半找錯同名店，不採用
        if ll:
            p['lat'], p['lng'] = ll; p['approx'] = False; break
    if p['lat'] is None:
        ar = area_alias(p.get('hintArea'))
        if ar:   # 只知道區域 → 放在區域中心附近，標成約略位置
            j = (hash(p['name']) % 1000) / 1000 * 2 * math.pi
            p['lat'], p['lng'] = ar['lat'] + 0.003 * math.sin(j), ar['lng'] + 0.004 * math.cos(j)
    if i % 20 == 0:
        json.dump(cache, open(cache_p, 'w', encoding='utf-8'), ensure_ascii=False)
json.dump(cache, open(cache_p, 'w', encoding='utf-8'), ensure_ascii=False)

for p in places:
    if p['lat'] is not None:
        p['area'] = area_of(p['lat'], p['lng'])
        ar = area_alias(p.get('hintArea'))
        if p['approx'] and ar: p['area'] = ar['name']
    else:
        p['area'] = '未定位'
    p.pop('hintArea', None)
    p['lat'] = round(p['lat'], 6) if p['lat'] else None
    p['lng'] = round(p['lng'], 6) if p['lng'] else None

json.dump(places, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
from collections import Counter
print('總數', len(places), Counter(p['type'] for p in places))
print(Counter(p['area'] for p in places).most_common())
print('約略位置', sum(p['approx'] for p in places), '未定位', sum(p['lat'] is None for p in places))
