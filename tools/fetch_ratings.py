"""用 Google Places API (New) 幫 data/places.json 補評分；只需出發前跑一次。

用法：GOOGLE_PLACES_KEY=xxx python tools/fetch_ratings.py
每個地點 1 次 Text Search（約 US$0.032/次；Google 每月有免費額度）。結果直接寫回 places.json。
"""
import json, os, sys, time, urllib.request

KEY = os.environ.get('GOOGLE_PLACES_KEY') or sys.exit('請先設定 GOOGLE_PLACES_KEY')
P = os.path.join(os.path.dirname(__file__), '..', 'data', 'places.json')
places = json.load(open(P, encoding='utf-8'))
for i, p in enumerate(places):
    if p.get('rating') is not None or p['type'] == '購物' and not p.get('name_en'): continue
    body = {'textQuery': (p.get('name_en') or p['name']) + ' Tokyo', 'languageCode': 'zh-TW', 'maxResultCount': 1}
    if p.get('lat'):
        body['locationBias'] = {'circle': {'center': {'latitude': p['lat'], 'longitude': p['lng']}, 'radius': 800}}
    req = urllib.request.Request('https://places.googleapis.com/v1/places:searchText', json.dumps(body).encode(), {
        'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask': 'places.rating,places.userRatingCount,places.location,places.googleMapsUri,places.priceLevel'})
    try:
        r = (json.load(urllib.request.urlopen(req, timeout=20)).get('places') or [None])[0]
    except Exception as e:
        print('失敗', p['name'], e); continue
    if r:
        p['rating'], p['ratingCount'] = r.get('rating'), r.get('userRatingCount')
        if p.get('approx') and r.get('location'):
            p['lat'], p['lng'], p['approx'] = r['location']['latitude'], r['location']['longitude'], False
        p['map'] = p.get('map') or r.get('googleMapsUri')
    print(i, p['name'], p.get('rating'))
    time.sleep(0.1)
json.dump(places, open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
