"""抓臺灣銀行牌告匯率，寫進 data/trip.json 的 fxDaily（每筆帳用消費當天匯率換算）

用法：python tools/importers/bank_fx.py <幣別代碼> <開始日> <結束日>
  例：python tools/importers/bank_fx.py JPY 2026-10-15 2026-10-21
算法：當天所有盤中牌價「即期買入、即期賣出」的中間值平均；週末／假日沒有牌價就沿用前一個營業日
需要：pip install playwright && playwright install chromium（台銀網站有 JS 驗證，一般 HTTP 抓不到）
只適用「本國貨幣＝台幣」；其他國家請換成該國央行或銀行的來源，fxDaily 格式一樣：{日期: {rate: 1 外幣兌本國貨幣, src: 說明}}
"""
import asyncio, datetime, json, os, re, statistics, sys
from playwright.async_api import async_playwright

CUR, d0, d1 = sys.argv[1].upper(), datetime.date.fromisoformat(sys.argv[2]), datetime.date.fromisoformat(sys.argv[3])
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
days = [d0 + datetime.timedelta(n) for n in range((d1 - d0).days + 1)]
async def main():
    got = {}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await (await b.new_context(locale='zh-TW', user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')).new_page()
        # 往前多抓幾天，週末才找得到前一個營業日
        for d in [d0 - datetime.timedelta(n) for n in range(4, 0, -1)] + days:
            if d.weekday() >= 5: continue
            for attempt in range(3):
                await pg.goto(f'https://rate.bot.com.tw/xrt/quote/{d}/{CUR}/spot', wait_until='domcontentloaded')
                for _ in range(40):
                    await pg.wait_for_timeout(1000)
                    if 'Challenge' not in await pg.title(): break
                await pg.wait_for_timeout(1500)
                rows = await pg.evaluate("[...document.querySelectorAll('table tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText.trim()))")
                rows = [r for r in rows if r and re.match(r'\d{4}/\d{2}/\d{2}', r[0])]
                if rows or 'Challenge' not in await pg.title(): break
            if rows:
                mid = [(float(r[4]) + float(r[5])) / 2 for r in rows if r[4] not in ('-', '') and r[5] not in ('-', '')]
                if mid: got[str(d)] = round(statistics.mean(mid), 5); print(d, len(rows), '筆 →', got[str(d)])
        await b.close()
    return got
got = asyncio.run(main())
p = os.path.join(ROOT, 'data', 'trip.json'); t = json.load(open(p, encoding='utf-8'))
fx = {'_note': f'臺灣銀行 {CUR} 牌告：當天盤中「即期買入、即期賣出」中間值的平均；1 {CUR} 兌多少台幣；沒有牌價的日子沿用前一營業日'}
last = None
for d in [d0 - datetime.timedelta(n) for n in range(4, 0, -1)] + days:
    k = str(d)
    if k in got: last = (k, got[k])
    if d >= d0 and last:
        fx[k] = {'rate': last[1], 'src': f'台銀 {last[0][5:].replace("-", "/")}' + ('' if last[0] == k else '（沿用）')}
t['fxDaily'] = fx
json.dump(t, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('已寫入 trip.json fxDaily：', {k: v['rate'] for k, v in fx.items() if k[0] == '2'})
