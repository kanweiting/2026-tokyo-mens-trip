"""把一份「公開分享」的 Google Maps 清單併進 data/src/base_places.json（只收 trip.json city 範圍內的點）

用法：python tools/importers/gmaps_list.py <分享連結> "<顯示的清單名稱>" [分享者的成員 id]
  例：python tools/importers/gmaps_list.py https://maps.app.goo.gl/xxxx "凱的「日本👄吃」清單" kaiyu
之後跑 python tools/sync_sheet.py 產生 data/places.json（沒設定 Sheet 會直接用 base_places）。
"""
import json, math, os, re, sys, urllib.request, urllib.parse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
P = lambda *a: os.path.join(ROOT, *a)
url, LABEL, WHO = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else '')
trip = json.load(open(P('data/trip.json'), encoding='utf-8'))
CITY = {'name': '', 'center': [35.68, 139.76], 'addressKeys': [], 'radiusKm': 30, **(trip.get('city') or {})}
AREAS = json.load(open(P('data/areas.json'), encoding='utf-8'))
base_p = P('data/src/base_places.json')
base = json.load(open(base_p, encoding='utf-8')) if os.path.exists(base_p) else []

# 1. 短網址 → 清單 id → 清單內容（Google Maps 內部的 entitylist 端點，清單要設成公開）
class NoRedir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
op = urllib.request.build_opener(NoRedir)
u = url
for _ in range(6):
    m = re.search(r'placelists/list/([A-Za-z0-9_-]+)', u) or re.search(r'!2s([A-Za-z0-9_-]{20,})', u)
    if m: break
    try: u = op.open(urllib.request.Request(u, headers={'User-Agent': 'curl/8'}), timeout=20).geturl()
    except urllib.error.HTTPError as e: u = e.headers.get('Location') or ''
if not m: sys.exit('找不到清單 id：請確認連結是「分享清單」並設成公開')
lid = m.group(1)
pb = f'!1m4!1s{lid}!2e1!3m1!1e1!2e2!3e2!4i500!16b1'
raw = urllib.request.urlopen(f'https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=zh-TW&gl=tw&pb={urllib.parse.quote(pb)}', timeout=60).read().decode('utf-8')
data = json.loads(raw.split('\n', 1)[1])
items = []
for it in data[0][8] or []:
    info = it[1]; ll = info[5] or [None, None, None, None]
    items.append(dict(name=it[2], note=(it[3] if len(it) > 3 else '') or '', address=info[4] or info[2] or '', lat=ll[2], lng=ll[3], cid=(info[6] or [None, None])[1]))
print(f'清單「{data[0][4]}」共 {len(items)} 個點')

# 2. 篩城市範圍、跟既有地點去重、歸類
def norm(s): return re.sub(r'[\s\W_]+', '', re.sub(r'[（(].*?[)）]', '', str(s or '')).lower())
def dist(a, b, c, d):
    r = math.pi / 180; return 6371 * math.hypot((d - b) * r * math.cos((a + c) / 2 * r), (c - a) * r)
def area_of(lat, lng):
    if AREAS:
        best = min(AREAS, key=lambda a: dist(lat, lng, a['lat'], a['lng']))
        if dist(lat, lng, best['lat'], best['lng']) <= max(best.get('r', 1.6), 2.5): return best['name']
    return CITY['name'] + '其他'
TYPES = [('Bar/居酒屋', r'bar|バー|居酒屋|酒場|izakaya|beer|ビール|pub|club'),
         ('咖啡/甜點', r'coffee|cafe|café|カフェ|喫茶|コーヒー|bakery|パン|donut|sweets|dessert|gelato|cake|ケーキ|tea'),
         ('餐廳', r'ramen|ラーメン|拉麵|curry|カレー|食堂|焼肉|燒肉|鮨|寿司|壽司|うどん|そば|restaurant|kitchen|pizza|burger|grill|bbq')]
idx = {}
for p in base:
    for k in (norm(p['name']), norm(p.get('name_en'))):
        if len(k) >= 3: idx.setdefault(k, p)
new = merged = skip = 0
for q in items:
    inside = any(k in q['address'] for k in CITY['addressKeys']) if q['address'] and CITY['addressKeys'] else \
        (q['lat'] is not None and dist(q['lat'], q['lng'], *CITY['center']) < CITY['radiusKm'])
    if not inside or q['lat'] is None: skip += 1; continue
    p = idx.get(norm(q['name'])) or next((x for x in base if x.get('lat') and dist(x['lat'], x['lng'], q['lat'], q['lng']) < 0.03
                                         and norm(x['name'])[:4] == norm(q['name'])[:4]), None)
    if p: merged += 1
    else:
        new += 1
        t = next((t for t, rx in TYPES if re.search(rx, q['name'], re.I)), '購物')
        p = dict(id=f"g_{lid[:6]}_{new}", name=q['name'].split(' / ')[0].strip(), name_en=q['name'], type=t, subcat='', closed='', note='', price='',
                 address=q['address'], lat=q['lat'], lng=q['lng'], approx=False, map=f"https://maps.google.com/?cid={q['cid']}" if q['cid'] else None,
                 ig=[], threads=[], votes=0, voters=[], src=[], sharedBy=[], comments=[], rating=None, ratingCount=None, area=area_of(q['lat'], q['lng']))
        base.append(p); idx[norm(p['name'])] = p
    if 'gmaps' not in p['src']: p['src'].append('gmaps')
    if LABEL not in p.setdefault('lists', []): p['lists'].append(LABEL)
    if WHO and WHO not in p.setdefault('sharedBy', []): p['sharedBy'].append(WHO)
    if q['note'] and all(c.get('text') != q['note'] for c in p.setdefault('comments', [])):
        p['comments'].append(dict(src='gmaps', by=LABEL, text=q['note']))
os.makedirs(os.path.dirname(base_p), exist_ok=True)
json.dump(base, open(base_p, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(f'城市範圍內：新增 {new}、與既有地點合併 {merged}；範圍外略過 {skip}；base_places 共 {len(base)} 個')
