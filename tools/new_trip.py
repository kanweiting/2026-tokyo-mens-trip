"""新旅程初始化：讀 setup.json（參考 setup.example.json）→ 產生 data/trip.json、config.js、manifest、網頁標題

用法：python tools/new_trip.py setup.json
- city 可以寫 "preset": "tokyo"，會套用 presets/tokyo 的城市座標、區域、幣別、待辦清單；也可以全部自己寫
- 不會動到 data/places.json 等地點資料；要清空舊地點請加 --reset-places
"""
import json, os, re, sys, datetime, shutil

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
P = lambda *a: os.path.join(ROOT, *a)
if len(sys.argv) < 2: sys.exit(__doc__)
S = json.load(open(sys.argv[1], encoding='utf-8'))
need = ['title', 'members', 'city', 'currency']
miss = [k for k in need if not S.get(k)] + ([] if S.get('dates') or (S.get('start') and S.get('end')) else ['dates（或 start＋end）'])
if miss: sys.exit('setup.json 缺少：' + '、'.join(miss))

# 日期
if not S.get('dates'):
    d0, d1 = datetime.date.fromisoformat(S['start']), datetime.date.fromisoformat(S['end'])
    S['dates'] = [str(d0 + datetime.timedelta(n)) for n in range((d1 - d0).days + 1)]
WD = '一二三四五六日'
md = lambda d: f"{int(d[5:7])}/{int(d[8:])}（{WD[datetime.date.fromisoformat(d).weekday()]}）"

# 城市：preset ＋ 覆寫
city = dict(S['city']); preset = city.pop('preset', None); todo = None
if preset:
    pd = P('presets', preset)
    if not os.path.isdir(pd): sys.exit(f'找不到 presets/{preset}')
    pc = json.load(open(os.path.join(pd, 'city.json'), encoding='utf-8'))
    city = {**pc['city'], **city}
    S['currency'] = {**pc.get('currency', {}), **S['currency']}
    todo = pc.get('todoTemplate')
    shutil.copy(os.path.join(pd, 'areas.json'), P('data', 'areas.json'))
elif not os.path.exists(P('data', 'areas.json')):
    json.dump([], open(P('data', 'areas.json'), 'w', encoding='utf-8'))
for k in ['name', 'nameEn', 'center', 'bbox', 'region']:
    if k not in city: sys.exit(f'city 缺少 {k}（或改用 "preset"）')

# 成員
ids = set()
for m in S['members']:
    if not re.fullmatch(r'[a-z0-9_]+', m.get('id', '')): sys.exit(f'成員 id 只能用小寫英數：{m}')
    if m['id'] in ids: sys.exit(f'成員 id 重複：{m["id"]}')
    ids.add(m['id']); m.setdefault('name', m['id']); m.setdefault('aliases', [])

trip = {
    'title': S['title'], 'short': S.get('short') or S['title'][:12],
    'subtitle': S.get('subtitle') or f"{md(S['dates'][0])} – {md(S['dates'][-1])}",
    'eyebrow': S.get('eyebrow') or f"{city['nameEn']} · {len(S['members'])} people",
    'dates': S['dates'], 'baseCurrency': S['currency']['local'],
    'fx': {S['currency']['home']: S.get('fxFallback', 1)},   # 沒有 fxDaily 時的固定匯率：1 本國貨幣 = ? 當地貨幣
    'members': S['members'], 'flights': S.get('flights', []),
    'lodging': {'name': '住宿', 'address': '', 'lat': None, 'lng': None, 'checkin': S['dates'][0], 'checkout': S['dates'][-1], **(S.get('lodging') or {})},
    'days': {d: [] for d in S['dates']}, 'wishlists': {},
    'city': city, 'currency': S['currency'],
    'sheet': S.get('sheet') or {},
}
if S.get('todoTemplate') or todo: trip['todoTemplate'] = S.get('todoTemplate') or todo
if S.get('days'): trip['days'].update(S['days'])
old = P('data', 'trip.json')
if os.path.exists(old):
    o = json.load(open(old, encoding='utf-8'))
    if o.get('fxDaily') and set(o['fxDaily']) & set(S['dates']): trip['fxDaily'] = o['fxDaily']
json.dump(trip, open(old, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

# config.js：五人同步的 Apps Script 網址（空白＝只存在各自手機）
cfg = open(P('config.js'), encoding='utf-8').read()
cfg = re.sub(r"sheetApi: '[^']*'", f"sheetApi: '{S.get('sheetApi', '')}'", cfg)
open(P('config.js'), 'w', encoding='utf-8').write(cfg)

# manifest＋網頁標題（加到主畫面時顯示的名字）
home = S.get('homeScreenName') or trip['short']
mf = json.load(open(P('manifest.webmanifest'), encoding='utf-8')); mf['name'] = trip['title']; mf['short_name'] = home
json.dump(mf, open(P('manifest.webmanifest'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
html = open(P('index.html'), encoding='utf-8').read()
html = re.sub(r'<title>[^<]*</title>', f'<title>{trip["short"]}</title>', html)
html = re.sub(r'(name="apple-mobile-web-app-title" content=")[^"]*', r'\g<1>' + home, html)
html = re.sub(r'(name="application-name" content=")[^"]*', r'\g<1>' + home, html)
open(P('index.html'), 'w', encoding='utf-8').write(html)

if '--reset-places' in sys.argv:
    os.makedirs(P('data', 'src'), exist_ok=True)
    for f, v in [('data/places.json', []), ('data/src/base_places.json', []), ('data/sheet_plan.json', {'days': {}, 'wish': {}})]:
        json.dump(v, open(P(f), 'w', encoding='utf-8'))
print(f"✓ {trip['title']}｜{trip['subtitle']}｜{len(S['members'])} 人｜{city['name']}｜{S['currency']['local']}→{S['currency']['home']}｜同步：{'有' if S.get('sheetApi') else '無（只存手機）'}")
print('下一步：python tools/sync_sheet.py（產生 data/places.json）→ python tools/verify_smoke.py → git push')
