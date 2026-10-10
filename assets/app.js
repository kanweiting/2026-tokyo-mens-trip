/* Tokyo Trip — 純前端，資料來自 data/*.json；收藏、行程增修、記帳存 localStorage，設了 sheetApi 就同步到 Google Sheet */
(() => {
const CFG = window.TRIP_CONFIG || {};
const TYPES = [
  { name: '餐廳', icon: '🍽️', v: '--t1' },
  { name: '咖啡/甜點', icon: '☕', v: '--t2' },
  { name: 'Bar/居酒屋', icon: '🍺', v: '--t3' },
  { name: '景點', icon: '📍', v: '--t4' },
  { name: '購物', icon: '🛍️', v: '--t5' },
  { name: '其他', icon: '✨', v: '--t6' },
];
const CATS = [
  { id: 'food', name: '餐飲', icon: '🍜' }, { id: 'transport', name: '交通', icon: '🚃' }, { id: 'stay', name: '住宿', icon: '🏠' },
  { id: 'shop', name: '購物', icon: '🛍️' }, { id: 'fun', name: '門票/娛樂', icon: '🎟️' }, { id: 'other', name: '其他', icon: '📦' },
];
const SLOTS = ['早餐', '上午', '午餐', '下午', '晚餐', '宵夜', 'BAR', '購物', '景點'];
const TYPE = Object.fromEntries(TYPES.map(t => [t.name, t]));
const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const typeOf = p => TYPE[p.type] || TYPE['其他'];
const fmt = n => Math.round(n).toLocaleString('en-US');
const ICON = {
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  nav: '<svg viewBox="0 0 24 24"><path d="M3 11l18-8-8 18-2-8z"/></svg>',
  route: '<svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 000-6H9a3 3 0 010-6h6.5"/></svg>',
  walk: '<svg viewBox="0 0 24 24"><circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6 3 3v3M9 12l2-4 3 1 2 3M11 8l-3 2v3"/></svg>',
  train: '<svg viewBox="0 0 24 24"><rect x="5" y="3.5" width="14" height="13" rx="3"/><path d="M5 11h14M9 20l-2 1.5M15 20l2 1.5"/><circle cx="9" cy="14" r=".8"/><circle cx="15" cy="14" r=".8"/></svg>',
  ig: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".8"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

let trip, places, areas, byId;
const S = { me: localStorage.getItem('me') || '', tab: 'plan', day: null, pos: null, records: [], type: '', favOnly: false, mview: 'list', routeDay: null, sel: null };

/* ---------- 儲存層：localStorage ＋ Google Apps Script（五人同步） ---------- */
// 後端網址：config.js 的 sheetApi，或用邀請連結 #api=... 存在這支手機（網址就不用寫進公開的 repo）
const API = {
  get url() { return CFG.sheetApi || localStorage.getItem('sheetApi') || ''; },
  set url(v) { v ? localStorage.setItem('sheetApi', v) : localStorage.removeItem('sheetApi'); },
};
(() => { const m = location.hash.match(/api=([^&]+)/); if (m) { API.url = decodeURIComponent(m[1]); history.replaceState(null, '', location.pathname + location.search); } })();
const Store = {
  key: 'records:v1', qkey: 'pending:v1', last: null, state: '',
  pending() { return JSON.parse(localStorage.getItem(this.qkey) || '[]'); },
  setPending(q) { localStorage.setItem(this.qkey, JSON.stringify(q)); },
  async send(op) {
    await fetch(API.url, { method: 'POST', body: JSON.stringify(op) }).then(r => r.json()).then(r => { if (!r.ok) throw new Error('not ok'); });
  },
  async flush() {
    let q = this.pending();
    while (q.length) { try { await this.send(q[0]); } catch (e) { return false; } q = q.slice(1); this.setPending(q); }
    return true;
  },
  async load() {
    const local = JSON.parse(localStorage.getItem(this.key) || '[]');
    if (!API.url) { S.records = local; return (this.state = 'local'); }
    try {
      await this.flush();
      const r = await fetch(API.url + '?t=' + Date.now()).then(r => r.json());
      const q = this.pending(), mine = local.filter(x => q.some(o => o.rec?.id === x.id));   // 還沒送出的先保留
      S.records = (r.records || []).filter(x => !q.some(o => o.id === x.id)).filter(x => !mine.some(m => m.id === x.id)).concat(mine);
      this.save(); this.last = new Date(); this.state = q.length ? 'pending' : 'ok';
    } catch (e) { S.records = local; this.state = 'offline'; }
    return this.state;
  },
  async put(rec) {
    rec.id = rec.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const old = S.records.find(r => r.id === rec.id);
    rec.createdAt = old?.createdAt || rec.createdAt || new Date().toISOString();
    rec.createdBy = old?.createdBy || rec.createdBy || S.me;
    rec.ts = new Date().toISOString(); rec.by = S.me;
    S.records = S.records.filter(r => r.id !== rec.id).concat(rec);
    this.save();
    if (API.url) { this.setPending(this.pending().concat({ op: 'put', rec })); this.flush().then(ok => { this.state = ok ? 'ok' : 'pending'; renderSync(); }); }
    return rec;
  },
  async del(id) {
    S.records = S.records.filter(r => r.id !== id);
    this.save();
    if (API.url) { this.setPending(this.pending().concat({ op: 'del', id })); this.flush().then(ok => { this.state = ok ? 'ok' : 'pending'; renderSync(); }); }
  },
  save() { localStorage.setItem(this.key, JSON.stringify(S.records)); },
  of(kind) { return S.records.filter(r => r.kind === kind); },
};
function syncText() {
  const n = Store.pending().length;
  return { local: '⚪ 只存在這支手機 · 點右上角設定同步', ok: `🟢 五人同步中 · ${Store.last ? Store.last.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : ''} 更新`,
    pending: `🟡 ${n} 筆等待上傳（網路恢復會自動補傳）`, offline: '🔴 連不到同步伺服器，先用手機裡的資料' }[Store.state] || '';
}
function renderSync() { const el = $('#syncState'); if (el) el.textContent = syncText(); }
async function refresh() { if (!API.url || document.hidden || !$('#sheet').hidden) return; await Store.load(); renderSync(); render(); }
const Pref = {
  get(k, d) { return JSON.parse(localStorage.getItem(`pref:${S.me}:${k}`) || 'null') ?? d; },
  set(k, v) { localStorage.setItem(`pref:${S.me}:${k}`, JSON.stringify(v)); },
};

/* ---------- 共用工具 ---------- */
const dist = (a, b, c, d) => { const r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return 6371 * Math.hypot(x, y); };
const wd = date => WD[new Date(date + 'T12:00:00+09:00').getUTCDay()];
const md = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const dayLabel = d => `${md(d)}（${wd(d)}）`;
const dayNo = d => trip.dates.indexOf(d) + 1;
const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const today = () => nowLocal().slice(0, 10);
const memberIdx = id => trip.members.findIndex(m => m.id === id);
const memberName = id => trip.members.find(m => m.id === id)?.name || id;
const av = (id, cls = '') => { const i = memberIdx(id); return `<span class="av ${cls}" style="--c:var(--m${(i % 5) + 1})">${h((memberName(id) || '?').slice(0, 1).toUpperCase())}</span>`; };
const mapsUrl = p => p.map || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((p.name_en || p.name) + ' Tokyo')}`;
const navUrl = p => p.lat && !p.approx ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=transit` : mapsUrl(p);
const kmText = d => d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km';
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 1800); }
function closedDays(p) { const c = p.closed || ''; if (!c || /24HR|\?/.test(c)) return []; return trip.dates.filter(d => c.includes(wd(d))); }
function nearestArea(lat, lng) { let best = null, bd = 1e9; for (const a of areas) { const d = dist(lat, lng, a.lat, a.lng); if (d < bd) { bd = d; best = a; } } return { area: best, km: bd }; }
function travel(a, b) { // 直線距離估算交通時間（僅供參考）
  const d = dist(a.lat, a.lng, b.lat, b.lng) * 1.3;
  return d < 1.2 ? { icon: ICON.walk, text: `步行約 ${Math.max(3, Math.round(d / 4.5 * 60))} 分 · ${kmText(d)}` }
    : { icon: ICON.train, text: `電車約 ${Math.round(12 + d * 2.2)} 分（估）· ${kmText(d)}` };
}

/* ---------- 收藏 ---------- */
const favsOf = m => new Set([...(trip.wishlists?.[m] || []), ...Store.of('fav').filter(r => r.member === m).map(r => r.place)]);
const isFav = id => favsOf(S.me).has(id);
async function toggleFav(id) {
  if (!S.me) return pickMe();
  const rec = Store.of('fav').find(r => r.member === S.me && r.place === id);
  if (rec) { await Store.del(rec.id); toast('已取消收藏'); } else { await Store.put({ kind: 'fav', member: S.me, place: id }); toast('★ 已收藏'); }
  render();
}

/* ---------- 行程資料：trip.json + 自己加的 ---------- */
function dayItems(d) {
  const hidden = new Set(Store.of('planHide').map(r => r.key));   // trip.json 內建的行程被移除／改過
  const base = (trip.days[d] || []).map((it, i) => ({ ...it, date: d, _k: `t:${d}:${i}` })).filter(it => !hidden.has(it._k));
  const added = Store.of('plan').filter(r => r.date === d).map(r => ({ ...r, _k: r.id, mine: true }));
  let last = '00:00';
  const byTime = [...base, ...added].map((it, i) => { const k = it.time || last; last = k; return { it, k, i }; })
    .sort((a, b) => a.k.localeCompare(b.k) || a.i - b.i).map(x => x.it);
  const ord = Store.of('order').find(r => r.date === d)?.keys;      // 拖拉後的順序
  if (!ord) return byTime;
  const out = ord.map(k => byTime.find(i => i._k === k)).filter(Boolean);
  byTime.forEach((it, i) => { if (out.includes(it)) return;            // 新加的：放在原本時間序的前一個項目後面
    const prev = byTime.slice(0, i).reverse().find(x => out.includes(x)); out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, it); });
  return out;
}
const toMin = t => t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null;
const toHM = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
async function setItemTime(it, time) {   // 回傳新的 key（內建項目會變成自己的一筆）
  const keep = ['id', 'place', 'date', 'slot', 'note', 'title', 'createdAt', 'createdBy', 'fromTrip'];
  const rec = Object.fromEntries(keep.filter(k => it[k] != null).map(k => [k, it[k]]));
  if (!it.mine) { await Store.put({ kind: 'planHide', key: it._k }); delete rec.id; rec.fromTrip = true; }
  const r = await Store.put({ ...rec, kind: 'plan', time });
  return r.id;
}
async function onReorder(d, keys, movedKey) {
  const items = dayItems(d), get = k => items.find(i => i._k === k);
  const at = keys.indexOf(movedKey), it = get(movedKey);
  const prevT = keys.slice(0, at).reverse().map(get).find(i => i?.time)?.time, nextT = keys.slice(at + 1).map(get).find(i => i?.time)?.time;
  let msg = '已調整順序';
  if (it?.time && ((prevT && it.time < prevT) || (nextT && it.time > nextT))) {
    const p = toMin(prevT), n = toMin(nextT);
    let t = p != null ? p + 60 : n - 60;
    if (n != null && t >= n) t = p != null ? Math.round((p + n) / 2) : n - 30;
    const hm = toHM(Math.max(0, t)), nk = await setItemTime(it, hm);
    keys = keys.map(k => k === movedKey ? nk : k);
    msg = `已調整順序，時間改成 ${hm}`;
  }
  await Store.put({ id: 'order-' + d, kind: 'order', date: d, keys });
  toast(msg); renderPlan();
}
const planEntries = id => trip.dates.flatMap(d => dayItems(d).filter(i => i.place === id));
const findItem = k => trip.dates.flatMap(dayItems).find(i => i._k === k);
async function removeItem(it) {
  if (it.mine) await Store.del(it.id); else await Store.put({ kind: 'planHide', key: it._k });
}
const plannedIds = () => new Set(trip.dates.flatMap(d => dayItems(d).map(i => i.place)).filter(Boolean));

/* ---------- 卡片 ---------- */
function pcard(p, opt = {}) {
  const t = typeOf(p), cd = closedDays(p), fav = isFav(p.id);
  const others = trip.members.filter(m => m.id !== S.me && favsOf(m.id).has(p.id));
  const d = S.pos && p.lat ? dist(S.pos[0], S.pos[1], p.lat, p.lng) : null;
  return `<div class="pcard ${opt.active ? 'active' : ''}" data-open="${p.id}" role="button" tabindex="0">
    <div class="icon-tile" style="--c:var(${t.v})">${t.icon}</div>
    <div class="body">
      <h4>${h(p.name)}</h4>
      <div class="meta"><span>${h(p.subcat || p.type)}</span><span>· ${h(p.area)}${p.approx ? '（約略）' : ''}</span>${d != null ? `<span>· 🚶 ${kmText(d)}</span>` : ''}</div>
      ${p.note && !opt.compact ? `<div class="note">${h(p.note)}</div>` : ''}
      <div class="tags">
        ${cd.length ? `<span class="badge warn">${cd.map(md).join('、')} 公休</span>` : ''}
        ${others.length ? `<span class="badge">❤️ ${h(others.map(m => m.name).join('、'))}</span>` : ''}
        ${p.price ? `<span class="badge">💴 ${h(p.price.slice(0, 18))}</span>` : ''}
        ${plannedIds().has(p.id) ? '<span class="badge brand">已排入行程</span>' : ''}
      </div>
    </div>
    <span class="fav ${fav ? 'on' : ''}" data-fav="${p.id}" role="button" aria-label="收藏">${fav ? '★' : '☆'}</span>
  </div>`;
}

/* ---------- Bottom sheet ---------- */
function openSheet(html, bind) {
  $('#sheetBody').innerHTML = html; $('#sheet').hidden = false; $('#backdrop').hidden = false; $('#sheetBody').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  if (!openSheet.pushed) { history.pushState({ sheet: 1 }, ''); openSheet.pushed = true; }
  bind && bind($('#sheetBody'));
}
function closeSheet(fromPop) {
  if ($('#sheet').hidden) return;
  $('#sheet').hidden = true; $('#backdrop').hidden = true; $('#sheet').style.transform = ''; document.body.style.overflow = '';
  if (openSheet.pushed && !fromPop) history.back();
  openSheet.pushed = false;
}
window.addEventListener('popstate', () => { openSheet.pushed = false; closeSheet(true); });
(() => { // 下拉關閉
  let y0 = null; const sh = $('#sheet');
  sh.addEventListener('touchstart', e => { if (e.target.closest('.sheet-handle') || $('#sheetBody').scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  sh.addEventListener('touchmove', e => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sh.addEventListener('touchend', e => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; sh.style.transform = ''; if (dy > 90) closeSheet(); });
})();

function pickMe() {
  const invite = API.url ? location.origin + location.pathname + '#api=' + encodeURIComponent(API.url) : '';
  openSheet(`<h2>你是哪一位？</h2><div class="sub">收藏、地圖篩選、記帳預設付款人都會跟著你。</div>
    <div class="me-list">${trip.members.map(m => `<button data-me="${m.id}" class="${m.id === S.me ? 'on' : ''}">${av(m.id, 'lg')}${h(m.name)}${m.note ? ` <span class="muted small">${h(m.note)}</span>` : ''}</button>`).join('')}</div>
    <div class="sec-head"><h3>五人同步</h3><span>${h(syncText())}</span></div>
    ${CFG.sheetApi ? '<div class="sub">同步網址寫在 config.js。</div>' : `
    <div class="field"><label for="apiUrl">Google Apps Script 網址</label><input class="input" id="apiUrl" placeholder="https://script.google.com/macros/s/.../exec" value="${h(API.url)}"></div>
    <div class="row2"><button class="btn ghost" data-saveapi>儲存</button><button class="btn ghost" data-invite ${invite ? '' : 'disabled'}>複製邀請連結</button></div>
    <div class="muted small" style="margin-top:8px">把邀請連結傳到群組，大家點一次就會自動連上同一份帳本。</div>`}`,
    el => {
      el.querySelectorAll('[data-me]').forEach(b => b.onclick = () => {
        S.me = b.dataset.me; localStorage.setItem('me', S.me); closeSheet(); renderMe(); render(); toast(`嗨 ${memberName(S.me)} 👋`);
      });
      const sv = el.querySelector('[data-saveapi]');
      if (sv) sv.onclick = async () => { API.url = el.querySelector('#apiUrl').value.trim(); toast('連線中…'); await Store.load(); renderSync(); render(); toast(syncText()); pickMe(); };
      const iv = el.querySelector('[data-invite]');
      if (iv) iv.onclick = async () => { try { await navigator.clipboard.writeText(invite); toast('已複製邀請連結'); } catch (e) { prompt('複製這個連結', invite); } };
    });
}
function renderMe() { $('#meBtn').innerHTML = S.me ? `${av(S.me)}${h(memberName(S.me))}` : '<span class="av ghost">?</span>選擇身分'; }

function openPlace(id) {
  const p = byId[id]; if (!p) return;
  const t = typeOf(p), cd = closedDays(p), fav = isFav(id);
  const who = trip.members.filter(m => favsOf(m.id).has(id));
  const entries = planEntries(id);
  const label = i => `D${dayNo(i.date)} ${dayLabel(i.date)}${i.time ? ' ' + i.time : ''}${i.slot ? ' · ' + i.slot : ''}`;
  const d = S.pos && p.lat ? dist(S.pos[0], S.pos[1], p.lat, p.lng) : null;
  openSheet(`
    <div class="sheet-title"><div class="icon-tile" style="--c:var(${t.v})">${t.icon}</div>
      <div><h2>${h(p.name)}</h2><div class="sub">${h(p.subcat || p.type)} · ${h(p.area)}${p.approx ? '（約略位置）' : ''}${d != null ? ' · 離你 ' + kmText(d) : ''}</div></div></div>
    ${p.name_en && p.name_en !== p.name ? `<div class="sub" style="margin-top:6px">${h(p.name_en)}</div>` : ''}
    <div class="tags" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">
      ${cd.length ? `<span class="badge warn">⚠️ ${cd.map(dayLabel).join('、')} 公休</span>` : p.closed ? `<span class="badge">公休：${h(p.closed)}</span>` : ''}
      ${who.length ? `<span class="badge">❤️ ${h(who.map(m => m.name).join('、'))} 想去</span>` : ''}
      ${p.sharedBy?.length ? `<span class="badge">📤 ${h(p.sharedBy.map(memberName).join('、'))} 在 IG 分享</span>` : ''}
      ${p.likedBy?.length ? `<span class="badge">🧵 ${h(p.likedBy.map(memberName).join('、'))} 在 Threads 按讚</span>` : ''}
      ${p.src?.includes('gmaps') ? '<span class="badge">🗺️ 東京逛清單</span>' : ''}
    </div>
    <div class="actions">
      <button class="act ${fav ? 'on' : ''}" data-act="fav">${ICON.star}${fav ? '已收藏' : '收藏'}</button>
      <button class="act ${entries.length ? 'on' : ''}" data-act="plan">${entries.length ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>已在行程' : ICON.plus + '加入行程'}</button>
      <a class="act" href="${h(navUrl(p))}" target="_blank" rel="noopener">${ICON.nav}導航</a>
    </div>
    ${entries.length ? `<div class="plan-box"><div class="plan-box-h">🗓️ 已排入行程</div>
      ${entries.map(i => `<div class="plan-row"><span>${h(label(i))}</span><button class="mini" data-pedit="${h(i._k)}">調整</button><button class="mini danger" data-prm="${h(i._k)}">移除</button></div>`).join('')}
      <button class="mini ghost" data-act="plan-more">＋ 也排到其他天</button></div>` : ''}
    ${(p.comments || []).length ? `<div class="sec-head" style="margin:16px 0 8px"><h3>大家怎麼說</h3><span>${p.comments.length} 則</span></div>
      <div class="comments">${p.comments.map(c => `<div class="cmt"><div class="cmt-by">${{ sheet: '📝', ig: '🎬', threads: '🧵', gmaps: '🗺️', google: '⭐' }[c.src] || '💬'} ${h(c.by)}${c.url ? ` · <a href="${h(c.url)}" target="_blank" rel="noopener">原文 ↗</a>` : ''}</div><div class="cmt-t">${h(c.text)}</div></div>`).join('')}</div>`
      : p.note ? `<div class="note-full">${h(p.note)}</div>` : ''}
    ${p.price ? `<div class="sub">💴 ${h(p.price)}</div>` : ''}
    <div class="linklist">
      <a href="${h(mapsUrl(p))}" target="_blank" rel="noopener"><span>📍 Google Maps</span><span class="muted">↗</span></a>
      ${(p.threads || []).map((u, i) => `<a href="${h(u)}" target="_blank" rel="noopener"><span>🧵 Threads 貼文 ${i + 1}</span><span class="muted">↗</span></a>`).join('')}
      ${(p.ig || []).map((u, i) => `<a href="${h(u)}" target="_blank" rel="noopener"><span>${ICON.ig.replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px"')} IG 介紹 ${i + 1}</span><span class="muted">↗</span></a>`).join('')}
    </div>`,
    el => {
      el.querySelector('[data-act=fav]').onclick = async () => { await toggleFav(id); openPlace(id); };
      el.querySelector('[data-act=plan]').onclick = () => entries.length ? openAddPlan(id, entries[0]) : openAddPlan(id);
      const more = el.querySelector('[data-act=plan-more]'); if (more) more.onclick = () => openAddPlan(id);
      el.querySelectorAll('[data-pedit]').forEach(b => b.onclick = () => openAddPlan(id, findItem(b.dataset.pedit)));
      el.querySelectorAll('[data-prm]').forEach(b => b.onclick = async () => { const it = findItem(b.dataset.prm); await removeItem(it); toast(`已從 D${dayNo(it.date)} 移除`); render(); openPlace(id); });
    });
}

function openAddPlan(id, rec) {
  const p = byId[id], F = { date: rec?.date || S.day || trip.dates[0], time: rec?.time || '', slot: rec?.slot || (p.type === '咖啡/甜點' ? '下午' : p.type === 'Bar/居酒屋' ? 'BAR' : p.type === '景點' ? '景點' : '午餐') };
  const draw = () => openSheet(`<h2>${rec ? '調整行程' : '加入行程'}</h2><div class="sub">${h(p.name)}</div>
    <div class="field"><span class="field-label">哪一天</span><div class="chips">${trip.dates.map(d => `<button class="chip ${d === F.date ? 'on' : ''}" data-d="${d}">D${dayNo(d)} ${dayLabel(d)}</button>`).join('')}</div>
      ${closedDays(p).includes(F.date) ? '<div class="badge warn" style="margin-top:8px">⚠️ 這天公休</div>' : ''}</div>
    <div class="field"><span class="field-label">時段</span><div class="chips">${SLOTS.map(s => `<button class="chip ${s === F.slot ? 'on' : ''}" data-s="${s}">${s}</button>`).join('')}</div></div>
    <div class="field"><label for="ptime">時間（選填）</label><input class="input" id="ptime" type="time" value="${h(F.time)}"></div>
    <div class="form-foot"><button class="btn" data-save>${rec ? '儲存' : '加入 D' + dayNo(F.date)}</button>${rec ? '<button class="btn danger" data-del>從行程移除</button>' : ''}</div>`,
    el => {
      el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { F.date = b.dataset.d; F.time = el.querySelector('#ptime').value; draw(); });
      el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { F.slot = b.dataset.s; F.time = el.querySelector('#ptime').value; draw(); });
      el.querySelector('[data-save]').onclick = async () => {
        F.time = el.querySelector('#ptime').value;
        if (rec && !rec.mine) await Store.put({ kind: 'planHide', key: rec._k });   // 內建項目：藏起原本的、另存一筆
        const base = rec?.mine ? { id: rec.id, createdAt: rec.createdAt, createdBy: rec.createdBy, fromTrip: rec.fromTrip } : rec ? { fromTrip: true } : {};
        await Store.put({ ...base, kind: 'plan', place: id, date: F.date, time: F.time, slot: F.slot, note: rec?.note || '' });
        closeSheet(); S.day = F.date; toast(`已排進 D${dayNo(F.date)}`); render();
      };
      const del = el.querySelector('[data-del]'); if (del) del.onclick = async () => { await removeItem(rec); closeSheet(); toast(`已從 D${dayNo(rec.date)} 移除`); render(); };
    });
  draw();
}

/* ---------- 行程頁 ---------- */
function renderPlan() {
  S.day = S.day || (trip.dates.includes(today()) ? today() : trip.dates[0]);
  const start = trip.dates[0], end = trip.dates[trip.dates.length - 1], td = today();
  const diff = Math.round((new Date(start) - new Date(td)) / 864e5);
  const cnt = diff > 0 ? `<div class="count">倒數<b>${diff}</b>天</div>` : td <= end ? `<div class="count">今天是<b>D${dayNo(td)}</b></div>` : '<div class="count">旅程<b>完成</b>🎉</div>';
  $('#hero').innerHTML = `<div class="eyebrow">Tokyo · ${trip.members.length} men</div><h1>${h(trip.title)}</h1><div class="dates">${h(trip.subtitle)}</div>
    <div class="row"><div class="av-stack">${trip.members.map(m => av(m.id)).join('')}</div>${cnt}</div>
    <div class="stats"><span>📍 ${places.length} 個候選</span><span>🗓️ ${plannedIds().size} 個已排</span>${S.me ? `<span>★ 我收藏 ${favsOf(S.me).size}</span>` : ''}</div>`;
  $('#dayTabs').innerHTML = trip.dates.map(d => `<button class="daytab ${d === S.day ? 'on' : ''} ${d === td ? 'today' : ''}" data-day="${d}"><b>D${dayNo(d)}</b><small>${dayLabel(d)}</small></button>`).join('');
  const items = dayItems(S.day), lod = trip.lodging;
  const stops = items.filter(i => byId[i.place]);
  $('#dayHead').innerHTML = `<div><h2>D${dayNo(S.day)} · ${dayLabel(S.day)}</h2><div class="muted">${stops.length} 個地點${items.length - stops.length ? ` · ${items.length - stops.length} 個交通／提醒` : ''}</div></div>
    ${stops.some(i => byId[i.place].lat) ? `<button class="btn-soft" data-route="${S.day}">${ICON.route}路線</button>` : ''}`;
  let n = 0, prev = S.day !== trip.dates[0] && lod.lat ? lod : null;
  const rows = [];
  if (prev && stops.length) rows.push(`<li class="tl-item"><div class="tl-dot sys">🏠</div><div><div class="tl-card sys"><b>從住宿出發</b> <span class="muted small">${h(lod.station || lod.name)}</span></div></div></li>`);
  for (const it of items) {
    const p = byId[it.place];
    if (p) {
      n++;
      const t = typeOf(p), cd = closedDays(p).includes(S.day);
      if (prev && p.lat) { const tr = travel(prev, p); rows.push(`<li class="tl-item"><div></div><div class="tl-gap">${tr.icon}${tr.text}</div></li>`); }
      rows.push(`<li class="tl-item drag" data-k="${h(it._k)}"><div class="tl-dot" style="--c:var(${t.v})">${n}</div><div>
        <div class="tl-card" data-open="${p.id}" role="button" tabindex="0">
          <span class="tl-more" data-pedit-tl="${h(it._k)}" role="button" aria-label="調整或移除">⋯</span>
          <span class="tl-grip" aria-label="按住拖拉調整順序"><svg viewBox="0 0 24 24"><path d="M5 9h14M5 15h14"/></svg></span>
          <div class="tl-time">${h(it.time || '')}${it.time ? ' · ' : ''}${h(it.slot || '')}</div>
          <h4>${t.icon} ${h(p.name)}</h4>
          <div class="meta"><span>${h(p.subcat || p.type)}</span><span>${h(p.area)}</span>${it.mine && !it.fromTrip ? `<span>由 ${h(memberName(it.createdBy))} 加入</span>` : ''}</div>
          <div class="tags" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">${it.note ? `<span class="badge warn">📝 ${h(it.note)}</span>` : ''}${cd ? '<span class="badge warn">⚠️ 今天公休</span>' : ''}</div>
        </div></div></li>`);
      if (p.lat) prev = p;
    } else {
      const ic = /抵達|起飛|JX|航/.test((it.title || '') + it.slot) ? '✈️' : it.slot === '退房' ? '🧳' : '📌';
      rows.push(`<li class="tl-item" data-k="${h(it._k)}"><div class="tl-dot sys">${ic}</div><div><div class="tl-card sys">
        <div class="tl-time">${h(it.time || '')}${it.time ? ' · ' : ''}${h(it.slot || '')}</div><b>${h(it.title || '')}</b>${it.note ? `<div class="muted small">${h(it.note)}</div>` : ''}</div></div></li>`);
    }
  }
  $('#timeline').innerHTML = rows.join('') || '<div class="empty">這天還沒排行程<br><span class="small">到「探索」點地點 →「加入行程」</span></div>';
  if (window.Sortable && stops.length > 1) {
    renderPlan.sort?.destroy();
    renderPlan.sort = Sortable.create($('#timeline'), { draggable: '.tl-item.drag', handle: '.tl-grip', animation: 160,
      ghostClass: 'tl-ghost', chosenClass: 'tl-chosen', forceFallback: true, fallbackTolerance: 4,
      onStart: () => $('#timeline').classList.add('dragging'),
      onEnd: e => { $('#timeline').classList.remove('dragging'); if (e.oldIndex === e.newIndex) return;
        onReorder(S.day, [...$('#timeline').querySelectorAll('li[data-k]')].map(li => li.dataset.k), e.item.dataset.k); } });
  }
  const planned = plannedIds();
  const favs = S.me ? [...favsOf(S.me)].filter(id => byId[id] && !planned.has(id)).map(id => byId[id]) : [];
  $('#favCount').textContent = S.me ? `${favs.length} 個還沒排` : '';
  $('#favList').innerHTML = !S.me ? '<div class="empty" style="flex-basis:100%">右上角選擇身分，就能看到自己的收藏</div>'
    : favs.length ? favs.map(p => pcard(p, { compact: true })).join('') : '<div class="empty" style="flex-basis:100%">還沒有收藏，到「探索」按 ☆</div>';
}

/* ---------- 地圖 ---------- */
let map, cluster, routeLayer, meMarker, markers = {}, ignoreMove = false;
const pinIcon = (p, sel) => { const t = typeOf(p); return L.divIcon({ className: '', iconSize: sel ? [40, 40] : [30, 30], iconAnchor: sel ? [20, 40] : [15, 30],
  html: `<div class="pin ${p.approx ? 'approx' : ''} ${sel ? 'sel' : ''}" style="--c:${css(t.v)}"><span>${t.icon}</span></div>` }); };
function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([35.676, 139.72], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(map);
  const labels = L.layerGroup(areas.map(a => L.marker([a.lat, a.lng], { interactive: false, icon: L.divIcon({ className: '', html: `<div class="area-label">${h(a.name)}</div>`, iconSize: [0, 0] }) })));
  const syncLabels = () => map.getZoom() >= 12 && map.getZoom() <= 15 ? labels.addTo(map) : labels.remove();
  map.on('zoomend', syncLabels); syncLabels();
  cluster = (L.markerClusterGroup ? L.markerClusterGroup({ maxClusterRadius: 40, disableClusteringAtZoom: 16, showCoverageOnHover: false,
    iconCreateFunction: c => L.divIcon({ className: 'marker-cluster', html: `<div>${c.getChildCount()}</div>`, iconSize: [40, 40] }) }) : L.layerGroup()).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  const lod = trip.lodging;
  if (lod.lat) L.marker([lod.lat, lod.lng], { zIndexOffset: 900, icon: L.divIcon({ className: '', iconSize: [36, 36], html: '<div class="home-pin">🏠</div>' }) })
    .on('click', () => toast(`🏠 ${lod.name}`)).addTo(map);
  map.on('contextmenu', e => setPos([e.latlng.lat, e.latlng.lng], false));  // 右鍵／長按：模擬我的位置
  map.on('moveend', () => { if (ignoreMove) { ignoreMove = false; return; } if (!S.routeDay) renderCarousel(); });
  $('#locateBtn').onclick = locate;
  const car = $('#carousel');
  car.addEventListener('scroll', () => { clearTimeout(car.t); car.t = setTimeout(() => {
    const mid = car.scrollLeft + car.clientWidth / 2;
    const c = [...car.children].reduce((a, b) => Math.abs(b.offsetLeft + b.offsetWidth / 2 - mid) < Math.abs(a.offsetLeft + a.offsetWidth / 2 - mid) ? b : a, car.children[0]);
    if (c && c.dataset.open && c.dataset.open !== S.sel) selectPlace(c.dataset.open, { pan: true, scroll: false });
  }, 140); }, { passive: true });
}
function visiblePlaces() {
  const hide = new Set(Pref.get('hideTypes', [])), mine = favsOf(S.me), fo = Pref.get('favOnly', false);
  return places.filter(p => p.lat && !hide.has(p.type) && (!fo || mine.has(p.id)));
}
function renderMap() {
  if (!map) initMap();
  setTimeout(() => map.invalidateSize(), 0);
  const hide = new Set(Pref.get('hideTypes', [])), fo = Pref.get('favOnly', false);
  const cnt = t => places.filter(p => p.type === t && p.lat).length;
  $('#mapChips').innerHTML = `<button class="chip ${fo ? 'on' : ''}" data-favonly>★ 收藏</button>` + TYPES.filter(t => cnt(t.name)).map(t =>
    `<button class="chip ${hide.has(t.name) ? 'off' : ''}" data-hide="${t.name}"><i class="sw" style="background:var(${t.v})"></i>${t.icon} ${t.name}<span class="n">${cnt(t.name)}</span></button>`).join('');
  cluster.clearLayers(); routeLayer.clearLayers(); markers = {};
  if (S.routeDay) return renderRoute();
  $('#routePill').hidden = true;
  for (const p of visiblePlaces()) {
    markers[p.id] = L.marker([p.lat, p.lng], { icon: pinIcon(p, p.id === S.sel), title: p.name }).on('click', () => selectPlace(p.id, { scroll: true }));
    cluster.addLayer(markers[p.id]);
  }
  renderCarousel(); renderAreaPill();
}
function renderRoute() {
  const d = S.routeDay, stops = dayItems(d).map(i => byId[i.place]).filter(p => p && p.lat);
  $('#routePill').hidden = false;
  $('#routePill').innerHTML = `D${dayNo(d)} ${dayLabel(d)} 路線 · ${stops.length} 站 <button data-clear-route aria-label="關閉">✕</button>`;
  const pts = [];
  if (d !== trip.dates[0] && trip.lodging.lat) pts.push([trip.lodging.lat, trip.lodging.lng]);
  stops.forEach((p, i) => {
    pts.push([p.lat, p.lng]);
    L.marker([p.lat, p.lng], { zIndexOffset: 500, icon: L.divIcon({ className: '', iconSize: [30, 30], html: `<div class="npin" style="--c:${css(typeOf(p).v)}">${i + 1}</div>` }) })
      .on('click', () => selectPlace(p.id, { scroll: true })).addTo(routeLayer);
  });
  if (pts.length > 1) L.polyline(pts, { color: css('--brand'), weight: 4, opacity: .8, dashArray: '2 8', lineCap: 'round' }).addTo(routeLayer);
  if (pts.length) { ignoreMove = true; map.fitBounds(pts, { padding: [60, 60], maxZoom: 15 }); }
  $('#carousel').innerHTML = stops.map(p => pcard(p, { compact: true })).join('');
  renderAreaPill();
}
function renderCarousel() {
  if (!map || S.routeDay) return;
  const b = map.getBounds(), c = map.getCenter();
  let list = visiblePlaces().filter(p => b.contains([p.lat, p.lng])).sort((x, y) => dist(c.lat, c.lng, x.lat, x.lng) - dist(c.lat, c.lng, y.lat, y.lng)).slice(0, 25);
  if (S.sel && byId[S.sel] && !list.some(p => p.id === S.sel)) list.unshift(byId[S.sel]);
  if (S.sel) list.sort((x, y) => (y.id === S.sel) - (x.id === S.sel));
  $('#carousel').innerHTML = list.map(p => pcard(p, { compact: true, active: p.id === S.sel })).join('');
  $('#carousel').scrollLeft = 0;
}
function selectPlace(id, { pan = true, scroll = true } = {}) {
  const prev = S.sel; S.sel = id; const p = byId[id];
  if (prev && markers[prev]) markers[prev].setIcon(pinIcon(byId[prev], false));
  if (markers[id]) markers[id].setIcon(pinIcon(p, true));
  if (pan && p.lat) { ignoreMove = true; if (markers[id] && cluster.zoomToShowLayer && !map.hasLayer(markers[id])) cluster.zoomToShowLayer(markers[id]); else map.panTo([p.lat, p.lng]); }
  const car = $('#carousel'), card = car.querySelector(`[data-open="${id}"]`);
  car.querySelectorAll('.pcard').forEach(c => c.classList.toggle('active', c.dataset.open === id));
  if (scroll) { if (card) card.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' }); else { renderCarousel(); } }
}
function locate() {
  if (!navigator.geolocation) return toast('這個瀏覽器不支援定位');
  toast('定位中…');
  navigator.geolocation.watchPosition(g => setPos([g.coords.latitude, g.coords.longitude], !locate.done), () => toast('拿不到定位（電腦上可在地圖按右鍵模擬）'),
    { enableHighAccuracy: true, maximumAge: 30000 });
}
function setPos(pos, fly = true) {
  S.pos = pos; locate.done = true;
  if (map) {
    meMarker = meMarker || L.marker(pos, { zIndexOffset: 1000, icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18] }) }).addTo(map);
    meMarker.setLatLng(pos);
    if (fly) map.setView(pos, Math.max(map.getZoom(), 15)); else renderCarousel();
  }
  renderAreaPill();
  if (S.tab === 'list') renderList();
}
function renderAreaPill() {
  const el = $('#mapArea'); if (!S.pos) return (el.hidden = true);
  const { area, km } = nearestArea(...S.pos);
  const near = places.filter(p => p.lat && dist(...S.pos, p.lat, p.lng) < 1), nf = near.filter(p => isFav(p.id)).length;
  el.hidden = false;
  el.innerHTML = km < 3 ? `你在 <b>${h(area.name)}</b> 一帶 · 1 km 內 ${near.length} 個候選${nf ? `，${nf} 個收藏` : ''}` : `離最近的熱區「${h(area.name)}」${km.toFixed(1)} km`;
}

/* ---------- 探索 ---------- */
function fillFilters() {
  const as = [...new Set(places.map(p => p.area))].sort((a, b) => places.filter(p => p.area === b).length - places.filter(p => p.area === a).length);
  $('#fArea').innerHTML += as.map(a => `<option value="${h(a)}">${h(a)}</option>`).join('');
  $('#fDay').innerHTML += trip.dates.map(d => `<option value="${d}">D${dayNo(d)} ${dayLabel(d)} 有開</option>`).join('');
  ['#q', '#fArea', '#fDay', '#fSort'].forEach(s => $(s).addEventListener('input', renderList));
  $('#fFav').onclick = () => { S.favOnly = !S.favOnly; renderList(); };
}
function renderList() {
  const q = $('#q').value.trim().toLowerCase(), fa = $('#fArea').value, fd = $('#fDay').value, fs = $('#fSort').value, mine = favsOf(S.me);
  const base = places.filter(p => (!fa || p.area === fa) && (!fd || !closedDays(p).includes(fd)) && (!S.favOnly || mine.has(p.id))
    && (!q || [p.name, p.name_en, p.subcat, p.note, p.area].join(' ').toLowerCase().includes(q)));
  $('#typeChips').innerHTML = `<button class="chip ${!S.type ? 'on' : ''}" data-type="">全部<span class="n">${base.length}</span></button>` +
    TYPES.map(t => [t, base.filter(p => p.type === t.name).length]).filter(x => x[1]).map(([t, n]) =>
      `<button class="chip ${S.type === t.name ? 'on' : ''}" data-type="${t.name}"><i class="sw" style="background:var(${t.v})"></i>${t.icon} ${t.name}<span class="n">${n}</span></button>`).join('');
  $('#fFav').classList.toggle('on', S.favOnly);
  const pop = p => trip.members.filter(m => favsOf(m.id).has(p.id)).length * 10 + (p.sharedBy?.length || 0) * 3 + (p.ig?.length || 0) + (p.src?.includes('sheet') ? 2 : 0);
  const key = { votes: p => -pop(p), name: p => p.name, dist: p => S.pos && p.lat ? dist(...S.pos, p.lat, p.lng) : 1e9 }[fs];
  const L2 = base.filter(p => !S.type || p.type === S.type).sort((a, b) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
  $('#listCount').textContent = `${L2.length} 個地點${fs === 'dist' && !S.pos ? ' · 還沒定位（到地圖按 ◎）' : ''}`;
  $('#list').innerHTML = L2.slice(0, 150).map(p => pcard(p)).join('') || '<div class="empty">沒有符合的地點</div>';
}

/* ---------- 統計 ---------- */
function renderStats() {
  const planned = plannedIds();
  $('#tiles').innerHTML = [['候選地點', places.length], ['可在地圖上看', places.filter(p => p.lat).length], ['已排進行程', planned.size],
    [S.me ? '我的收藏' : '收藏', S.me ? favsOf(S.me).size : '—']].map(([k, v]) => `<div class="tile"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
  const ts = TYPES.filter(t => places.some(p => p.type === t.name));
  $('#areaLegend').innerHTML = ts.map(t => `<span><i class="sw" style="background:var(${t.v})"></i>${t.icon} ${t.name}</span>`).join('');
  const as = [...new Set(places.map(p => p.area))].map(a => ({ a, n: places.filter(p => p.area === a).length })).sort((x, y) => y.n - x.n);
  const W = Math.max(300, $('#chartArea').clientWidth || 340), LW = 96, RW = 34, bh = 18, gap = 8, max = as[0]?.n || 1, sx = v => v / max * (W - LW - RW);
  let svg = `<svg width="${W}" height="${as.length * (bh + gap)}" role="img" aria-label="各區候選數量">`;
  as.forEach((r, i) => {
    const y = i * (bh + gap); let x = LW;
    svg += `<g data-area="${h(r.a)}"><rect x="0" y="${y - 3}" width="${W}" height="${bh + 6}" fill="transparent"/><text x="${LW - 8}" y="${y + bh - 4}" text-anchor="end">${h(r.a)}</text>`;
    const segs = ts.map(t => ({ t, n: places.filter(p => p.area === r.a && p.type === t.name).length })).filter(s => s.n);
    segs.forEach((s, j) => {
      const w = Math.max(sx(s.n) - (j < segs.length - 1 ? 2 : 0), 1), last = j === segs.length - 1;
      const d = last && w > 4 ? `M${x},${y}h${w - 4}a4,4 0 0 1 4,4v${bh - 8}a4,4 0 0 1 -4,4h${-(w - 4)}z` : `M${x},${y}h${w}v${bh}h${-w}z`;
      svg += `<path d="${d}" fill="var(${s.t.v})" data-tip="${h(r.a)} · ${s.t.name}：${s.n}"/>`; x += sx(s.n);
    });
    svg += `<text class="val" x="${x + 6}" y="${y + bh - 4}">${r.n}</text></g>`;
  });
  $('#chartArea').innerHTML = svg + '</svg>';
  const top = as.filter(r => r.a !== '未定位').slice(0, 14), mx = Math.max(1, ...top.flatMap(r => ts.map(t => places.filter(p => p.area === r.a && p.type === t.name).length)));
  $('#matrix').innerHTML = `<table><tr><th></th>${ts.map(t => `<th title="${t.name}">${t.icon}<br>${t.name.split('/')[0]}</th>`).join('')}</tr>` +
    top.map(r => `<tr><td>${h(r.a)}</td>${ts.map(t => { const n = places.filter(p => p.area === r.a && p.type === t.name).length;
      return `<td class="cell" data-area="${h(r.a)}" data-type="${t.name}" style="background:color-mix(in srgb, var(--seq) ${n ? Math.round(12 + 70 * n / mx) : 0}%, var(--card-2));${n / mx > .55 ? 'color:#fff;font-weight:700' : ''}">${n || ''}</td>`; }).join('')}</tr>`).join('') + '</table>';
}

/* ---------- 記帳 ---------- */
const toBase = (amt, cur) => cur === trip.baseCurrency ? amt : amt * (trip.fx[cur] || 1);
const presentOn = (id, date) => { const m = trip.members.find(x => x.id === id); return !date || ((!m.from || date >= m.from) && (!m.until || date <= m.until)); };
const curSym = c => c === 'JPY' ? '¥' : c === 'TWD' ? 'NT$' : c + ' ';
const twd = v => trip.fx.TWD ? `≈ NT$${fmt(v / trip.fx.TWD)}` : '';
function norm(e) { // 相容舊格式
  return { ...e, at: e.at || (e.date ? e.date + 'T12:00' : (e.createdAt || e.ts || '').slice(0, 16)), people: e.people || e.split || trip.members.map(m => m.id),
    mode: e.mode || 'equal', cat: e.cat || 'other', shares: e.shares || {} };
}
function owed(e) { // 每人應負擔（基準幣）
  e = norm(e); const total = toBase(+e.amount, e.currency), out = {};
  if (e.mode === 'amount') e.people.forEach(id => out[id] = toBase(+e.shares[id] || 0, e.currency));
  else if (e.mode === 'ratio') { const s = e.people.reduce((a, id) => a + (+e.shares[id] || 0), 0) || 1; e.people.forEach(id => out[id] = total * (+e.shares[id] || 0) / s); }
  else e.people.forEach(id => out[id] = total / e.people.length);
  return out;
}
function ledger() {
  const ex = Store.of('exp').map(norm).sort((a, b) => b.at.localeCompare(a.at));
  const bal = Object.fromEntries(trip.members.map(m => [m.id, 0])), paid = { ...bal }, share = { ...bal };
  for (const e of ex) { const v = toBase(+e.amount, e.currency); paid[e.payer] = (paid[e.payer] || 0) + v; for (const [id, o] of Object.entries(owed(e))) share[id] = (share[id] || 0) + o; }
  for (const id in bal) bal[id] = paid[id] - share[id];
  const cr = Object.entries(bal).filter(x => x[1] > 0.5).sort((a, b) => b[1] - a[1]).map(x => [...x]);
  const db = Object.entries(bal).filter(x => x[1] < -0.5).map(([k, v]) => [k, -v]).sort((a, b) => b[1] - a[1]);
  const tx = [];
  while (cr.length && db.length) { const v = Math.min(cr[0][1], db[0][1]); tx.push([db[0][0], cr[0][0], v]); cr[0][1] -= v; db[0][1] -= v; if (cr[0][1] < 0.5) cr.shift(); if (db[0][1] < 0.5) db.shift(); }
  return { ex, bal, paid, share, tx, total: ex.reduce((s, e) => s + toBase(+e.amount, e.currency), 0) };
}
function renderMoney() {
  const L0 = ledger(), me = S.me;
  $('#moneyHero').innerHTML = `<div class="k">團體總花費</div><div class="v">¥${fmt(L0.total)}<small>${twd(L0.total)}</small></div>
    <div class="grid3">
      <div><span class="k">${me ? '我付了' : '筆數'}</span><b>${me ? '¥' + fmt(L0.paid[me]) : L0.ex.length}</b></div>
      <div><span class="k">${me ? '我的花費' : '人均'}</span><b>¥${fmt(me ? L0.share[me] : L0.total / trip.members.length)}</b></div>
      <div><span class="k">${me ? (L0.bal[me] >= 0 ? '我應收' : '我應付') : '待結清'}</span><b class="${me ? (L0.bal[me] >= 0 ? 'pos' : 'neg') : ''}">${me ? '¥' + fmt(Math.abs(L0.bal[me])) : L0.tx.length + ' 筆'}</b></div>
    </div>`;
  $$('#moneySeg button').forEach(b => b.classList.toggle('on', b.dataset.mview === S.mview));
  const body = $('#moneyBody');
  if (S.mview === 'list') {
    if (!L0.ex.length) return (body.innerHTML = '<div class="empty">還沒有任何一筆<br><span class="small">按右下角 ＋ 開始記帳</span></div>');
    const groups = {}; L0.ex.forEach(e => (groups[e.at.slice(0, 10)] ||= []).push(e));
    const sub = es => es.reduce((s, e) => s + toBase(+e.amount, e.currency), 0), mySub = es => me ? es.reduce((s, e) => s + (owed(e)[me] || 0), 0) : 0;
    body.innerHTML = Object.entries(groups).map(([d, es]) => `<div class="day-group"><span>${trip.dates.includes(d) ? `D${dayNo(d)} · ` : ''}${dayLabel(d)} · ${es.length} 筆</span><span>小計 ¥${fmt(sub(es))}${me ? `<small> · 我 ¥${fmt(mySub(es))}</small>` : ''}</span></div>` +
      es.map(e => { const c = CAT[e.cat] || CAT.other, mine = me ? owed(e)[me] || 0 : null;
        return `<button class="exp" data-exp="${e.id}"><div class="icon-tile sm" style="--c:var(--seq)">${c.icon}</div>
          <div class="body"><div class="t">${h(e.title)}</div><div class="s">${e.at.slice(11, 16)} · ${h(memberName(e.payer))} 付 · ${e.people.length === trip.members.length ? '全部人' : e.people.length + ' 人'}${{ ratio: '·比例', amount: '·指定金額' }[e.mode] || ''}</div></div>
          <div class="amt">${curSym(e.currency)}${fmt(+e.amount)}${mine != null ? `<small class="${mine ? '' : 'muted'}">${mine ? '我 ¥' + fmt(mine) : '與我無關'}</small>` : ''}</div></button>`; }).join('')).join('') +
      `<div class="grand"><span>總計 · ${L0.ex.length} 筆</span><b>¥${fmt(L0.total)}</b><small>${twd(L0.total)}${me ? ` · 我 ¥${fmt(L0.share[me])}` : ''}</small></div>`;
  } else if (S.mview === 'daily') {
    const days = [...new Set([...trip.dates, ...L0.ex.map(e => e.at.slice(0, 10))])].sort(), ms = trip.members;
    const cell = (d, id) => L0.ex.filter(e => e.at.slice(0, 10) === d).reduce((s, e) => s + (id ? owed(e)[id] || 0 : toBase(+e.amount, e.currency)), 0);
    body.innerHTML = `<div class="panel" style="margin-top:0"><div class="panel-head"><h3>每日小計</h3><span class="muted small">每人＝應負擔金額（¥）</span></div>
      <div class="matrix"><table class="daily"><tr><th>日期</th>${ms.map(m => `<th>${av(m.id)}</th>`).join('')}<th>小計</th></tr>
      ${days.map(d => `<tr><td>${trip.dates.includes(d) ? `<b>D${dayNo(d)}</b> ` : ''}${md(d)}</td>${ms.map(m => { const v = cell(d, m.id); return `<td class="${v ? '' : 'muted'}">${v ? fmt(v) : '–'}</td>`; }).join('')}<td><b>${fmt(cell(d))}</b></td></tr>`).join('')}
      <tr class="total"><td>總計</td>${ms.map(m => `<td>${fmt(L0.share[m.id])}</td>`).join('')}<td>${fmt(L0.total)}</td></tr></table></div>
      <div class="muted small" style="margin-top:8px">總計 ¥${fmt(L0.total)}（${twd(L0.total)}）· 匯率 1 TWD = ${trip.fx.TWD} JPY</div></div>`;
  } else if (S.mview === 'settle') {
    body.innerHTML = `<div class="sec-head"><h3>結清建議</h3><span>最少轉帳次數</span></div>` +
      (L0.tx.length ? L0.tx.map(([a, b, v]) => `<div class="settle">${av(a)}<b>${h(memberName(a))}</b><span class="arrow">${ICON.arrow}</span>${av(b)}<b>${h(memberName(b))}</b>
        <div class="amt">¥${fmt(v)}<small>${twd(v)}</small></div></div>`).join('') : '<div class="empty">目前不用轉帳 👍</div>') +
      `<div class="sec-head"><h3>每人收支</h3><span>付出 − 應負擔</span></div><div class="panel" style="margin-top:0">` +
      trip.members.map(m => `<div class="bal">${av(m.id)}<div><b>${h(m.name)}</b><div class="muted small">付 ¥${fmt(L0.paid[m.id])} · 花 ¥${fmt(L0.share[m.id])}</div></div>
        <div class="amt ${L0.bal[m.id] >= 0 ? 'pos' : 'neg'}">${L0.bal[m.id] >= 0 ? '+' : '−'}¥${fmt(Math.abs(L0.bal[m.id]))}</div></div>`).join('') + '</div>';
  } else {
    const byCat = CATS.map(c => ({ c, v: L0.ex.filter(e => e.cat === c.id).reduce((s, e) => s + toBase(+e.amount, e.currency), 0) })).filter(x => x.v).sort((a, b) => b.v - a.v);
    const mx = byCat[0]?.v || 1;
    body.innerHTML = `<div class="panel" style="margin-top:0"><div class="panel-head"><h3>花費分類</h3><span class="muted small">團體合計</span></div>` +
      (byCat.map(x => `<div class="catbar" data-tip="${x.c.name}：¥${fmt(x.v)}（${Math.round(x.v / L0.total * 100)}%）"><span>${x.c.icon} ${x.c.name}</span><div class="track"><div class="fill" style="width:${x.v / mx * 100}%"></div></div><span class="v">¥${fmt(x.v)}</span></div>`).join('') || '<div class="muted">還沒有資料</div>') + '</div>';
  }
}

function openExpense(id) {
  const old = id ? norm(Store.of('exp').find(r => r.id === id)) : null;
  const at0 = old?.at || nowLocal();
  const F = old ? { ...old, shares: { ...old.shares }, people: [...old.people] } : {
    amount: '', currency: Pref.get('cur', 'JPY'), title: '', cat: 'food', at: at0, payer: S.me || trip.members[0].id,
    people: trip.members.filter(m => presentOn(m.id, at0.slice(0, 10))).map(m => m.id), mode: 'equal', shares: {} };
  let touchedPeople = !!old;
  const total = () => +F.amount || 0;
  const defaults = () => { if (F.mode === 'ratio') F.people.forEach(i => F.shares[i] = F.shares[i] || 1);
    if (F.mode === 'amount') { const t = total(), each = Math.floor(t / (F.people.length || 1)); F.people.forEach((i, k) => F.shares[i] = k === 0 ? t - each * (F.people.length - 1) : each); } };
  const calcHtml = () => {
    const t = total(), n = F.people.length || 1;
    if (F.mode === 'equal') return `<div class="split-sum"><span>${F.people.length} 人均分</span><b>每人 ${curSym(F.currency)}${fmt(t / n)}</b></div>`;
    if (F.mode === 'ratio') { const s = F.people.reduce((a, i) => a + (+F.shares[i] || 0), 0);
      return `<div class="split-sum ${s ? '' : 'bad'}"><span>比例合計 ${s || 0}</span><b>${s ? '依比例自動換算' : '比例不能全為 0'}</b></div>`; }
    const s = F.people.reduce((a, i) => a + (+F.shares[i] || 0), 0), d = t - s;
    return `<div class="split-sum ${Math.abs(d) < 1 ? '' : 'bad'}"><span>已分配 ${curSym(F.currency)}${fmt(s)} / ${fmt(t)}</span><b>${Math.abs(d) < 1 ? '✓ 剛好' : d > 0 ? `還差 ${fmt(d)}` : `超過 ${fmt(-d)}`}</b></div>`;
  };
  const rowCalc = i => { const t = total();
    if (F.mode === 'ratio') { const s = F.people.reduce((a, j) => a + (+F.shares[j] || 0), 0) || 1; return curSym(F.currency) + fmt(t * (+F.shares[i] || 0) / s); }
    return t ? Math.round((+F.shares[i] || 0) / t * 100) + '%' : ''; };
  const draw = () => openSheet(`
    <h2>${old ? '編輯這筆' : '記一筆'}</h2>
    <div class="field"><div class="amount-row"><span class="cur">${curSym(F.currency)}</span><input id="fAmt" inputmode="decimal" placeholder="0" value="${h(F.amount)}" aria-label="金額"></div></div>
    <div class="seg" data-g="currency">${['JPY', 'TWD'].map(c => `<button class="${F.currency === c ? 'on' : ''}" data-v="${c}">${c === 'JPY' ? '¥ 日圓' : 'NT$ 台幣'}</button>`).join('')}</div>
    <div class="field"><label for="fTitle">這次是什麼</label><input class="input" id="fTitle" placeholder="例：Peter Luger 午餐、Suica 加值" value="${h(F.title)}" maxlength="40"></div>
    <div class="field"><span class="field-label">類別</span><div class="cat-grid">${CATS.map(c => `<button class="cat-btn ${F.cat === c.id ? 'on' : ''}" data-cat="${c.id}"><i>${c.icon}</i>${c.name}</button>`).join('')}</div></div>
    <div class="field"><label for="fAt">消費時間</label><input class="input" id="fAt" type="datetime-local" value="${h(F.at)}"></div>
    <div class="field"><span class="field-label">誰付的錢</span><div class="people">${trip.members.map(m => `<button class="person ${F.payer === m.id ? 'on' : ''}" data-payer="${m.id}">${av(m.id)}${h(m.name)}</button>`).join('')}</div></div>
    <div class="field"><span class="field-label">分給誰</span><div class="people">
      <button class="person ${F.people.length === trip.members.length ? 'on' : ''}" data-all><span class="av" style="--c:var(--ink-2)">全</span>所有人</button>
      ${trip.members.map(m => `<button class="person ${F.people.includes(m.id) ? 'on' : ''}" data-p="${m.id}">${av(m.id)}${h(m.name)}${presentOn(m.id, F.at.slice(0, 10)) ? '' : ' <span class="muted small">不在</span>'}</button>`).join('')}</div></div>
    <div class="field"><span class="field-label">怎麼分</span>
      <div class="seg" data-g="mode">${[['equal', '均分'], ['ratio', '按比例'], ['amount', '按金額']].map(([v, t]) => `<button class="${F.mode === v ? 'on' : ''}" data-v="${v}">${t}</button>`).join('')}</div>
      ${F.mode !== 'equal' ? `<div class="split-rows">${F.people.map(i => `<div class="split-row"><span class="who">${av(i)}${h(memberName(i))}</span>
        <input inputmode="decimal" data-share="${i}" value="${h(F.shares[i] ?? '')}" placeholder="${F.mode === 'ratio' ? '份數' : '金額'}" aria-label="${h(memberName(i))}">
        <span class="calc" data-calc="${i}">${rowCalc(i)}</span></div>`).join('')}</div>` : ''}
      <div id="splitSum">${calcHtml()}</div>
    </div>
    ${old ? `<div class="muted small">🕒 ${h(memberName(old.createdBy || old.by))} 建立於 ${h(fmtTs(old.createdAt || old.ts))}${old.ts && old.ts !== old.createdAt ? ` · ${h(memberName(old.by))} 最後修改 ${h(fmtTs(old.ts))}` : ''}</div>` : ''}
    <div class="form-foot"><button class="btn" data-save>${old ? '儲存修改' : '新增'}</button>${old ? '<button class="btn danger" data-del>刪除這筆</button>' : ''}</div>`, bind);
  const keep = el => { F.amount = el.querySelector('#fAmt').value; F.title = el.querySelector('#fTitle').value; F.at = el.querySelector('#fAt').value || F.at; };
  function bind(el) {
    el.querySelector('#fAmt').oninput = e => { F.amount = e.target.value.replace(/[^\d.]/g, ''); if (F.mode === 'amount' && !touchedShares) { defaults(); el.querySelectorAll('[data-share]').forEach(i => i.value = F.shares[i.dataset.share]); } refresh(el); };
    el.querySelector('#fAt').onchange = e => { F.at = e.target.value; if (!touchedPeople) { keep(el); F.people = trip.members.filter(m => presentOn(m.id, F.at.slice(0, 10))).map(m => m.id); defaults(); draw(); } };
    el.querySelectorAll('[data-g] button').forEach(b => b.onclick = () => { keep(el); const g = b.parentElement.dataset.g; F[g] = b.dataset.v; if (g === 'mode') { touchedShares = false; defaults(); } if (g === 'currency') Pref.set('cur', F.currency); draw(); });
    el.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { keep(el); F.cat = b.dataset.cat; draw(); });
    el.querySelectorAll('[data-payer]').forEach(b => b.onclick = () => { keep(el); F.payer = b.dataset.payer; draw(); });
    el.querySelector('[data-all]').onclick = () => { keep(el); touchedPeople = true; F.people = F.people.length === trip.members.length ? [] : trip.members.map(m => m.id); defaults(); draw(); };
    el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { keep(el); touchedPeople = true; const i = b.dataset.p;
      F.people = F.people.includes(i) ? F.people.filter(x => x !== i) : trip.members.map(m => m.id).filter(x => x === i || F.people.includes(x)); defaults(); draw(); });
    el.querySelectorAll('[data-share]').forEach(inp => inp.oninput = () => { touchedShares = true; F.shares[inp.dataset.share] = inp.value.replace(/[^\d.]/g, ''); refresh(el); });
    el.querySelector('[data-save]').onclick = () => save(el);
    const del = el.querySelector('[data-del]'); if (del) del.onclick = async () => { if (!confirm('確定刪除這筆？')) return; await Store.del(old.id); closeSheet(); toast('已刪除'); renderMoney(); };
  }
  let touchedShares = !!old && old.mode === 'amount';
  function refresh(el) { el.querySelector('#splitSum').innerHTML = calcHtml(); F.people.forEach(i => { const c = el.querySelector(`[data-calc="${i}"]`); if (c) c.textContent = rowCalc(i); }); el.querySelector('.cur').textContent = curSym(F.currency); }
  async function save(el) {
    keep(el);
    const t = total();
    if (!t) return toast('請輸入金額');
    if (!F.people.length) return toast('至少分給一個人');
    if (F.mode === 'ratio' && !F.people.some(i => +F.shares[i] > 0)) return toast('比例不能全為 0');
    if (F.mode === 'amount' && Math.abs(F.people.reduce((a, i) => a + (+F.shares[i] || 0), 0) - t) >= 1) return toast('分配金額加總要等於總金額');
    const shares = F.mode === 'equal' ? {} : Object.fromEntries(F.people.map(i => [i, +F.shares[i] || 0]));
    await Store.put({ ...(old || {}), kind: 'exp', amount: t, currency: F.currency, title: F.title.trim() || CAT[F.cat].name, cat: F.cat, at: F.at,
      payer: F.payer, people: F.people, mode: F.mode, shares, split: undefined, date: undefined });
    closeSheet(); toast(old ? '已更新' : '已記下 ✓'); S.mview = 'list'; renderMoney();
  }
  draw();
}
const fmtTs = iso => { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/* ---------- 主流程 ---------- */
function render() {
  $$('.tab').forEach(s => s.hidden = s.id !== 'tab-' + S.tab);
  $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  ({ plan: renderPlan, map: renderMap, list: renderList, stats: renderStats, money: renderMoney })[S.tab]();
}
function go(tab) { S.tab = tab; Pref.set('tab', tab); render(); scrollTo(0, 0); }
function bind() {
  $$('.tabbar button').forEach(b => b.onclick = () => go(b.dataset.tab));
  $('#meBtn').onclick = pickMe;
  $('#backdrop').onclick = () => closeSheet();
  $('#addExpBtn').onclick = () => openExpense();
  $('#moneySeg').onclick = e => { const b = e.target.closest('[data-mview]'); if (b) { S.mview = b.dataset.mview; renderMoney(); } };
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-fav],[data-day],[data-hide],[data-favonly],[data-type],[data-route],[data-clear-route],[data-exp],[data-pedit-tl],[data-open],[data-area]');
    if (!t || t.closest('#sheet')) return;
    if (t.dataset.fav) { e.stopPropagation(); return toggleFav(t.dataset.fav); }
    if (t.dataset.day) { S.day = t.dataset.day; return renderPlan(); }
    if (t.dataset.hide) { const s = new Set(Pref.get('hideTypes', [])); s.has(t.dataset.hide) ? s.delete(t.dataset.hide) : s.add(t.dataset.hide); Pref.set('hideTypes', [...s]); return renderMap(); }
    if ('favonly' in t.dataset) { Pref.set('favOnly', !Pref.get('favOnly', false)); return renderMap(); }
    if ('type' in t.dataset && t.classList.contains('chip')) { S.type = t.dataset.type; return renderList(); }
    if (t.dataset.route) { S.routeDay = t.dataset.route; return go('map'); }
    if ('clearRoute' in t.dataset) { S.routeDay = null; return renderMap(); }
    if (t.dataset.exp) return openExpense(t.dataset.exp);
    if (t.dataset.peditTl) { const it = findItem(t.dataset.peditTl); return openAddPlan(it.place, it); }
    if (t.dataset.open) { if (S.tab === 'map' && t.closest('#carousel') && S.sel !== t.dataset.open) return selectPlace(t.dataset.open, { scroll: true }); return openPlace(t.dataset.open); }
    if (t.dataset.area) { $('#fArea').value = t.dataset.area; S.type = t.dataset.type || ''; go('list'); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); if (e.key === 'Enter' && e.target.matches('[data-open][role=button]')) e.target.click(); });
  const tip = $('#tip');
  document.addEventListener('mousemove', e => {
    const t = e.target.closest('[data-tip]'); if (!t) return (tip.hidden = true);
    tip.hidden = false; tip.textContent = t.dataset.tip;
    tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY - 38) + 'px';
  });
}
async function main() {
  const j = u => fetch(u).then(r => r.json());
  [trip, places, areas] = await Promise.all([j(CFG.tripFile), j(CFG.placesFile), j(CFG.areasFile)]);
  byId = Object.fromEntries(places.map(p => [p.id, p]));
  document.title = trip.title; $('#appTitle').textContent = trip.short || trip.title;
  S.tab = Pref.get('tab', 'plan');
  renderMe(); fillFilters(); bind();
  await Store.load(); renderSync();
  render();
  setInterval(refresh, 20000);
  document.addEventListener('visibilitychange', refresh);
  if (!S.me) setTimeout(pickMe, 400);
}
main();
})();
