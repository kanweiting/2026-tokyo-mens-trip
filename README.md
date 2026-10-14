# Tokyo Trip Planner

給一群朋友用的旅遊網站：行程、地圖（我在哪一區）、候選清單、統計、記帳分帳。
純靜態網站，部署在 GitHub Pages，不需要伺服器。

## 功能
| 頁面 | 內容 |
|---|---|
| 🗓️ 行程 | 每天的時間軸（Sheet「餐廳安排」＋網站上加的）、今日重點（自動整理＋負責人摘要，共享）、拖拉排序、站間交通估算、當日路線 |
| 🗺️ 地圖 | 依類型上色、可開關類別與「★ 收藏」圖層；「◎ 我在哪」顯示在哪一區、附近有什麼；下方卡片左右滑 |
| 🔍 探索 | 搜尋、依類型／區域／「那天有營業」篩選；找不到可「在 Google 地圖搜尋」或貼 Google Maps 連結新增（五人共享） |
| ✅ 準備 | 待辦清單（預設出國前＋行李清單，可自訂）＋記事本；只存在自己手機、各自獨立 |
| 📊 統計 | 各區候選數（依類型堆疊）、類型 × 區域矩陣 |
| 💴 記帳 | 類別、消費時間、誰付、分給誰、均分／比例／金額；每日小計、總計、最少轉帳結算 |

**個人 View**：右上角選「我是誰」，收藏、地圖篩選、待辦、記事本都跟著你。五人同步的資料（記帳、收藏、行程、今日重點、新增地點）存在 Google Sheet。

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

## 讓五個人的記帳同步（約 5 分鐘，只要一個人做）
沒設定的話，資料只存在各自的手機。
1. 開一份新的 Google Sheet → 擴充功能 → Apps Script → 刪掉預設內容、貼上 `apps-script/Code.gs` → 儲存
2. 右上「部署」→「新增部署作業」→ 類型選「網頁應用程式」；執行身分「我」、誰可以存取「任何人」→ 部署 → 授權 → 複製 `/exec` 結尾的網址
3. 打開網站 → 右上角頭像 → 「五人同步」貼上網址 → 儲存 → 「複製邀請連結」傳到群組
4. 其他人點一次邀請連結就會連上同一份帳本（網址存在各自手機，不會進公開的 repo）

> 邀請連結等於帳本鑰匙，只分享給同行的朋友。網站每 20 秒自動更新；離線時記的帳會先存在手機，有網路再自動補傳。

## 部署到 GitHub Pages
```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/<帳號>/2026-tokyo-mens-trip.git
git push -u origin main
```
GitHub repo → Settings → Pages → Source: `main` / root。網址會是 `https://<帳號>.github.io/2026-tokyo-mens-trip/`。

本機預覽：`python -m http.server 8765` → 開 http://localhost:8765（Windows 上 8000 常被 WorkDocs 等程式占用）

## 複製給下一趟旅行
1. Fork 這個 repo，改 `data/trip.json`（成員、日期、行程）
2. 換城市的話改 `data/areas.json`
3. 候選地點：照 `tools/build_data.py` 的輸入格式準備資料，或直接手改 `data/places.json`
4. 開一份新的 Google Sheet 部署 `Code.gs`，網址貼到 `config.js`

## 地點資料格式（places.json）
`id, name, name_en, type(餐廳|咖啡/甜點|Bar/居酒屋|景點|購物|其他), subcat, area, lat, lng, approx(座標是否約略), closed(公休，如「一、二」), note, price, map, ig[], sharedBy[], rating, ratingCount`
