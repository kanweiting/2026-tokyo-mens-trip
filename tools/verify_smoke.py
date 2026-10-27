"""煙霧測試：本機開網站，每個分頁點一遍、記一筆帳，抓 JS 錯誤＋截圖（不會連到真的帳本）

用法：python tools/verify_smoke.py   （需要 pip install playwright && playwright install chromium）
截圖在 _shots/（已在 .gitignore）
"""
import asyncio, os, socket, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, '_shots'); os.makedirs(OUT, exist_ok=True)
port = (lambda s: (s.bind(('127.0.0.1', 0)), s.getsockname()[1], s.close())[1])(socket.socket())
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
# ⚠️ 一律把 sheetApi 清空，測試資料只會留在測試用瀏覽器裡
GUARD = "window.TRIP_CONFIG={sheetApi:'',tripFile:'data/trip.json',placesFile:'data/places.json',areasFile:'data/areas.json'};"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        await ctx.route('**/config.js', lambda r: r.fulfill(content_type='application/javascript', body=GUARD))
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        await pg.goto(f'http://127.0.0.1:{port}/'); await pg.wait_for_timeout(1500)
        await pg.click('[data-me] >> nth=0'); await pg.wait_for_timeout(300)
        for tab in ['plan', 'map', 'list', 'prep', 'stats', 'money']:
            await pg.click(f'nav [data-tab={tab}]'); await pg.wait_for_timeout(700)
            await pg.screenshot(path=os.path.join(OUT, f'{tab}.png'))
        await pg.click('#addExpBtn'); await pg.wait_for_timeout(300)
        await pg.fill('#fAmt', '1000'); await pg.fill('#fTitle', '測試'); await pg.click('[data-save]'); await pg.wait_for_timeout(400)
        n = await pg.locator('.exp').count()
        ov = await pg.evaluate('document.documentElement.scrollWidth > innerWidth')
        print(f'記帳 {n} 筆｜水平溢出：{ov}｜JS 錯誤：{errs or "無"}｜截圖：{OUT}')
        await b.close()
        return not errs and n == 1 and not ov
ok = False
try: ok = asyncio.run(main())
finally: srv.terminate()
sys.exit(0 if ok else 1)
