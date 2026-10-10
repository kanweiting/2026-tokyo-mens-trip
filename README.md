# Tokyo Trip Planner

給一群朋友用的旅遊網站：行程、地圖（我在哪一區）、候選清單、統計、記帳分帳。
純靜態網站，部署在 GitHub Pages，不需要伺服器。

## 功能
| 頁面 | 內容 |
|---|---|
| 🗓️ 行程 | 每天的行程、航班、住宿；自己收藏但還沒排進去的地點 |
| 🗺️ 地圖 | 依類型上色；「◎ 我在哪」顯示現在在哪一區、附近 1.5 km 有什麼（收藏優先）。電腦上可按右鍵模擬位置 |
| 📋 清單 | 搜尋、依類型／區域／「那天有營業」篩選，依投票、距離排序；☆ 收藏 |
| 📊 統計 | 各區候選數（依類型堆疊）、類型 × 區域矩陣（點格子跳到清單）、評分分布（有跑 fetch_ratings 才顯示） |
| 💴 記帳 | 誰付、分給誰（預設只分給那天在東京的人，見 trip.json 成員的 from/until）、JPY/TWD；自動算每人淨額與最少轉帳 |

**個人 View**：右上角選「我是誰」。之後收藏、地圖上隱藏的類型、預設分頁都跟著你，存在你自己的手機上。

## 檔案
```
index.html, assets/      網站本體
config.js                後端網址（記帳同步）
data/trip.json           旅程設定：成員、日期、航班、住宿、每日行程、匯率   ← 要改行程就改這裡
data/places.json         候選地點（由 tools/build_data.py 產生）
data/areas.json          東京各區中心點與半徑（判斷「在哪一區」）
tools/build_data.py      合併 Google Sheet + IG 群組 → places.json
tools/fetch_ratings.py   （選用）用 Google Places API 補評分
apps-script/Code.gs      （選用）Google Sheet 後端，讓收藏和記帳多人同步
```

## 讓記帳多人同步（5 分鐘）
沒設定的話，資料只存在各自的瀏覽器裡。
1. 新增一份空白 Google Sheet → 擴充功能 → Apps Script → 貼上 `apps-script/Code.gs` → 儲存
2. 部署 → 新增部署 → 網頁應用程式；執行身分「我」、存取權「任何人」→ 複製 `/exec` 網址
3. 貼到 `config.js` 的 `sheetApi`，commit + push

> 網址等於密碼，拿到的人都能寫入，只分享給同行的朋友。

## 部署到 GitHub Pages
```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/<帳號>/tokyo-mens-trip.git
git push -u origin main
```
GitHub repo → Settings → Pages → Source: `main` / root。網址會是 `https://<帳號>.github.io/tokyo-mens-trip/`。

本機預覽：`python -m http.server 8000` → 開 http://localhost:8000

## 複製給下一趟旅行
1. Fork 這個 repo，改 `data/trip.json`（成員、日期、行程）
2. 換城市的話改 `data/areas.json`
3. 候選地點：照 `tools/build_data.py` 的輸入格式準備資料，或直接手改 `data/places.json`
4. 開一份新的 Google Sheet 部署 `Code.gs`，網址貼到 `config.js`

## 地點資料格式（places.json）
`id, name, name_en, type(餐廳|咖啡/甜點|Bar/居酒屋|景點|購物|其他), subcat, area, lat, lng, approx(座標是否約略), closed(公休，如「一、二」), note, price, map, ig[], sharedBy[], rating, ratingCount`
