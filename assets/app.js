/* Tokyo Trip — 純前端，資料來自 data/*.json；收藏與記帳存 localStorage，設了 sheetApi 就同步到 Google Sheet */
(() => {
const CFG = window.TRIP_CONFIG || {};
const TYPES = [
  { name: '餐廳', icon: '🍽️', v: '--t1' },
  { name: '咖啡/甜點', icon: '☕', v: '--t2' },
  { name: 'Bar/居酒屋', icon: '🍺', v: '--t3' },
  { name: '景點', icon: '📍', v: '--t4' },
  { name: '購物', icon: '🛍️', v: '--t5' },
  { name: '其他', icon: '•', v: '--t6' },
];
const TYPE = Object.fromEntries(TYPES.map(t => [t.name, t]));
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const $ = s => document.querySelector(s);
const h = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const typeOf = p => TYPE[p.type] || TYPE['其他'];
const fmt = n => Math.round(n).toLocaleString('en-US');

let trip, places, areas, byId;
const S = { me: localStorage.getItem('me') || '', tab: 'plan', day: null, pos: null, records: [] };

/* ---------- 儲存層：localStorage，或 Google Apps Script ---------- */
const Store = {
  key: 'records:v1',
  async load() {
    const local = JSON.parse(localStorage.getItem(this.key) || '[]');
    if (!CFG.sheetApi) return (S.records = local, '只存在這台裝置（config.js 未設定 sheetApi）');
    try {
      const r = await fetch(CFG.sheetApi + '?t=' + Date.now()).then(r => r.json());
      S.records = r.records || [];
      localStorage.setItem(this.key, JSON.stringify(S.records));
      return '已和 Google Sheet 同步 · ' + new Date().toLocaleTimeString();
    } catch (e) { S.records = local; return '⚠️ 連不到 Google Sheet，先用離線資料'; }
  },
  async put(rec) {
    rec.id = rec.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    rec.ts = new Date().toISOString(); rec.by = S.me;
    S.records = S.records.filter(r => r.id !== rec.id).concat(rec);
    this.save();
    if (CFG.sheetApi) fetch(CFG.sheetApi, { method: 'POST', body: JSON.stringify({ op: 'put', rec }) }).catch(() => {});
    return rec;
  },
  async del(id) {
    S.records = S.records.filter(r => r.id !== id);
    this.save();
    if (CFG.sheetApi) fetch(CFG.sheetApi, { method: 'POST', body: JSON.stringify({ op: 'del', id }) }).catch(() => {});
  },
  save() { localStorage.setItem(this.key, JSON.stringify(S.records)); },
  of(kind) { return S.records.filter(r => r.kind === kind); },
};

/* ---------- 個人 View 設定（只存在自己的裝置） ---------- */
const Pref = {
  get(k, d) { return JSON.parse(localStorage.getItem(`pref:${S.me}:${k}`) || 'null') ?? d; },
  set(k, v) { localStorage.setItem(`pref:${S.me}:${k}`, JSON.stringify(v)); },
};
const favsOf = m => new Set([...(trip.wishlists?.[m] || []), ...Store.of('fav').filter(r => r.member === m).map(r => r.place)]);
const isFav = id => favsOf(S.me).has(id);
async function toggleFav(id) {
  if (!S.me) return alert('先在右上角選「我是誰」');
  const rec = Store.of('fav').find(r => r.member === S.me && r.place === id);
  if (rec) await Store.del(rec.id); else await Store.put({ kind: 'fav', member: S.me, place: id });
  render();
}

/* ---------- 工具 ---------- */
const dist = (a, b, c, d) => { const r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return 6371 * Math.hypot(x, y); };
const wd = date => WD[new Date(date + 'T12:00:00+09:00').getUTCDay()];
const dayLabel = d => `${+d.slice(5, 7)}/${+d.slice(8)}（${wd(d)}）`;
function closedDays(p) {
  const c = p.closed || ''; if (!c || /24HR|\?/.test(c)) return [];
  return trip.dates.filter(d => c.includes(wd(d)));
}
function nearestArea(lat, lng) {
  let best = null, bd = 1e9;
  for (const a of areas) { const d = dist(lat, lng, a.lat, a.lng); if (d < bd) { bd = d; best = a; } }
  return { area: best, km: bd };
}
const plannedIds = () => new Set(Object.values(trip.days).flat().map(i => i.place).filter(Boolean));
const mapUrl = p => p.map || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((p.name_en || p.name) + (p.lat ? '' : ' Tokyo'))}`;
const memberName = id => trip.members.find(m => m.id === id)?.name || id;

function card(p, extra = '') {
  const t = typeOf(p), cd = closedDays(p), fav = isFav(p.id);
  const others = trip.members.filter(m => m.id !== S.me && favsOf(m.id).has(p.id)).map(m => m.name);
  const d = S.pos && p.lat ? dist(S.pos[0], S.pos[1], p.lat, p.lng) : null;
  return `<div class="card">
    <button class="star" data-fav="${p.id}" title="收藏">${fav ? '★' : '☆'}</button>
    <h4>${h(p.name)}</h4>
    <div class="meta"><span><i class="sw" style="background:var(${t.v})"></i> ${t.icon} ${h(p.subcat || p.type)}</span>
      <span>📌 ${h(p.area)}${p.approx ? '（約略）' : ''}</span>
      ${p.rating ? `<span>⭐ ${p.rating}（${fmt(p.ratingCount || 0)}）</span>` : ''}
      ${d != null ? `<span>🚶 ${d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km'}</span>` : ''}
      ${p.price ? `<span>💴 ${h(p.price)}</span>` : ''}</div>
    ${p.note ? `<div class="note">${h(p.note.slice(0, 110))}${p.note.length > 110 ? '…' : ''}</div>` : ''}
    ${cd.length ? `<div class="warn">⚠️ ${cd.map(dayLabel).join('、')} 公休</div>` : ''}
    ${others.length ? `<div class="meta" style="margin-top:6px">❤️ ${h(others.join('、'))} 也想去</div>` : ''}
    ${extra}
    <div class="links"><a href="${h(mapUrl(p))}" target="_blank" rel="noopener">Google Maps</a>
      ${(p.ig || []).slice(0, 3).map((u, i) => `<a href="${h(u)}" target="_blank" rel="noopener">IG ${i + 1}</a>`).join('')}
      ${p.sharedBy?.length ? `<span class="tag">${h(p.sharedBy.join('、'))} 分享</span>` : ''}</div>
  </div>`;
}

/* ---------- 行程 ---------- */
function renderPlan() {
  S.day = S.day || (trip.dates.includes(today()) ? today() : trip.dates[0]);
  $('#dayChips').innerHTML = trip.dates.map(d => `<button class="chip ${d === S.day ? 'on' : ''}" data-day="${d}">${dayLabel(d)}</button>`).join('');
  const fl = trip.flights.filter(f => f.date === S.day && (!S.me || !f.who.length || f.who.includes(S.me)));
  const lod = trip.lodging;
  $('#planInfo').innerHTML = `<div class="info-row">
    ${fl.map(f => `<div class="card"><h4>✈️ ${h(f.label)}：${h(f.airline)} ${h(f.no)}</h4><div class="meta">${h(f.route)} · ${h(f.time)}${f.who.length ? ' · ' + f.who.map(memberName).join('、') : ''}</div></div>`).join('')}
    <div class="card"><h4>🏠 ${h(lod.name)}</h4><div class="meta">${dayLabel(lod.checkin)} 入住 → ${dayLabel(lod.checkout)} 退房${lod.station ? ' · ' + h(lod.station) : ''}</div>
      <div class="links"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lod.address || lod.name)}" target="_blank" rel="noopener">Google Maps</a>
      ${lod.url ? `<a href="${h(lod.url)}" target="_blank" rel="noopener">Airbnb</a>` : ''}</div></div></div>`;
  const items = trip.days[S.day] || [];
  $('#timeline').innerHTML = items.length ? items.map(it => {
    const p = byId[it.place];
    const body = p ? card(p, it.note ? `<div class="warn">📝 ${h(it.note)}</div>` : '')
      : `<div class="card"><h4>${h(it.title || it.place)}</h4>${it.note ? `<div class="meta">${h(it.note)}</div>` : ''}</div>`;
    return `<li><div class="slot"><b>${h(it.time || '')}</b>${h(it.slot)}</div>${body}</li>`;
  }).join('') : '<div class="count">這天還沒排行程</div>';
  const planned = plannedIds();
  const favs = [...favsOf(S.me)].filter(id => byId[id] && !planned.has(id)).map(id => byId[id]);
  $('#favList').innerHTML = !S.me ? '<div class="count">右上角選「我是誰」就能看到自己的收藏</div>'
    : favs.length ? favs.map(p => card(p)).join('') : '<div class="count">還沒有收藏，到「清單」按 ☆</div>';
}
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/* ---------- 地圖 ---------- */
let map, layer, meMarker;
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([35.68, 139.73], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(map);
  const labels = L.layerGroup(areas.map(a => L.marker([a.lat, a.lng], { interactive: false,
    icon: L.divIcon({ className: '', html: `<div class="area-label">${h(a.name)}</div>`, iconSize: [0, 0] }) }))).addTo(map);
  map.on('zoomend', () => map.getZoom() >= 12 ? labels.addTo(map) : labels.remove());
  layer = (L.markerClusterGroup ? L.markerClusterGroup({ maxClusterRadius: 36, disableClusteringAtZoom: 16, showCoverageOnHover: false }) : L.layerGroup()).addTo(map);
  const lod = trip.lodging;
  if (lod.lat) L.marker([lod.lat, lod.lng], { zIndexOffset: 900, title: lod.name,
    icon: L.divIcon({ className: '', iconSize: [32, 32], iconAnchor: [16, 16], html: '<div class="pin home">🏠</div>' }) })
    .bindPopup(`<b>${h(lod.name)}</b><br>${h(lod.address || '')}`).addTo(map);
  map.on('contextmenu', e => setPos([e.latlng.lat, e.latlng.lng], true));  // 右鍵／長按：假裝我在這（測試用）
  $('#locateBtn').onclick = locate;
}
function renderMap() {
  if (!map) initMap();
  setTimeout(() => map.invalidateSize(), 0);
  const hide = new Set(Pref.get('hideTypes', []));
  const cnt = t => places.filter(p => p.type === t && p.lat).length;
  $('#mapTypeChips').innerHTML = TYPES.filter(t => cnt(t.name)).map(t =>
    `<button class="chip ${hide.has(t.name) ? 'off' : ''}" data-hide="${t.name}"><i class="sw" style="background:var(${t.v})"></i>${t.icon} ${t.name} ${cnt(t.name)}</button>`).join('')
    + `<button class="chip ${Pref.get('favOnly', false) ? 'on' : ''}" data-favonly>★ 只看收藏</button>`;
  layer.clearLayers();
  const planned = plannedIds(), favOnly = Pref.get('favOnly', false), mine = favsOf(S.me);
  for (const p of places) {
    if (!p.lat || hide.has(p.type) || (favOnly && !mine.has(p.id))) continue;
    const t = typeOf(p);
    const icon = L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
      html: `<div class="pin ${p.approx ? 'approx' : ''} ${planned.has(p.id) ? 'planned' : ''}" style="background:${css(t.v)}">${t.icon}</div>` });
    L.marker([p.lat, p.lng], { icon, title: p.name }).bindPopup(() => card(p), { maxWidth: 300 }).addTo(layer);
  }
  renderNearby();
}
function locate() {
  if (!navigator.geolocation) return alert('這個瀏覽器不支援定位');
  navigator.geolocation.watchPosition(g => setPos([g.coords.latitude, g.coords.longitude]),
    () => alert('拿不到定位（可在地圖上按右鍵／長按，模擬自己的位置）'), { enableHighAccuracy: true, maximumAge: 30000 });
}
function setPos(pos, fly) {
  S.pos = pos;
  if (map) {
    meMarker = meMarker || L.marker(pos, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16] }), zIndexOffset: 1000 }).addTo(map);
    meMarker.setLatLng(pos);
    if (fly !== false) map.setView(pos, Math.max(map.getZoom(), 14));
  }
  renderBanner(); if (S.tab === 'map') renderNearby(); if (S.tab === 'list') renderList();
}
function renderBanner() {
  const b = $('#areaBanner'); if (!S.pos) return (b.hidden = true);
  const { area, km } = nearestArea(...S.pos);
  const near = places.filter(p => p.lat && dist(...S.pos, p.lat, p.lng) < 1);
  const nf = near.filter(p => isFav(p.id)).length;
  b.hidden = false;
  b.innerHTML = km < 3 ? `📍 你現在在 <b>${h(area.name)}</b> 一帶 · 1 km 內有 ${near.length} 個候選${nf ? `，其中 ${nf} 個是你的收藏` : ''}`
    : `📍 離最近的熱區「${h(area.name)}」約 ${km.toFixed(1)} km`;
}
function renderNearby() {
  if (!S.pos) return ($('#nearby').innerHTML = '<div class="count">按「◎ 我在哪」看附近有什麼（電腦上可在地圖按右鍵模擬位置）</div>');
  const hide = new Set(Pref.get('hideTypes', []));
  const list = places.filter(p => p.lat && !hide.has(p.type)).map(p => [p, dist(...S.pos, p.lat, p.lng)]).filter(x => x[1] < 1.5)
    .sort((a, b) => (isFav(b[0].id) - isFav(a[0].id)) || a[1] - b[1]).slice(0, 12).map(x => x[0]);
  $('#nearby').innerHTML = `<h3 class="sec" style="grid-column:1/-1">附近 1.5 km（收藏優先）</h3>` + (list.map(p => card(p)).join('') || '<div class="count">附近沒有候選</div>');
}

/* ---------- 清單 ---------- */
function renderList() {
  const q = $('#q').value.trim().toLowerCase(), ft = $('#fType').value, fa = $('#fArea').value, fd = $('#fDay').value,
    fs = $('#fSort').value, ff = $('#fFav').checked, mine = favsOf(S.me);
  const voteN = p => trip.members.filter(m => favsOf(m.id).has(p.id)).length + (p.sharedBy?.length || 0) * 0.1;
  let L2 = places.filter(p => (!ft || p.type === ft) && (!fa || p.area === fa) && (!fd || !closedDays(p).includes(fd)) && (!ff || mine.has(p.id))
    && (!q || [p.name, p.name_en, p.subcat, p.note, p.area].join(' ').toLowerCase().includes(q)));
  const key = { votes: p => -voteN(p), rating: p => -(p.rating || 0), name: p => p.name,
    dist: p => S.pos && p.lat ? dist(...S.pos, p.lat, p.lng) : 1e9 }[fs];
  L2.sort((a, b) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
  $('#listCount').textContent = `${L2.length} 個地點${fs === 'dist' && !S.pos ? '（還沒定位，先到地圖按「我在哪」）' : ''}`;
  $('#list').innerHTML = L2.slice(0, 200).map(p => card(p)).join('');
}
function fillFilters() {
  const ts = TYPES.filter(t => places.some(p => p.type === t.name));
  $('#fType').innerHTML += ts.map(t => `<option>${t.name}</option>`).join('');
  const as = [...new Set(places.map(p => p.area))].sort((a, b) => places.filter(p => p.area === b).length - places.filter(p => p.area === a).length);
  $('#fArea').innerHTML += as.map(a => `<option>${h(a)}</option>`).join('');
  if (!places.some(p => p.rating)) $('#fSort option[value=rating]').remove();
  $('#fDay').innerHTML += trip.dates.map(d => `<option value="${d}">${dayLabel(d)} 有營業</option>`).join('');
  ['#q', '#fType', '#fArea', '#fDay', '#fSort', '#fFav'].forEach(s => $(s).addEventListener('input', renderList));
}

/* ---------- 統計 ---------- */
function renderStats() {
  const located = places.filter(p => p.lat), planned = plannedIds();
  const rated = places.filter(p => p.rating);
  $('#tiles').innerHTML = [
    ['候選地點', places.length], ['已定位', located.length], ['已排進行程', planned.size],
    [S.me ? '我的收藏' : '收藏（選人後顯示）', S.me ? favsOf(S.me).size : '—'], ...(rated.length ? [['有 Google 評分', rated.length]] : []),
  ].map(([k, v]) => `<div class="tile"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');

  const ts = TYPES.filter(t => places.some(p => p.type === t.name));
  $('#areaLegend').innerHTML = ts.map(t => `<span><i class="sw" style="background:var(${t.v})"></i>${t.icon} ${t.name}</span>`).join('');
  const as = [...new Set(places.map(p => p.area))].map(a => ({ a, n: places.filter(p => p.area === a).length })).sort((x, y) => y.n - x.n);
  const W = Math.max(320, $('#chartArea').clientWidth - 20), LW = 110, RW = 36, bh = 18, gap = 8, max = as[0]?.n || 1;
  const sx = v => v / max * (W - LW - RW);
  let svg = `<svg width="${W}" height="${as.length * (bh + gap)}" role="img" aria-label="各區候選數量">`;
  as.forEach((r, i) => {
    const y = i * (bh + gap); let x = LW;
    svg += `<text x="${LW - 8}" y="${y + bh - 4}" text-anchor="end">${h(r.a)}</text>`;
    const segs = ts.map(t => ({ t, n: places.filter(p => p.area === r.a && p.type === t.name).length })).filter(s => s.n);
    segs.forEach((s, j) => {
      const w = Math.max(sx(s.n) - (j < segs.length - 1 ? 2 : 0), 1), last = j === segs.length - 1;
      const d = last ? `M${x},${y}h${w - 4}a4,4 0 0 1 4,4v${bh - 8}a4,4 0 0 1 -4,4h${-(w - 4)}z` : `M${x},${y}h${w}v${bh}h${-w}z`;
      svg += `<path d="${d}" fill="var(${s.t.v})" data-tip="${h(r.a)} · ${s.t.name}：${s.n}"/>`;
      x += sx(s.n);
    });
    svg += `<text class="val" x="${x + 6}" y="${y + bh - 4}">${r.n}</text>`;
  });
  $('#chartArea').innerHTML = svg + '</svg>';

  const top = as.slice(0, 12), mx = Math.max(...top.flatMap(r => ts.map(t => places.filter(p => p.area === r.a && p.type === t.name).length)));
  $('#matrix').innerHTML = `<table><tr><th>區域</th>${ts.map(t => `<th>${t.icon} ${t.name}</th>`).join('')}<th>合計</th></tr>` +
    top.map(r => `<tr><td>${h(r.a)}</td>${ts.map(t => {
      const n = places.filter(p => p.area === r.a && p.type === t.name).length;
      return `<td class="cell" data-area="${h(r.a)}" data-type="${t.name}" style="background:color-mix(in srgb, var(--seq) ${n ? Math.round(10 + 60 * n / mx) : 0}%, transparent)">${n || ''}</td>`;
    }).join('')}<td><b>${r.n}</b></td></tr>`).join('') + '</table>';

  $('#ratingSec').hidden = !rated.length;
  if (!rated.length) return;
  const bins = [3.5, 3.8, 4.0, 4.2, 4.4, 4.6, 4.8].map((b, i, a) => ({ b, n: rated.filter(p => p.rating >= b && (i === a.length - 1 || p.rating < a[i + 1])).length }));
  const bm = Math.max(...bins.map(b => b.n)), bw = 40, H = 140;
  $('#chartRating').innerHTML = `<svg width="${bins.length * (bw + 8) + 20}" height="${H + 24}">` + bins.map((b, i) => {
    const hh = b.n / bm * (H - 16), x = 10 + i * (bw + 8), y = H - hh;
    return `<path d="M${x},${H}v${-(hh - 4)}a4,4 0 0 1 4,-4h${bw - 8}a4,4 0 0 1 4,4v${hh - 4}z" fill="var(--seq)" data-tip="⭐ ${b.b}+：${b.n} 間"/>
      <text x="${x + bw / 2}" y="${H + 16}" text-anchor="middle">${b.b}</text><text class="val" x="${x + bw / 2}" y="${y - 4}" text-anchor="middle">${b.n || ''}</text>`;
  }).join('') + '</svg>';
}

/* ---------- 記帳 ---------- */
// 成員可設 from / until（例如提前回台），記帳預設只分給那天在東京的人
const presentOn = (id, date) => { const m = trip.members.find(x => x.id === id); return !date || ((!m.from || date >= m.from) && (!m.until || date <= m.until)); };
const toBase = (amt, cur) => cur === trip.baseCurrency ? amt : amt * (trip.fx[cur] || 1);
function renderMoney() {
  const ms = trip.members, f = $('#expForm');
  if (!f.payer.options.length) {
    f.payer.innerHTML = ms.map(m => `<option value="${m.id}">${h(m.name)}</option>`).join('');
    $('#splitBox').innerHTML = '<span class="count" style="width:100%">分給誰（預設全部人均分）</span>' +
      ms.map(m => `<label><input type="checkbox" name="sp" value="${m.id}" checked> ${h(m.name)}</label>`).join('');
    f.date.value = trip.dates.includes(today()) ? today() : trip.dates[0];
    f.date.onchange = () => f.querySelectorAll('[name=sp]').forEach(x => x.checked = presentOn(x.value, f.date.value));
    f.date.onchange();
  }
  if (S.me) f.payer.value = f.payer.value || S.me;
  const ex = Store.of('exp').sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.ts.localeCompare(a.ts));
  const bal = Object.fromEntries(ms.map(m => [m.id, 0]));
  for (const e of ex) {
    const v = toBase(+e.amount, e.currency), sp = e.split?.length ? e.split : ms.map(m => m.id);
    bal[e.payer] += v; sp.forEach(id => bal[id] -= v / sp.length);
  }
  const tw = v => trip.fx.TWD ? `（≈ NT$${fmt(v / trip.fx.TWD)}）` : '';
  $('#balances').innerHTML = ms.map(m => `<div class="rowline"><span>${h(m.name)}${m.id === S.me ? '（我）' : ''}</span>
    <span class="${bal[m.id] >= 0 ? 'pos' : 'neg'}">${bal[m.id] >= 0 ? '應收' : '應付'} ¥${fmt(Math.abs(bal[m.id]))} ${tw(Math.abs(bal[m.id]))}</span></div>`).join('');
  // 最少轉帳次數（貪婪配對）
  const cr = ms.map(m => [m.id, bal[m.id]]).filter(x => x[1] > 0.5).sort((a, b) => b[1] - a[1]);
  const db = ms.map(m => [m.id, -bal[m.id]]).filter(x => x[1] > 0.5).sort((a, b) => b[1] - a[1]);
  const tx = [];
  while (cr.length && db.length) {
    const v = Math.min(cr[0][1], db[0][1]); tx.push([db[0][0], cr[0][0], v]);
    cr[0][1] -= v; db[0][1] -= v; if (cr[0][1] < 0.5) cr.shift(); if (db[0][1] < 0.5) db.shift();
  }
  $('#settle').innerHTML = tx.length ? tx.map(([a, b, v]) => `<div class="rowline"><span>${h(memberName(a))} → ${h(memberName(b))}</span><b>¥${fmt(v)} ${tw(v)}</b></div>`).join('')
    : '<div class="count">目前不用轉帳</div>';
  const total = ex.reduce((s, e) => s + toBase(+e.amount, e.currency), 0);
  $('#expList').innerHTML = `<div class="count">共 ${ex.length} 筆 · 合計 ¥${fmt(total)} ${tw(total)} · 匯率 1 TWD = ${trip.fx.TWD} JPY（改 data/trip.json）</div>` +
    ex.map(e => `<div class="rowline"><span>${h(e.title)}<small>${h(e.date || '')} · ${h(memberName(e.payer))} 付 · 分給 ${(e.split || []).map(memberName).join('、') || '全部'}</small></span>
      <span>${e.currency === 'JPY' ? '¥' : 'NT$'}${fmt(+e.amount)} <button class="del" data-del="${e.id}" title="刪除">✕</button></span></div>`).join('');
}
async function addExpense(ev) {
  ev.preventDefault();
  const f = ev.target, split = [...f.querySelectorAll('[name=sp]:checked')].map(x => x.value);
  if (!split.length) return alert('至少要分給一個人');
  await Store.put({ kind: 'exp', title: f.title.value.trim(), amount: +f.amount.value, currency: f.currency.value, date: f.date.value, payer: f.payer.value, split });
  f.title.value = ''; f.amount.value = ''; f.date.onchange(); renderMoney();
}

/* ---------- 主流程 ---------- */
function render() {
  document.querySelectorAll('.tab').forEach(s => s.hidden = s.id !== 'tab-' + S.tab);
  document.querySelectorAll('.bottom button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  ({ plan: renderPlan, map: renderMap, list: renderList, stats: renderStats, money: renderMoney })[S.tab]();
  renderBanner();
}
function bind() {
  document.querySelectorAll('.bottom button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; Pref.set('tab', S.tab); render(); scrollTo(0, 0); });
  $('#meSelect').onchange = e => { S.me = e.target.value; localStorage.setItem('me', S.me); S.tab = Pref.get('tab', S.tab); render(); };
  $('#expForm').onsubmit = addExpense;
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-fav],[data-day],[data-hide],[data-favonly],[data-del],td.cell'); if (!t) return;
    if (t.dataset.fav) return toggleFav(t.dataset.fav);
    if (t.dataset.day) { S.day = t.dataset.day; return renderPlan(); }
    if (t.dataset.hide) { const s = new Set(Pref.get('hideTypes', [])); s.has(t.dataset.hide) ? s.delete(t.dataset.hide) : s.add(t.dataset.hide); Pref.set('hideTypes', [...s]); return renderMap(); }
    if ('favonly' in t.dataset) { Pref.set('favOnly', !Pref.get('favOnly', false)); return renderMap(); }
    if (t.dataset.del) { if (confirm('刪除這筆？')) { await Store.del(t.dataset.del); renderMoney(); } return; }
    if (t.dataset.area) { $('#fArea').value = t.dataset.area; $('#fType').value = t.dataset.type; S.tab = 'list'; render(); }
  });
  const tip = $('#tip');
  document.addEventListener('mousemove', e => {
    const t = e.target.closest('[data-tip]');
    if (!t) return (tip.hidden = true);
    tip.hidden = false; tip.textContent = t.dataset.tip;
    tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY - 36) + 'px';
  });
}
async function main() {
  const j = u => fetch(u).then(r => r.json());
  [trip, places, areas] = await Promise.all([j(CFG.tripFile), j(CFG.placesFile), j(CFG.areasFile)]);
  byId = Object.fromEntries(places.map(p => [p.id, p]));
  document.title = trip.title; $('#tripTitle').textContent = trip.title; $('#tripSub').textContent = trip.subtitle;
  $('#meSelect').innerHTML = '<option value="">選一下</option>' + trip.members.map(m => `<option value="${m.id}">${h(m.name)}</option>`).join('');
  $('#meSelect').value = S.me;
  S.tab = Pref.get('tab', 'plan');
  fillFilters(); bind();
  $('#syncState').textContent = await Store.load();
  render();
}
main();
})();
