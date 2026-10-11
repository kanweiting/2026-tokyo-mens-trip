const SHEET = 'records';

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(['id', 'kind', 'json', 'ts']); }
  return sh;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const op = (e && e.parameter && e.parameter.op) || '';
  if (op === 'search') return json_({ results: search_(e.parameter.q || '') });
  if (op === 'resolve') return json_({ results: resolve_(e.parameter.url || '') });
  const rows = sheet_().getDataRange().getValues().slice(1);
  const records = rows.filter(r => r[0]).map(r => JSON.parse(r[2]));
  return json_({ records });
}

function doPost(e) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents), sh = sheet_();
    const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => String(r[0]));
    const id = body.op === 'put' ? body.rec.id : body.id, at = ids.indexOf(id);
    if (at > 0) sh.deleteRow(at + 1);
    if (body.op === 'put') sh.appendRow([body.rec.id, body.rec.kind, JSON.stringify(body.rec), body.rec.ts]);
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}

// 用 Google 地圖找地點（Apps Script 內建的 Maps 服務，不用 API key）
function search_(q) {
  q = String(q).trim();
  if (!q) return [];
  const g = Maps.newGeocoder().setRegion('jp').setLanguage('zh-TW')
    .setBounds(35.5, 139.4, 35.9, 140.0);   // 偏好東京一帶
  const seen = {}, out = [];
  [q, q + ' 東京'].forEach(function (s) {
    const r = g.geocode(s);
    (r.results || []).forEach(function (x) {
      if (seen[x.place_id] || out.length >= 6) return;
      seen[x.place_id] = 1;
      const poi = (x.address_components || []).filter(function (c) {
        return c.types.some(function (t) { return ['point_of_interest', 'establishment', 'premise', 'park', 'tourist_attraction'].indexOf(t) >= 0; });
      })[0];
      out.push({ name: poi ? poi.long_name : q, address: x.formatted_address, lat: x.geometry.location.lat, lng: x.geometry.location.lng,
        placeId: x.place_id, types: x.types, map: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(poi ? poi.long_name : q) + '&query_place_id=' + x.place_id });
    });
  });
  return out;
}

// 貼上 Google Maps 分享連結 → 店名＋座標
function resolve_(url) {
  let u = String(url).trim();
  for (let i = 0; i < 6 && /goo\.gl|g\.co/.test(u); i++) {
    const r = UrlFetchApp.fetch(u, { followRedirects: false, muteHttpExceptions: true });
    const loc = r.getHeaders()['Location'] || r.getHeaders()['location'];
    if (!loc) break;
    u = loc;
  }
  const m = u.match(/!3d(-?[\d.]+)!4d(-?[\d.]+)/) || u.match(/@(-?[\d.]+),(-?[\d.]+)/);
  const n = u.match(/\/place\/([^/@]+)/);
  if (!m) return [];
  const name = n ? decodeURIComponent(n[1].replace(/\+/g, ' ')) : '';
  return [{ name: name, address: '', lat: +m[1], lng: +m[2], map: url }];
}
