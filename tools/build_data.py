"""合併 Google Sheet 餐廳清單 + IG 群組抽出的地點 → data/places.json

用法：python tools/build_data.py <raw_dir>
  raw_dir 需包含：restaurants_raw.json（extract_sheet.py 產生）、ig_places_*.json、ig_links.json
沒有座標的地點會用 OpenStreetMap Nominatim 補（1 秒 1 筆，結果快取在 raw_dir/geocode_cache.json）。
"""
import json, glob, re, sys, time, math, os, urllib.request, urllib.parse

RAW = sys.argv[1] if len(sys.argv) > 1 else '../_raw'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'src', 'base_places.json')   # 之後跑 sync_sheet.py 套上 Sheet 最新內容 → data/places.json
AREAS = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'data', 'areas.json'), encoding='utf-8'))
CITY = {'name': '東京', 'nameEn': 'Tokyo', 'center': [35.68, 139.76], 'bbox': [35.5, 139.4, 35.9, 140.0], 'region': 'jp', **(json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'trip.json'), encoding='utf-8')).get('city') or {})}

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
    c = CITY['center']; return CITY['name'] + ('其他' if dist_km(lat, lng, c[0], c[1]) < 30 else '以外')

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
        dict(q=q, format='json', limit=1, countrycodes=CITY['region'], viewbox=f"{CITY['bbox'][1]},{CITY['bbox'][2]},{CITY['bbox'][3]},{CITY['bbox'][0]}", bounded=1))
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'tokyo-trip-planner/1.0'}), timeout=20))
        cache[q] = [float(r[0]['lat']), float(r[0]['lon'])] if r else None
    except Exception:
        cache[q] = None
    time.sleep(1.1)
    return cache[q]

# ---------- Sheet ----------
places = []
_rr = os.path.join(RAW, 'restaurants_raw.json')   # 選用：舊版 Sheet 抽取結果；新流程由 sync_sheet.py 處理 Sheet
for x in (json.load(open(_rr, encoding='utf-8')) if os.path.exists(_rr) else []):
    name = (x['name'] or '').split('\n')[0].strip() or (x['mapName'] or '').strip()
    if not name or not x['lat']: continue           # 超商、整理清單等沒有地點的列不收
    vt = x['vote'] or ''
    voters = (['eddie'] if re.search(r'[EＥ]', vt) else []) + (['aron'] if '芃' in vt else [])   # Sheet 投票欄：E＝Eddie（煊）、芃＝Aron
    votes = len(voters)
    places.append(dict(id=f"s{int(float(x['id']))}", name=name, name_en=(x['mapName'] or '').strip(),
        type=sheet_type(x['cat']), subcat=(x['cat'] or '').replace('\n', ' '), closed=x['closed'] if x['closed'] not in ('-', None) else '',
        note=(x['note'] or '').strip(), price='', lat=x['lat'], lng=x['lng'], approx=False, map=x['mapUrl'],
        ig=x['ig'], votes=votes, voters=voters, src=['sheet'], sharedBy=[], rating=None, ratingCount=None))

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

# IG／Threads 顯示名稱 → trip.json 成員 id（在成員的 aliases 列出他在 IG 上的名字，可以有好幾個）
_TRIP = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'trip.json'), encoding='utf-8'))
LIKER = os.environ.get('THREADS_OWNER') or _TRIP['members'][0]['id']   # Threads 匯出檔是誰的（成員 id）
NICK = {a: m['id'] for m in _TRIP['members'] for a in m.get('aliases', [])}
SHORT = lambda s: NICK.get(s) or next((mid for a, mid in NICK.items() if a and a in s), s)
def excerpt(cap, names):
    """從貼文文案切出跟這個地點有關的一段（約 120 字），當作「評論」顯示"""
    cap = re.sub(r'#\S+', '', cap or '')
    cap = re.sub(r'\n{2,}', '\n', cap).strip()
    if not cap: return ''
    low = cap.lower(); pos = -1
    for n in names:
        for k in filter(lambda k: len(k) >= 2, [n, re.sub(r'[（(].*', '', n or '').strip()]):
            i = low.find(k.lower())
            if i >= 0: pos = i; break
        if pos >= 0: break
    if pos >= 0 and cap.count('📍') > 2:          # 懶人包：取這個店名那一段
        seg = cap[pos:]; nxt = seg.find('📍', 1); seg = seg[:nxt if nxt > 0 else 160]
    else:
        seg = cap
    seg = re.sub(r'\s*\n\s*', ' / ', seg).strip(' /')
    return seg[:120] + ('…' if len(seg) > 120 else '')

def add_comment(p, c):
    p.setdefault('comments', [])
    if c['text'] and len(c['text']) > 6 and all(c['text'][:30] != x['text'][:30] for x in p['comments']) and len(p['comments']) < 4:
        p['comments'].append(c)

new_place = lambda q, pid, listy: dict(id=pid, name=q['name'].strip(), name_en=(q.get('name_en') or '').strip(), type=q.get('type') or '其他',
    subcat=q.get('subcat', ''), closed='', note=q.get('note', ''), price=q.get('price', ''), address=q.get('address', ''),
    hintArea=q.get('area', ''), lat=q.get('lat'), lng=q.get('lng'), approx=q.get('lat') is None, map=q.get('map'), ig=[], threads=[], votes=0, voters=[], src=[],
    sharedBy=[], rating=None, ratingCount=None, fromList=listy)
def register(p):
    places.append(p)
    for k in (norm(p['name']), norm(p['name_en'])):
        if len(k) >= 3: idx[k] = p

_il = os.path.join(RAW, 'ig_links.json')
captions = {l['url'].split('?')[0]: l for l in (json.load(open(_il, encoding='utf-8')) if os.path.exists(_il) else [])}
# subagent 從文案挑出的評論句（ig_quotes_*.json）；沒有這些檔才退回機械式摘錄
QUOTES = {}
for f in glob.glob(os.path.join(RAW, 'ig_quotes_*.json')):
    for r in json.load(open(f, encoding='utf-8')):
        QUOTES[(r['url'].split('?')[0], r['place'])] = r

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
                n_new += 1; p = new_place(q, f"i{n_new}", listy); register(p)
            if 'ig' not in p['src']: p['src'].append('ig')
            if url and url not in p['ig']: p['ig'].append(url)
            s = SHORT(sender)
            if s and s not in p['sharedBy']: p['sharedBy'].append(s)
            if not listy: p['fromList'] = False
            if not p.get('note') and q.get('note'): p['note'] = q['note']
            if not p.get('price') and q.get('price'): p['price'] = q['price']
            cap = captions.get(url, {}); by = '@' + (cap.get('owner') or 'instagram')
            if QUOTES:
                for t in QUOTES.get((url, q.get('name')), {}).get('quotes', [])[:2]:
                    add_comment(p, dict(src='ig', by=by, url=url, text=t))
            else:
                add_comment(p, dict(src='ig', by=by, url=url, text=excerpt(cap.get('caption'), [q.get('name'), q.get('name_en'), p['name'], p['name_en']])))

# ---------- Threads（自己按讚過的貼文，subagent 抽成 threads_places_*.json） ----------
n_th = 0
for f in sorted(glob.glob(os.path.join(RAW, 'threads_places_*.json'))):
    for post in json.load(open(f, encoding='utf-8')):
        url = post.get('url', '')
        for q in post.get('places', []):
            if q.get('type') == '住宿': continue
            p = find(q.get('name'), q.get('name_en'))
            if not p:
                n_new += 1; n_th += 1; p = new_place(q, f"t{n_th}", False); register(p)
            if 'threads' not in p['src']: p['src'].append('threads')
            p.setdefault('threads', [])
            if url and url not in p['threads']: p['threads'].append(url)
            if LIKER and LIKER not in p.setdefault('likedBy', []): p['likedBy'].append(LIKER)
            if not p.get('note') and q.get('note'): p['note'] = q['note']
            add_comment(p, dict(src='threads', by='@' + post.get('author', 'threads'), url=url, text=q.get('quote', '')))

# ---------- Google Maps 清單（別人推薦的「東京逛」） ----------
GM_FOOD = [('餐廳', r'拉麵|ラーメン|ramen|カレー|curry|食堂|天助|焼肉|鮨|寿司|うどん|そば|定食|restaurant|kitchen|ダイナー|pizza|burger'),
           ('咖啡/甜點', r'coffee|cafe|café|カフェ|喫茶|コーヒー|bakery|パン|donut|ドーナツ|tea|甜'),
           ('Bar/居酒屋', r'bar|バー|居酒屋|酒|club|womb|beer|ビール')]
n_gm = 0
gm_p = os.path.join(RAW, 'gm_list.json')   # 選用：tools/importers/gmaps_list.py 也可以直接併進 base_places
for q in (json.load(open(gm_p, encoding='utf-8')) if os.path.exists(gm_p) else []):
    p = find(q['name'], '')
    if not p and q.get('lat'):
        near = [x for x in places if x['lat'] and dist_km(x['lat'], x['lng'], q['lat'], q['lng']) < 0.04]
        p = near[0] if near else None
    if not p:
        n_gm += 1
        t = next((t for t, rx in GM_FOOD if re.search(rx, q['name'], re.I)), '購物')
        cid = (q.get('cid') or [None, None])[1]
        p = new_place(dict(name=q['name'].split(' / ')[0], name_en=q['name'], type=t, subcat='選物／古著' if t == '購物' else '', address=q.get('address', ''),
            lat=q.get('lat'), lng=q.get('lng'), map=f'https://maps.google.com/?cid={cid}' if cid else None), f"g{n_gm}", False)
        p['approx'] = not q.get('lat'); register(p)
    if 'gmaps' not in p['src']: p['src'].append('gmaps')
    if q.get('note'): add_comment(p, dict(src='gmaps', by='東京逛清單', text=q['note']))

# Sheet 的備註也放進評論區最前面
for p in places:
    if 'sheet' in p['src'] and p.get('note') and p['note'] not in ('詳影片',):
        p.setdefault('comments', []).insert(0, dict(src='sheet', by='我們的 Sheet', text=re.sub(r'\s*\n\s*', ' / ', p['note'])[:160]))
    p['comments'] = p.get('comments', [])[:4]
print(f'Threads 新增 {n_th}，Google Maps 清單新增 {n_gm}')

# ---------- 補座標 ----------
todo = [p for p in places if p['lat'] is None]
print(f'IG 地點 {n_ig}，新增 {n_new}，待補座標 {len(todo)}')
for i, p in enumerate(todo):
    for q in filter(None, [p.get('address'), p['name_en'] and p['name_en'] + ' ' + CITY['nameEn'], p['name']]):
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
