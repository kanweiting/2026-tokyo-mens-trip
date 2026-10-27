"""從 Instagram「下載你的資訊」匯出檔（JSON 格式、只勾訊息）抽出某個群組聊天裡分享的貼文／Reels 連結與原文文案

用法：python tools/importers/ig_dm_links.py <匯出的 zip 或解壓後資料夾> "<群組名稱的一部分>" <輸出資料夾>
  例：python tools/importers/ig_dm_links.py instagram-xxx.zip "不只 1 次的旅程" _raw
輸出：<輸出資料夾>/ig_links.json   [{ts, sender, url, owner, caption}]
下一步：讓 Claude 依 tools/importers/EXTRACT_PROMPT.md 把文案抽成 ig_places_*.json、ig_quotes_*.json，再跑 tools/build_data.py
⚠️ 匯出檔含整個帳號的私人資料，輸出資料夾不要放進 repo。
"""
import json, glob, os, re, sys, zipfile, tempfile, datetime

src, name_part, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
if src.endswith('.zip'):
    tmp = tempfile.mkdtemp(); zipfile.ZipFile(src).extractall(tmp); src = tmp
fx = lambda s: (s or '').encode('latin1').decode('utf-8', 'ignore') if s else ''   # IG 匯出的中文是 latin1 亂碼，要轉回 UTF-8
def fx_safe(s):
    try: return fx(s)
    except Exception: return s or ''
inbox = glob.glob(os.path.join(src, '**', 'messages', 'inbox', '*'), recursive=True)
hit = []
for d in inbox:
    fs = glob.glob(os.path.join(d, 'message_*.json'))
    if not fs: continue
    title = fx_safe(json.load(open(fs[0], encoding='utf-8')).get('title', ''))
    if name_part in title: hit.append((d, title, fs))
if not hit:
    sys.exit(f'找不到名稱包含「{name_part}」的聊天。可用的群組：' + '、'.join(sorted({fx_safe(json.load(open(glob.glob(os.path.join(d, "message_*.json"))[0], encoding="utf-8")).get("title", "")) for d in inbox if glob.glob(os.path.join(d, "message_*.json"))})[:30]))
d, title, fs = hit[0]
out = []
for f in fs:
    for m in json.load(open(f, encoding='utf-8'))['messages']:
        sh = m.get('share') or {}
        urls = set(re.findall(r'https?://\S+', fx_safe(m.get('content', ''))))
        if sh.get('link'): urls.add(sh['link'])
        for u in urls:
            out.append(dict(ts=datetime.datetime.fromtimestamp(m['timestamp_ms'] / 1000).isoformat(timespec='minutes'), sender=fx_safe(m.get('sender_name', '')),
                            url=u.split('?')[0], owner=fx_safe(sh.get('original_content_owner', '')), caption=fx_safe(sh.get('share_text', ''))))
out.sort(key=lambda x: x['ts'])
os.makedirs(out_dir, exist_ok=True)
json.dump(out, open(os.path.join(out_dir, 'ig_links.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'「{title}」：{len(out)} 個連結，其中 {sum(1 for x in out if x["caption"])} 個有原文文案 → {out_dir}/ig_links.json')
print('成員顯示名稱（要對應到 trip.json 的成員 id）：', sorted({x["sender"] for x in out}))
