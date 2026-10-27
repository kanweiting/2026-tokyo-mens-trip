"""從 Threads 匯出檔（liked_threads.json，只有網址沒有內文）抓回每則貼文的文字，篩出跟目的地有關的

用法：python tools/importers/threads_likes.py <Threads 匯出的 zip 或資料夾> <輸出資料夾> "<關鍵字正規式>"
  例：python tools/importers/threads_likes.py threads-xxx.zip _raw "東京|日本|Tokyo|澀谷|新宿|銀座"
輸出：threads_posts.json（全部，含已刪除）、th_batch_*.json（跟目的地有關、分批給 Claude 抽地點）
做法：用公開的 /embed 頁面讀文字（同時 4 條連線，2,900 則約 10 分鐘；中斷可重跑，會接續）
"""
import json, os, re, sys, html, zipfile, tempfile, glob, datetime, urllib.request, concurrent.futures as cf

src, out_dir, kw = sys.argv[1], sys.argv[2], sys.argv[3]
if src.endswith('.zip'):
    tmp = tempfile.mkdtemp(); zipfile.ZipFile(src).extractall(tmp); src = tmp
f = glob.glob(os.path.join(src, '**', 'liked_threads.json'), recursive=True)
if not f: sys.exit('找不到 liked_threads.json（匯出時要勾「Threads」的按讚紀錄）')
likes = json.load(open(f[0], encoding='utf-8'))
likes = likes[next(iter(likes))] if isinstance(likes, dict) else likes
os.makedirs(out_dir, exist_ok=True)
OUT = os.path.join(out_dir, 'threads_posts.json')
done = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
def get(x):
    d = x['string_list_data'][0]; u = d['href'].split('?')[0]
    if u in done and not done[u]['text'].startswith('ERR'): return u, done[u]
    try:
        t = urllib.request.urlopen(urllib.request.Request(u + '/embed', headers={'User-Agent': 'Mozilla/5.0'}), timeout=25).read().decode('utf-8', 'ignore')
        txt = html.unescape(re.sub(r'\s+', ' ', re.sub('<[^>]+>', ' \n', re.sub(r'<(script|style)[\s\S]*?</\1>', '', t)))).strip()
        txt = re.sub(r'^Threads\s+', '', txt)
    except Exception as e: txt = 'ERR ' + str(e)
    return u, dict(author=x.get('title', ''), ts=datetime.datetime.fromtimestamp(d['timestamp']).isoformat(timespec='minutes'), text=txt[:3000])
with cf.ThreadPoolExecutor(4) as ex:
    for i, (u, r) in enumerate(ex.map(get, likes)):
        done[u] = r
        if i % 100 == 0: json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False); print(i, flush=True)
json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
rel = [dict(url=u, author=v['author'], ts=v['ts'], text=re.sub(r'\s*View on Threads.*$', '', v['text'])[:1800])
       for u, v in done.items() if re.search(kw, v['text']) and 'not available' not in v['text'][:60]]
n = 6; k = max(1, (len(rel) + n - 1) // n)
for b in range(n):
    json.dump(rel[b * k:(b + 1) * k], open(os.path.join(out_dir, f'th_batch_{b}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(f'共 {len(done)} 則；讀不到 {sum(1 for v in done.values() if v["text"].startswith("ERR") or "not available" in v["text"][:60])} 則；符合關鍵字 {len(rel)} 則 → th_batch_0..5.json')
