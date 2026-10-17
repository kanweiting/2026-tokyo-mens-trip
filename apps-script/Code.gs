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
    const body = JSON.parse(e.postData.contents);
    if (body.op === 'photo') return json_({ ok: true, id: savePhoto_(body) });
    const sh = sheet_();
    const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => String(r[0]));
    const id = body.op === 'put' ? body.rec.id : body.id, at = ids.indexOf(id);
    if (at > 0) sh.deleteRow(at + 1);
    if (body.op === 'put') sh.appendRow([body.rec.id, body.rec.kind, JSON.stringify(body.rec), body.rec.ts]);
    return json_({ ok: true });
  } finally { lock.releaseLock(); }
}

// 收據照片 → Google Drive「東京行收據」資料夾，開放「知道連結的人可檢視」
function savePhoto_(body) {
  const it = DriveApp.getFoldersByName('東京行收據');
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder('東京行收據');
  const blob = Utilities.newBlob(Utilities.base64Decode(body.data), body.mime || 'image/jpeg', body.name || 'receipt.jpg');
  const f = folder.createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return f.getId();
}

// 找地點：有設定 PLACES_KEY（專案設定 → 指令碼屬性）就用 Google Places，拿得到真正的店名和評分；
// 沒有就用 Apps Script 內建的地理編碼（免費，但只有地址，店名用使用者輸入的字）
function search_(q) {
  q = String(q).trim();
  if (!q) return [];
  const key = PropertiesService.getScriptProperties().getProperty('PLACES_KEY');
  return key ? places_(q, key) : geocode_(q);
}

function places_(q, key) {
  const r = UrlFetchApp.fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryTypeDisplayName,places.googleMapsUri,places.rating,places.userRatingCount' },
    payload: JSON.stringify({ textQuery: q, languageCode: 'zh-TW', regionCode: 'JP', maxResultCount: 6,
      locationBias: { rectangle: { low: { latitude: 35.5, longitude: 139.4 }, high: { latitude: 35.9, longitude: 140.0 } } } })
  });
  const body = JSON.parse(r.getContentText() || '{}');
  if (!body.places) return geocode_(q);
  return body.places.map(function (p) {
    return { name: p.displayName && p.displayName.text, address: p.formattedAddress, lat: p.location.latitude, lng: p.location.longitude,
      placeId: p.id, types: p.types || [], typeLabel: p.primaryTypeDisplayName && p.primaryTypeDisplayName.text,
      rating: p.rating || null, ratingCount: p.userRatingCount || null, map: p.googleMapsUri, exact: true };
  });
}

function geocode_(q) {
  const g = Maps.newGeocoder().setRegion('jp').setLanguage('zh-TW').setBounds(35.5, 139.4, 35.9, 140.0);
  const seen = {}, out = [];
  [q, q + ' 東京'].forEach(function (s) {
    (g.geocode(s).results || []).forEach(function (x) {
      if (seen[x.place_id] || out.length >= 6) return;
      seen[x.place_id] = 1;
      const isPlace = x.types.some(function (t) { return ['establishment', 'point_of_interest'].indexOf(t) >= 0; });
      out.push({ name: q, address: x.formatted_address, lat: x.geometry.location.lat, lng: x.geometry.location.lng, placeId: x.place_id,
        types: x.types, exact: false, isPlace: isPlace,
        map: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) + '&query_place_id=' + x.place_id });
    });
  });
  out.sort(function (a, b) { return b.isPlace - a.isPlace; });
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
