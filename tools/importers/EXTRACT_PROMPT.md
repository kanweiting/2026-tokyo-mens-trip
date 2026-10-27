# 讓 Claude 從貼文文案抽地點（IG／Threads）

匯入工具只負責拿到貼文的「原文」。要變成地點清單，請 Claude 開 subagent 分批處理，每批 70–80 則貼文。輸出檔名、格式要照下面寫，`tools/build_data.py` 才讀得到。

## A. IG 群組分享 → `ig_places_<n>.json`
輸入：`ig_links.json` 切成的批次（每則有 idx、url、sender、owner、caption）

> 從每則 caption 抽出所有在【目的地城市】的具體地點（餐廳、咖啡、酒吧、店家、景點、市集…）。一則貼文可能有很多個地點，例如用 📍 列的懶人包。廣告（eSIM、信用卡、業配）不算。沒有地點的貼文也要輸出，`places` 給空陣列。
> 輸出 JSON 陣列：`[{"idx": 0, "url": "...", "sender": "...", "places": [{"name": "照原文", "name_en": "英文／羅馬拼音，不知道就給空字串", "type": "餐廳|咖啡/甜點|Bar/居酒屋|景點|購物|住宿|其他", "subcat": "拉麵／古著…", "area": "區域（要跟 data/areas.json 的名稱一致）", "address": "", "price": "", "note": "40 字內，說明推薦原因"}]}]`
> 自己寫的文字一律用繁體中文。用 Python 腳本寫檔，UTF-8、ensure_ascii=False。

## B. IG 評論句 → `ig_quotes_<n>.json`
輸入：每則貼文的 url、owner、caption，加上 A 抽出來的 places 名稱

> 每個地點從 caption 挑最多 2 句、每句 70 字以內，要具體講到這家店：口味、必點、排隊或訂位、價格、氣氛。廣告和開場白不要。要照原文節錄，不可以自己編。
> 輸出：`[{"url": "...", "owner": "...", "place": "跟 places 名稱完全一樣", "quotes": ["...", "..."]}]`

## C. Threads 按讚 → `threads_places_<n>.json`
輸入：`th_batch_<n>.json`（url、author、ts、text）

> 只輸出有地點的貼文。格式同 A，每個 place 多一個 `"quote"`：從原文節錄 1 句、70 字以內、講這個地點的話。

## 跑完之後
```
python tools/build_data.py <放這些檔案的資料夾>   # → data/src/base_places.json（含地理編碼，1 秒 1 筆）
python tools/sync_sheet.py                         # 套上 Google Sheet → data/places.json
```
