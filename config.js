// 部署設定：記帳要多人同步的話，把 Google Apps Script Web App 網址貼在這裡（見 README）。
// 留空 = 只存在自己的瀏覽器裡（適合先試用）。
window.TRIP_CONFIG = {
  sheetApi: 'https://script.google.com/macros/s/AKfycbwCvD1fjstTbRsC_KUDLM8CTAQhaaS6vuNIA-oZkUOCTfhbHPVj65aVjl8XJn-HuN0p/exec',   // 五人同步（內建，打開就自動連上）
  tripFile: 'data/trip.json',
  placesFile: 'data/places.json',
  areasFile: 'data/areas.json'
};
