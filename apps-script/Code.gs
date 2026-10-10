/**
 * Tokyo Trip 共用資料後端（收藏、記帳）
 * 1. 新增一份 Google Sheet → 擴充功能 → Apps Script → 貼上本檔
 * 2. 部署 → 新增部署 → 類型「網頁應用程式」→ 執行身分：我；存取權：任何人
 * 3. 把產生的 /exec 網址貼到 config.js 的 sheetApi
 * 每筆資料存成一列：id | kind | json | ts
 */
const SHEET = 'records';

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(['id', 'kind', 'json', 'ts']); }
  return sh;
}

function doGet() {
  const rows = sheet_().getDataRange().getValues().slice(1);
  const records = rows.filter(r => r[0]).map(r => JSON.parse(r[2]));
  return ContentService.createTextOutput(JSON.stringify({ records })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents), sh = sheet_();
    const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => String(r[0]));
    const id = body.op === 'put' ? body.rec.id : body.id, at = ids.indexOf(id);
    if (at > 0) sh.deleteRow(at + 1);
    if (body.op === 'put') sh.appendRow([body.rec.id, body.rec.kind, JSON.stringify(body.rec), body.rec.ts]);
    return ContentService.createTextOutput('{"ok":true}').setMimeType(ContentService.MimeType.JSON);
  } finally { lock.releaseLock(); }
}
