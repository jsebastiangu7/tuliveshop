/* ===== Pandala Kawaii · Panel Administrador (Parte B) ===== */
let token = localStorage.getItem('token') || '';
let user = JSON.parse(localStorage.getItem('user') || 'null');
let CFG = null, PRODUCTS = [], KITS = [], CATS = [], CLIENTS = [], ORDERS = [];
let ANALYTICS = null, GOALS = [], DONATIONS = [], LOGIS = [];
let curOrderId = null, logoData = null, wmData = null, wmW = 0, wmH = 0;
let legalDoc = 'privacy';

const $ = (id) => document.getElementById(id);
const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);
const pdfMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const STATUS_LABEL = { draft: 'Borrador', pending_confirm: 'Por confirmar', apartada: 'Apartada', paid: 'Pagada', shipped: 'Enviada', delivered: 'Entregada', canceled: 'Cancelada', expired: 'Vencida' };
const STATUS_CLASS = { draft: '', pending_confirm: 'warn', apartada: 'warn', paid: 'ok', shipped: 'ok', delivered: 'ok', canceled: 'danger', expired: 'danger' };
const pill = (s) => `<span class="pill ${STATUS_CLASS[s] || ''}">${STATUS_LABEL[s] || esc(s)}</span>`;
const pillStock = (s) => `<span class="pill ${s === 'EN STOCK' ? 'ok' : s === 'AGOTADO' ? 'danger' : 'warn'}">${s}</span>`;
const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.includes('/auth/')) { logout(); throw new Error('Sesión vencida: ingresa de nuevo'); }
  if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
  return data;
}
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 3200); }
function closeModal(id) { $(id).classList.remove('open'); }
function openModal(id) { $(id).classList.add('open'); }

/* ---------- Apariencia ---------- */
function setTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === mode));
  localStorage.setItem('uiTheme', mode);
  if ($('uiThemeSel')) $('uiThemeSel').value = mode;
}
function setLayout(mode) {
  document.body.classList.toggle('layout-side', mode === 'side');
  document.querySelectorAll('.layout-btn').forEach(b => b.classList.toggle('active', b.dataset.layout === mode));
  localStorage.setItem('uiLayout', mode);
  if ($('uiLayoutSel')) $('uiLayoutSel').value = mode;
}

/* ---------- Sesión ---------- */
function init() {
  setTheme(localStorage.getItem('uiTheme') || 'light');
  setLayout(localStorage.getItem('uiLayout') || 'top');
  if (user && token && user.role === 'super_admin') { location.href = '/super.html'; return; }
  if (user && token && user.role === 'admin') enterPanel();
  else showLogin();
}
function showLogin() {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-login').classList.add('active');
  $('hdr').classList.add('hidden');
}
function enterPanel() {
  $('hdr').classList.remove('hidden');
  $('whoName').textContent = user.name;
  showTab('dash');
}
async function adminLogin(ev) {
  ev.preventDefault(); $('aErr').textContent = '';
  try {
    const d = await api('/api/auth/admin/login', { method: 'POST', body: { email: $('aEmail').value.trim(), password: $('aPass').value } });
    token = d.token; user = d.user;
    localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user));
    if (d.portfolio) localStorage.setItem('portfolio', JSON.stringify(d.portfolio));
    if (user.role === 'super_admin') { location.href = '/super.html'; return; }
    enterPanel();
  } catch (e) { $('aErr').textContent = e.message; }
}
function logout() {
  token = ''; user = null;
  localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('portfolio');
  closeUserMenu();
  showLogin();
}

/* ---------- Menú del administrador (Configuración / Legal / Salir) ---------- */
function toggleUserMenu() { $('userMenu').classList.toggle('hidden'); }
function closeUserMenu() { $('userMenu').classList.add('hidden'); }
function menuGo(v) { closeUserMenu(); showTab(v); }
document.addEventListener('click', (e) => { if (!e.target.closest('.who-wrap')) closeUserMenu(); });

/* ---------- Navegación ---------- */
const TABS = [['dash', 'Dashboard'], ['abonos', 'Abonos por confirmar'], ['inv', 'Inventario'], ['kits', 'Kits'], ['cats', 'Categorías'], ['clients', 'Clientes'], ['orders', 'Pedidos'], ['logis', 'Logística'], ['import', 'Importar JSON']];
let currentTab = 'dash';
function renderTabs() { $('tabs').innerHTML = TABS.map(([id, t]) => `<button class="chip ${currentTab === id ? 'active' : ''}" onclick="showTab('${id}')">${t}</button>`).join(''); }
function showTab(id) {
  currentTab = id; renderTabs();
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const v = $('view-' + id); if (v) v.classList.add('active');
  loadTab(id);
}
const LOADERS = { dash: loadDash, abonos: loadReports, inv: loadInventory, kits: loadKits, cats: loadCats, clients: loadClients, orders: loadOrders, logis: loadLogistics, config: loadConfig, legal: loadLegal };
async function loadTab(id) {
  if (id === 'import') return;
  try { await LOADERS[id](); } catch (e) { toast('⚠ ' + e.message); }
}
async function fetchCaches() {
  const [p, k, c] = await Promise.all([api('/api/admin/products'), api('/api/admin/kits'), api('/api/admin/categories')]);
  PRODUCTS = p; KITS = k; CATS = c;
}

/* ---------- Legal ---------- */
function loadLegal() { renderLegal(); }
function setLegalDoc(k) { legalDoc = k; renderLegal(); }
function renderLegal() {
  if (!window.LEGAL_DOCS) { $('legalContent').innerHTML = '<p class="note">Textos legales no cargados (legal-docs.js).</p>'; return; }
  const lang = $('legalLang').value || 'es';
  $('legalContent').innerHTML = window.LEGAL_DOCS[legalDoc][lang];
  $('legalBtnPrivacy').className = 'btn' + (legalDoc === 'privacy' ? ' primary' : '');
  $('legalBtnTerms').className = 'btn' + (legalDoc === 'terms' ? ' primary' : '');
}

/* ---------- Gráficas SVG ---------- */
const CH_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
const compactMoney = n => { const a = Math.abs(n), sg = n < 0 ? '-' : ''; if (a >= 1e9) return sg + '$' + (a / 1e9).toFixed(1).replace(/\.0$/, '') + ' MM'; if (a >= 1e6) return sg + '$' + (a / 1e6).toFixed(1).replace(/\.0$/, '') + ' M'; if (a >= 1e3) return sg + '$' + Math.round(a / 1e3) + ' k'; return sg + '$' + Math.round(a); };
function niceMax(v) { if (!(v > 0)) return 1; const pw = Math.pow(10, Math.floor(Math.log10(v))), f = v / pw; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pw; }
const emptyChart = '<div class="empty">Sin datos para graficar.</div>';
const legendHtml = items => '<div class="legend">' + items.map(it => `<span><i style="background:${it.color}"></i>${esc(it.text)}</span>`).join('') + '</div>';
function chartBars(id, labels, series, opt) {
  const el = $(id); if (!el) return; opt = opt || {};
  const all = series.flatMap(sr => sr.values.map(v => Number(v) || 0));
  if (!labels.length || !all.some(v => v !== 0)) { el.innerHTML = emptyChart; return; }
  const W = 640, H = opt.h || 230, ml = 58, mr = 10, mt = 12, mb = 36, fmt = opt.fmt || compactMoney, full = opt.full || money;
  const mx = Math.max(0, ...all), mn = Math.min(0, ...all);
  const top = mx > 0 ? niceMax(mx) : niceMax(-mn) / 4, bot = mn < 0 ? -niceMax(-mn) : 0;
  const y = v => mt + (H - mt - mb) * (top - v) / (top - bot);
  const n = labels.length, gw = (W - ml - mr) / n, bw = Math.min(36, gw * 0.78 / series.length), step = Math.ceil(n / 12);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = bot + (top - bot) * i / 4, yy = y(v); g += `<line x1="${ml}" x2="${W - mr}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="var(--border)" stroke-width="1"/><text x="${ml - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(fmt(v))}</text>`; }
  series.forEach((sr, si) => sr.values.forEach((v, i) => {
    v = Number(v) || 0; const x = ml + gw * i + (gw - bw * series.length) / 2 + bw * si, y0 = y(0), y1 = y(v);
    g += `<rect x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(v ? 1 : 0, Math.abs(y0 - y1)).toFixed(1)}" rx="2" fill="${sr.color || CH_COLORS[si % CH_COLORS.length]}"><title>${esc(labels[i])} — ${esc(sr.name)}: ${esc(full(v))}</title></rect>`;
  }));
  labels.forEach((l, i) => { if (i % step) return; g += `<text x="${(ml + gw * i + gw / 2).toFixed(1)}" y="${H - mb + 14}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(l)}</text>`; });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>` + (series.length > 1 ? legendHtml(series.map((sr, si) => ({ color: sr.color || CH_COLORS[si % CH_COLORS.length], text: sr.name }))) : '');
}
function chartDonut(id, items, opt) {
  const el = $(id); if (!el) return; opt = opt || {};
  const full = opt.full || money;
  let list = items.filter(it => Number(it.value) > 0).sort((a, b) => b.value - a.value);
  if (list.length > 7) { const rest = list.slice(6).reduce((a, it) => a + it.value, 0); list = [...list.slice(0, 6), { label: 'Otros', value: rest }]; }
  const tot = list.reduce((a, it) => a + it.value, 0);
  if (!list.length || !(tot > 0)) { el.innerHTML = emptyChart; return; }
  const C = 85, R = 78, r = 48; let ang = -Math.PI / 2, arcs = '';
  list.forEach((it, i) => {
    it.color = it.color || CH_COLORS[i % CH_COLORS.length];
    const frac = it.value / tot;
    if (list.length === 1) { arcs += `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${it.color}" stroke-width="${R - r}"><title>${esc(it.label)}: ${esc(full(it.value))} (100%)</title></circle>`; return; }
    const a1 = ang + frac * 2 * Math.PI, lg = frac > 0.5 ? 1 : 0, pt = (rad, a) => [(C + rad * Math.cos(a)).toFixed(2), (C + rad * Math.sin(a)).toFixed(2)];
    const [x0, y0] = pt(R, ang), [x1, y1] = pt(R, a1), [x2, y2] = pt(r, a1), [x3, y3] = pt(r, ang);
    arcs += `<path d="M${x0} ${y0} A${R} ${R} 0 ${lg} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${lg} 0 ${x3} ${y3} Z" fill="${it.color}"><title>${esc(it.label)}: ${esc(full(it.value))} (${(frac * 100).toFixed(1)}%)</title></path>`;
    ang = a1;
  });
  const center = `<text x="${C}" y="${C - 2}" text-anchor="middle" font-size="11" fill="var(--muted)">Total</text><text x="${C}" y="${C + 14}" text-anchor="middle" font-size="13" font-weight="700" fill="currentColor">${esc((opt.fmt || compactMoney)(tot))}</text>`;
  el.innerHTML = `<div class="donutwrap"><svg viewBox="0 0 170 170" role="img">${arcs}${center}</svg><div class="legend">${list.map(it => `<span><i style="background:${it.color}"></i>${esc(it.label)} — <b>${(it.value / tot * 100).toFixed(1)}%</b> · ${esc(full(it.value))}</span>`).join('')}</div></div>`;
}
function chartHBars(id, items, opt) {
  const el = $(id); if (!el) return; opt = opt || {}; const full = opt.full || money;
  const list = items.filter(it => Number(it.value) > 0);
  if (!list.length) { el.innerHTML = emptyChart; return; }
  const mx = Math.max(...list.map(it => it.value));
  el.innerHTML = '<div class="hbars">' + list.map((it, i) => `<div class="row"><span class="lbl" title="${esc(it.label)}">${esc(it.label)}</span><span class="bar"><b style="width:${(it.value / mx * 100).toFixed(1)}%;background:${it.color || CH_COLORS[0]}"></b></span><span class="val">${esc(it.extra ? it.extra + ' · ' : '')}${esc(full(it.value))}</span></div>`).join('') + '</div>';
}
const mesLabel = k => MES_CORTO[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(2, 4);
function monthKeysBack(n, endKey) { let y = Number(endKey.slice(0, 4)), m = Number(endKey.slice(5, 7)), out = []; for (let i = 0; i < n; i++) { out.unshift(y + '-' + String(m).padStart(2, '0')); m--; if (m < 1) { m = 12; y--; } } return out; }

/* ---------- Utilidad: periodos ---------- */
const withShip = () => $('utilShip') ? $('utilShip').checked : true;
function salesLines() {
  if (!ANALYTICS) return [];
  const s = withShip();
  return ANALYTICS.salesLines.map(r => ({ ...r, costo: s ? (r.costo + r.envio) : r.costo }));
}
function utilPeriod() {
  const v = $('utilView').value, y = Number($('utilYear').value) || new Date().getFullYear();
  if (v === 'total') return { from: '0000-01-01', to: '9999-12-31', label: 'Todo el historial' };
  if (v === 'dia') { let f = $('utilFrom').value || today(), t = $('utilTo').value || f; if (t < f) [f, t] = [t, f]; return { from: f, to: t, label: f === t ? f : `${f} a ${t}` }; }
  if (v === 'semana') { const base = new Date(($('utilWeek').value || today()) + 'T12:00:00Z'); const dow = (base.getUTCDay() + 6) % 7; const mon = new Date(base.getTime() - dow * 86400000), sun = new Date(mon.getTime() + 6 * 86400000); const iso = d => d.toISOString().slice(0, 10); return { from: iso(mon), to: iso(sun), label: `Semana ${iso(mon)} a ${iso(sun)}` }; }
  if (v === 'mes') { const m = Number($('utilMonth').value); const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); const mm = String(m + 1).padStart(2, '0'); return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}`, label: `${MONTHS_ES[m]} ${y}` }; }
  if (v === 'semestre') { const sm = $('utilSem').value === '2'; return { from: `${y}-${sm ? '07' : '01'}-01`, to: `${y}-${sm ? '12-31' : '06-30'}`, label: `Semestre ${sm ? 2 : 1} de ${y}` }; }
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: `Año ${y}` };
}
function yearOptions() {
  const ys = new Set([new Date().getFullYear()]);
  (ANALYTICS ? ANALYTICS.salesLines : []).forEach(r => { const y = parseInt(String(r.fecha).slice(0, 4)); if (y) ys.add(y); });
  return [...ys].sort((a, b) => b - a);
}
function fillSelectKeep(sel, html, def) { const cur = sel.value; sel.innerHTML = html; sel.value = [...sel.options].some(o => o.value === cur) ? cur : def; }
function profitConfig() {
  const c = (CFG && CFG.profit_config) || {};
  return { diezmoPct: Number(c.diezmoPct ?? 10), ofrendaPct: Number(c.ofrendaPct ?? 10), reinvEnabled: c.reinvEnabled !== false, reinvPct: Number(c.reinvPct ?? 40) };
}
function investmentOf(key) {
  return PRODUCTS.filter(p => String(p.purchase_date || '').slice(0, 7) === key)
    .reduce((a, p) => a + (Number(p.stock) || 0) * ((Number(p.cost) || 0) + (Number(p.shipping_cost) || 0)), 0);
}
function monthProfit(key) {
  const rows = salesLines().filter(r => String(r.fecha).slice(0, 7) === key);
  return rows.reduce((a, r) => a + r.venta, 0) - rows.reduce((a, r) => a + r.costo, 0);
}

/* ---------- Dashboard ---------- */
async function loadDash() {
  const [d, an, goals, dons, logis, clients, orders] = await Promise.all([
    api('/api/admin/dashboard'), api('/api/admin/analytics'), api('/api/admin/goals'),
    api('/api/admin/donations'), api('/api/admin/logistics'), api('/api/admin/clients'), api('/api/admin/orders'),
  ]);
  ANALYTICS = an; GOALS = goals; DONATIONS = dons; LOGIS = logis; CLIENTS = clients; ORDERS = orders;
  if (!CFG) CFG = await api('/api/admin/settings');
  $('mVentas').textContent = money(d.ventas); $('mAbonos').textContent = money(d.abonos); $('mSaldo').textContent = money(d.saldo);
  $('mAbiertos').textContent = d.abiertos; $('mStock').textContent = d.stockBajo;
  renderSummary(); renderResumenCharts();
  renderUtilidad();
  renderProfitBox(); renderGoalsBox(); renderInventoryValue();
  renderLogisDash(); fillDashboardClients(); renderClientOrders(); renderRecent(); renderLow();
}
function renderSummary() {
  const pc = profitConfig();
  const nowK = today().slice(0, 7), prevK = monthKeysBack(2, nowK)[0];
  const utilM = monthProfit(nowK), utilP = monthProfit(prevK);
  const diez = utilM * pc.diezmoPct / 100, ofr = utilM * pc.ofrendaPct / 100;
  const reinvS = pc.reinvEnabled ? utilM * pc.reinvPct / 100 : 0;
  const libre = utilM - diez - ofr - reinvS;
  const act = GOALS.filter(g => g.active);
  const topGoal = act.map(g => ({ ...g, pct: g.target > 0 ? Math.min(100, g.contributed / g.target * 100) : 0 })).sort((a, b) => b.pct - a.pct)[0];
  const delta = utilP !== 0 ? ((utilM - utilP) / Math.abs(utilP) * 100) : null;
  $('dashSummary').innerHTML = `
  <div class="grid cards3">
    <div class="card"><div class="label">Utilidad neta del mes</div><div class="metric">${money(utilM)}</div>
      <div class="note">${delta === null ? 'Sin mes anterior para comparar' : (delta >= 0 ? '▲ ' : '▼ ') + Math.abs(delta).toFixed(1) + '% vs mes anterior (' + money(utilP) + ')'}</div></div>
    <div class="card"><div class="label">Libre del mes</div><div class="metric">${money(libre)}</div>
      <div class="note">después de diezmo, ofrenda${pc.reinvEnabled ? ' y reinversión sugerida' : ''}</div></div>
    <div class="card"><div class="label">Objetivos</div><div class="metric">${topGoal ? topGoal.pct.toFixed(0) + '%' : '—'}</div>
      <div class="note">${topGoal ? esc(topGoal.name) + ' · ' + act.length + ' activo(s)' : GOALS.length + ' objetivo(s) · ninguno activo'}</div></div>
    <div class="card"><div class="label">Reinversión sugerida</div><div class="metric">${pc.reinvEnabled ? money(reinvS) : 'Desactivada'}</div>
      <div class="note">listo para reponer inventario top</div></div>
  </div>
  <div class="grid dashboard-grid" style="margin-top:14px">
    <div class="panel"><h2>Cumplimiento de objetivos</h2><div id="sumGoals"></div></div>
    <div class="panel"><h2>Reinversión: sugerida vs real</h2><div id="sumReinv"></div></div>
  </div>`;
  const actG = GOALS.filter(g => g.active);
  if (actG.length) chartHBars('sumGoals', actG.map(g => ({ label: g.name, value: g.contributed, extra: (g.target > 0 ? Math.min(100, g.contributed / g.target * 100).toFixed(0) + '%' : '') })), { full: money });
  else $('sumGoals').innerHTML = '<div class="empty">Sin objetivos activos. Créalos en Configuración.</div>';
  const keys = monthKeysBack(6, nowK);
  chartBars('sumReinv', keys.map(mesLabel), [
    { name: 'Reinversión sugerida', values: keys.map(k => monthProfit(k) * pc.reinvPct / 100), color: CH_COLORS[0] },
    { name: 'Invertido en inventario', values: keys.map(k => investmentOf(k)), color: CH_COLORS[2] },
  ], { label: 'Reinversión sugerida vs real' });
}
function renderResumenCharts() {
  const act = ORDERS.filter(o => o.status !== 'canceled');
  const keys = monthKeysBack(6, today().slice(0, 7));
  const ven = Object.fromEntries(keys.map(k => [k, 0])), abo = Object.fromEntries(keys.map(k => [k, 0]));
  (ANALYTICS.salesLines || []).forEach(r => { const k = String(r.fecha).slice(0, 7); if (k in ven) ven[k] += r.venta; });
  (ANALYTICS.paysMonth || []).forEach(p => { if (p.month in abo) abo[p.month] = p.amount; });
  chartBars('chResumen', keys.map(mesLabel), [{ name: 'Ventas', values: keys.map(k => ven[k]), color: CH_COLORS[0] }, { name: 'Abonos', values: keys.map(k => abo[k] || 0), color: CH_COLORS[2] }], { label: 'Ventas y abonos por mes' });
  const total = act.reduce((a, o) => a + o.total, 0), cobrado = act.reduce((a, o) => a + Math.min(o.paid, o.total), 0);
  chartDonut('chCobro', [{ label: 'Cobrado', value: cobrado, color: CH_COLORS[0] }, { label: 'Pendiente', value: Math.max(0, total - cobrado), color: CH_COLORS[1] }], { label: 'Cobrado frente a pendiente' });
}
function renderUtilidad() {
  if (!$('utilView')) return;
  const yrs = yearOptions();
  fillSelectKeep($('utilYear'), yrs.map(y => `<option>${y}</option>`).join(''), String(yrs[0]));
  if (!$('utilMonth').options.length) $('utilMonth').innerHTML = MONTHS_ES.map((m, i) => `<option value="${i}">${m}</option>`).join('');
  if (!$('utilMonth').dataset.init) { $('utilMonth').value = String(new Date().getMonth()); $('utilMonth').dataset.init = '1'; }
  if (!$('utilSem').dataset.init) { $('utilSem').value = new Date().getMonth() >= 6 ? '2' : '1'; $('utilSem').dataset.init = '1'; }
  if (!$('utilFrom').value) $('utilFrom').value = today();
  if (!$('utilTo').value) $('utilTo').value = today();
  if (!$('utilWeek').value) $('utilWeek').value = today();
  const v = $('utilView').value;
  document.querySelectorAll('.utilCtl').forEach(el => { el.style.display = el.dataset.v.split(' ').includes(v) ? '' : 'none'; });
  const per = utilPeriod();
  const rows = salesLines().filter(r => r.fecha >= per.from && r.fecha <= per.to);
  const ventas = rows.reduce((a, r) => a + r.venta, 0), costo = rows.reduce((a, r) => a + r.costo, 0), util = ventas - costo;
  $('utilRange').textContent = 'Periodo: ' + per.label;
  $('uVentas').textContent = money(ventas); $('uCosto').textContent = money(costo);
  $('uUtil').textContent = money(util); $('uUtil').style.color = util < 0 ? 'var(--danger)' : '';
  $('uMargen').textContent = ventas > 0 ? (util / ventas * 100).toFixed(1) + '%' : '0%';
  const by = {}; rows.forEach(r => { const o = by[r.producto] || (by[r.producto] = { producto: r.producto, qty: 0, venta: 0, costo: 0 }); o.qty += r.qty; o.venta += r.venta; o.costo += r.costo; });
  const top = Object.values(by).map(o => ({ ...o, util: o.venta - o.costo })).sort((a, b) => b.util - a.util).slice(0, 10);
  renderUtilChart(rows, per);
  $('utilTop').innerHTML = top.length ? `<div class="tablewrap"><table class="adm"><thead><tr><th>Producto (top 10 por utilidad)</th><th>Unid.</th><th>Ventas</th><th>Costo</th><th>Utilidad</th></tr></thead><tbody>${top.map(o => `<tr><td>${esc(o.producto)}</td><td>${o.qty}</td><td>${money(o.venta)}</td><td>${money(o.costo)}</td><td>${money(o.util)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No hay ventas en este periodo.</div>';
  renderInversion();
  renderTax();
  renderCategoriesDash(rows, per);
}
function bucketRows(rows, per) {
  let from = per.from, to = per.to;
  if (from < '1900' || to > '3000') { const fs = rows.map(r => r.fecha).filter(Boolean).sort(); if (!fs.length) return { labels: [], data: [] }; from = fs[0]; to = fs[fs.length - 1]; }
  const d0 = new Date(from + 'T12:00:00Z'), d1 = new Date(to + 'T12:00:00Z');
  const days = Math.round((d1 - d0) / 86400000) + 1, months = (d1.getUTCFullYear() - d0.getUTCFullYear()) * 12 + d1.getUTCMonth() - d0.getUTCMonth() + 1;
  const unit = days <= 62 ? 'd' : months <= 36 ? 'm' : 'y';
  const keyOf = f => unit === 'd' ? f.slice(0, 10) : unit === 'm' ? f.slice(0, 7) : f.slice(0, 4);
  const keys = [];
  if (unit === 'd') { for (let t = d0.getTime(); t <= d1.getTime(); t += 86400000) keys.push(new Date(t).toISOString().slice(0, 10)); }
  else if (unit === 'm') keys.push(...monthKeysBack(months, to.slice(0, 7)));
  else { for (let y = d0.getUTCFullYear(); y <= d1.getUTCFullYear(); y++) keys.push(String(y)); }
  const map = Object.fromEntries(keys.map(k => [k, { venta: 0, costo: 0 }]));
  rows.forEach(r => { const o = map[keyOf(r.fecha)]; if (o) { o.venta += r.venta; o.costo += r.costo; } });
  const labels = keys.map(k => unit === 'd' ? k.slice(8, 10) + '/' + k.slice(5, 7) : unit === 'm' ? mesLabel(k) : k);
  return { labels, data: keys.map(k => map[k]) };
}
function renderUtilChart(rows, per) {
  const b = bucketRows(rows, per);
  chartBars('chUtil', b.labels, [{ name: 'Ventas', values: b.data.map(x => x.venta), color: CH_COLORS[0] }, { name: 'Costo', values: b.data.map(x => x.costo), color: CH_COLORS[1] }, { name: 'Utilidad bruta', values: b.data.map(x => x.venta - x.costo), color: CH_COLORS[2] }], { label: 'Ventas, costo y utilidad del periodo' });
}
function renderInversion() {
  if (!$('invMonth')) return;
  const ys = new Set([new Date().getFullYear()]); PRODUCTS.forEach(p => { const y = parseInt(String(p.purchase_date || '').slice(0, 4)); if (y) ys.add(y); });
  const yrs = [...ys].sort((a, b) => b - a);
  fillSelectKeep($('invYear'), yrs.map(y => `<option>${y}</option>`).join(''), String(new Date().getFullYear()));
  if (!$('invMonth').options.length) $('invMonth').innerHTML = MONTHS_ES.map((m, i) => `<option value="${i}">${m}</option>`).join('');
  if (!$('invMonth').dataset.init) { $('invMonth').value = String(new Date().getMonth()); $('invMonth').dataset.init = '1'; }
  const y = $('invYear').value, m = Number($('invMonth').value), key = y + '-' + String(m + 1).padStart(2, '0');
  const inMonth = PRODUCTS.filter(p => String(p.purchase_date || '').slice(0, 7) === key);
  $('invMes').textContent = money(inMonth.reduce((a, p) => a + (Number(p.stock) || 0) * ((Number(p.cost) || 0) + (Number(p.shipping_cost) || 0)), 0));
  $('invUnid').textContent = inMonth.reduce((a, p) => a + (Number(p.stock) || 0), 0).toLocaleString('es-CO');
  $('invCompras').textContent = inMonth.length;
  $('invVentas').textContent = money(salesLines().filter(r => String(r.fecha).slice(0, 7) === key).reduce((a, r) => a + r.venta, 0));
  const keys = Array.from({ length: 12 }, (_, i) => y + '-' + String(i + 1).padStart(2, '0'));
  chartBars('chInv', keys.map(mesLabel), [
    { name: 'Inversión (inventario ingresado)', values: keys.map(k => investmentOf(k)), color: CH_COLORS[3] },
    { name: 'Ventas', values: keys.map(k => salesLines().filter(r => String(r.fecha).slice(0, 7) === k).reduce((a, r) => a + r.venta, 0)), color: CH_COLORS[0] },
  ], { label: 'Inversión y ventas por mes del año ' + y });
}
/* ---------- Impuesto de renta ---------- */
const UVT_2027_ESTIMADA = 55668;
const TAX_TABLE = [[0, 1090, 0, 0], [1090, 1700, 0.19, 0], [1700, 4100, 0.28, 116], [4100, 8670, 0.33, 788], [8670, 18970, 0.35, 2296], [18970, 31000, 0.37, 5901], [31000, Infinity, 0.39, 10352]];
const incomeTaxUvt = b => { const r = TAX_TABLE.find(x => b > x[0] && b <= x[1]); return r ? (b - r[0]) * r[2] + r[3] : 0; };
function taxCfg() { try { return JSON.parse(localStorage.getItem('taxCfg') || 'null') || { uvt: UVT_2027_ESTIMADA, gastos: {} }; } catch (e) { return { uvt: UVT_2027_ESTIMADA, gastos: {} }; } }
function taxCfgChanged() {
  const c = taxCfg(), y = $('taxYear').value;
  c.uvt = Number($('taxUvt').value) || UVT_2027_ESTIMADA; c.gastos[y] = Number($('taxExp').value) || 0;
  localStorage.setItem('taxCfg', JSON.stringify(c));
  renderTax(true);
}
function renderTax(keepInputs) {
  if (!$('taxYear')) return;
  const c = taxCfg(), yrs = yearOptions();
  fillSelectKeep($('taxYear'), yrs.map(y => `<option>${y}</option>`).join(''), String(new Date().getFullYear()));
  const y = $('taxYear').value;
  if (!keepInputs) { $('taxUvt').value = c.uvt || UVT_2027_ESTIMADA; $('taxExp').value = (c.gastos || {})[y] || 0; }
  const uvt = Number($('taxUvt').value) || UVT_2027_ESTIMADA, gastos = Number($('taxExp').value) || 0;
  const rows = salesLines().filter(r => String(r.fecha).slice(0, 4) === y);
  const ingresos = rows.reduce((a, r) => a + r.venta, 0), util = ingresos - rows.reduce((a, r) => a + r.costo, 0);
  const base = Math.max(0, util - gastos), baseUvt = base / uvt, imp = Math.round(incomeTaxUvt(baseUvt) * uvt);
  $('tIngresos').textContent = money(ingresos); $('tUtil').textContent = money(util); $('tBase').textContent = money(base);
  $('tUvt').textContent = baseUvt.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' UVT';
  $('tImpuesto').textContent = money(imp);
  $('tEfectiva').textContent = base > 0 ? (imp / base * 100).toFixed(1) + '%' : '0%';
  const tope = 1400 * uvt;
  const pct = tope > 0 ? Math.min(100, ingresos / tope * 100) : 0;
  $('chTax').innerHTML = `<div class="hbars"><div class="row" style="grid-template-columns:1fr"><span class="bar" style="height:18px"><b style="width:${pct.toFixed(1)}%;background:${ingresos >= tope ? CH_COLORS[3] : CH_COLORS[0]}"></b></span></div></div><div class="note" style="margin-top:6px">${esc(money(ingresos))} de ${esc(money(tope))} (${pct.toFixed(0)}%) del tope de 1.400 UVT</div>`;
  $('taxObligation').textContent = ingresos >= tope
    ? `⚠ Tus ingresos brutos del año (${money(ingresos)}) superan 1.400 UVT (${money(tope)}): probablemente estás obligado a declarar renta.`
    : `Tus ingresos brutos del año no superan 1.400 UVT (${money(tope)}). Aun así, podrías estar obligado a declarar por patrimonio, consumos con tarjeta, compras o consignaciones.`;
}
/* ---------- Diezmo / ofrenda / reinversión ---------- */
function renderProfitBox() {
  const pc = profitConfig(), y = String(new Date().getFullYear());
  const utilY = monthKeysBack(12, y + '-12').reduce((a, k) => a + monthProfit(k), 0);
  const diez = utilY * pc.diezmoPct / 100, ofr = utilY * pc.ofrendaPct / 100;
  const reinvS = utilY * pc.reinvPct / 100;
  const reinvR = monthKeysBack(12, y + '-12').reduce((a, k) => a + investmentOf(k), 0);
  $('profitBox').innerHTML = `
  <div class="grid cards3">
    <div class="card"><div class="label">Diezmo (${pc.diezmoPct}% utilidad ${y})</div><div class="metric">${money(diez)}</div></div>
    <div class="card"><div class="label">Ofrenda (${pc.ofrendaPct}% utilidad ${y})</div><div class="metric">${money(ofr)}</div></div>
    <div class="card"><div class="label">Reinversión sugerida (${pc.reinvPct}%)</div><div class="metric">${pc.reinvEnabled ? money(reinvS) : 'Desactivada'}</div>
      <div class="note">real invertido: ${money(reinvR)}</div></div>
  </div>
  <div class="note" style="margin-top:8px">Utilidad ${y}: <b>${money(utilY)}</b>. Edita porcentajes y habilita el sugerido en el menú 👑 → Configuración → "Utilidad: diezmo, ofrenda y reinversión".</div>`;
}
/* ---------- Objetivos ---------- */
function renderGoalsBox() {
  const act = GOALS.filter(g => g.active);
  const done = GOALS.filter(g => g.target > 0 && g.contributed >= g.target).length;
  $('goalsBox').innerHTML = GOALS.length ? `<div class="note" style="margin-bottom:8px">${act.length} activo(s) · ${done} cumplido(s)</div>` +
    (GOALS.map(g => { const pct = g.target > 0 ? Math.min(100, g.contributed / g.target * 100) : 0; return `<div class="hbars"><div class="row"><span class="lbl" title="${esc(g.name)}">${esc(g.name)}${g.active ? '' : ' (inactivo)'}</span><span class="bar"><b style="width:${pct.toFixed(1)}%;background:${pct >= 100 ? 'var(--ok)' : CH_COLORS[0]}"></b></span><span class="val">${pct.toFixed(0)}% · ${money(g.contributed)} / ${money(g.target)}</span></div></div>`; }).join(''))
    : '<div class="empty">Sin objetivos. Créalos en Configuración (máximo 3).</div>';
}
function openGoalPay() {
  const act = GOALS.filter(g => g.active);
  if (!act.length) { toast('⚠ Crea o activa un objetivo en Configuración primero'); return; }
  $('gpGoal').innerHTML = act.map(g => `<option value="${g.id}">${esc(g.name)} — ${money(g.contributed)} / ${money(g.target)}</option>`).join('');
  $('gpAmount').value = ''; $('gpDate').value = today();
  openModal('goalPayModal');
}
async function saveGoalPayment() {
  const gid = $('gpGoal').value, amount = Number($('gpAmount').value) || 0;
  if (!gid || amount <= 0) return toast('⚠ Elige objetivo y un monto mayor a 0');
  try {
    await api('/api/admin/goals/' + gid + '/payments', { method: 'POST', body: { amount, payment_date: $('gpDate').value || today() } });
    closeModal('goalPayModal'); toast('✔ Aporte registrado');
    GOALS = await api('/api/admin/goals'); renderGoalsBox(); renderSummary();
  } catch (e) { toast('⚠ ' + e.message); }
}
/* ---------- Valor de inventario y categorías ---------- */
function renderInventoryValue() {
  const inv = ANALYTICS.inventory;
  $('mInvTotal').textContent = money(inv.totalCosto); $('mInvEnvio').textContent = money(inv.totalEnvio);
  $('mInv90').textContent = money(inv.over90); $('mInv90Pct').textContent = inv.over90Pct.toFixed(1) + '%';
  const byCat = {};
  PRODUCTS.forEach(p => { const c = p.category || 'SIN CATEGORÍA'; byCat[c] = (byCat[c] || 0) + (Number(p.cost) || 0) * Math.max(0, Number(p.available) || 0); });
  chartDonut('chInvCat', Object.entries(byCat).map(([label, value]) => ({ label, value })), { label: 'Inventario por categoría' });
  let young = 0, mid = 0, old = 0;
  (ANALYTICS.stockRows || []).forEach(r => { const v = (Number(r.cost) || 0) * Math.max(0, r.available); const d = r.days; if (d === null || d === undefined || d <= 30) young += v; else if (d <= 90) mid += v; else old += v; });
  chartDonut('chInvAge', [{ label: '30 días o menos', value: young, color: CH_COLORS[0] }, { label: '31 a 90 días', value: mid, color: CH_COLORS[1] }, { label: 'Más de 90 días', value: old, color: CH_COLORS[3] }], { label: 'Antigüedad del inventario' });
}
function renderCategoriesDash(rows, per) {
  if (!$('catBody')) return;
  const SIN = 'SIN CATEGORÍA', map = {};
  const get = c => map[c] || (map[c] = { cat: c, inv: 0, ven: 0 });
  CATS.forEach(c => get(c.name));
  PRODUCTS.forEach(p => { const c = p.category || SIN; get(c).inv += (Number(p.cost) || 0) * Math.max(0, Number(p.available) || 0); });
  rows.forEach(r => {
    const p = PRODUCTS.find(x => x.name === r.producto);
    const c = p ? (p.category || SIN) : (KITS.some(k => k.name === r.producto) ? 'KITS' : SIN);
    get(c).ven += r.venta;
  });
  let list = Object.values(map).filter(r => CATS.some(c => c.name === r.cat) || r.inv > 0 || r.ven > 0);
  const totI = list.reduce((a, r) => a + r.inv, 0), totV = list.reduce((a, r) => a + r.ven, 0);
  list.forEach(r => { r.invPct = totI > 0 ? r.inv / totI * 100 : 0; r.venPct = totV > 0 ? r.ven / totV * 100 : 0; });
  list = list.sort((a, b) => b.inv - a.inv);
  $('catPeriod').textContent = 'Ventas del periodo: ' + per.label + ' (se cambia en "Utilidad bruta"). Inventario: valor actual.';
  $('catHead').innerHTML = '<tr><th>Categoría</th><th>Monto en inventario</th><th>% inventario</th><th>Monto vendido</th><th>% ventas</th></tr>';
  $('catBody').innerHTML = list.length ? list.map(r => `<tr><td>${esc(r.cat)}</td><td>${money(r.inv)}</td><td>${r.invPct.toFixed(1)}%</td><td>${money(r.ven)}</td><td>${r.venPct.toFixed(1)}%</td></tr>`).join('') + `<tr style="font-weight:800"><td>Total</td><td>${money(totI)}</td><td>${totI > 0 ? '100.0%' : '0.0%'}</td><td>${money(totV)}</td><td>${totV > 0 ? '100.0%' : '0.0%'}</td></tr>` : '<tr><td colspan="5" class="empty">Sin categorías.</td></tr>';
  chartDonut('chCatInv', list.map(r => ({ label: r.cat, value: r.inv })), { label: 'Participación en inventario' });
  chartDonut('chCatVen', list.map(r => ({ label: r.cat, value: r.ven })), { label: 'Participación en ventas' });
}
/* ---------- Logística en dashboard ---------- */
function renderLogisDash() {
  const pend = LOGIS.filter(s => s.status !== 'enviado'), sent = LOGIS.filter(s => s.status === 'enviado');
  $('dashLogis').innerHTML = `<div class="grid cards3"><div class="card"><div class="label">Por enviar</div><div class="metric">${pend.length}</div></div><div class="card"><div class="label">Enviados</div><div class="metric">${sent.length}</div></div></div>` +
    (pend.length ? '<div class="tablewrap" style="margin-top:10px"><table class="adm"><thead><tr><th>Pedido</th><th>Cliente</th><th>Estado</th><th></th></tr></thead><tbody>' + pend.slice(0, 5).map(s => `<tr><td><b>${esc(s.order_number)}</b></td><td>${esc(s.client_name || '')}</td><td>${s.status === 'guardado' ? '<span class="pill warn">Guardado</span>' : '<span class="pill">Por enviar</span>'}</td><td class="acts"><button class="btn primary" onclick="openShip('${s.id}')">Preparar envío</button></td></tr>`).join('') + '</tbody></table></div>' : '');
}
/* ---------- Pedidos por cliente / recientes / stock bajo ---------- */
function fillDashboardClients() {
  const s = $('dashboardClient'); if (!s) return;
  const cur = s.value;
  s.innerHTML = '<option value="">Seleccionar cliente…</option>' + [...CLIENTS].sort((a, b) => a.name.localeCompare(b.name, 'es')).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if (CLIENTS.some(c => c.id === cur)) s.value = cur;
}
function renderClientsChart() {
  const by = {}; ORDERS.filter(o => o.status !== 'canceled').forEach(o => { const k = o.client_name || 'Sin cliente'; by[k] = (by[k] || 0) + o.total; });
  const top = Object.entries(by).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 10);
  if (!top.length) { $('chClients').innerHTML = emptyChart; return; }
  $('chClients').innerHTML = '<h3 style="margin:0 0 8px">Top 10 clientes por ventas</h3><div id="chClientsTop"></div>';
  chartHBars('chClientsTop', top);
}
function renderClientOrders() {
  const box = $('clientOrders'); if (!box) return;
  const cid = $('dashboardClient').value;
  if (!cid) { renderClientsChart(); box.innerHTML = '<div class="empty">Selecciona un cliente para ver sus pedidos.</div>'; return; }
  const cl = CLIENTS.find(c => c.id === cid);
  const os = ORDERS.filter(o => o.client_id === cid || (cl && o.client_name === cl.name));
  chartBars('chClients', os.slice(-10).map(o => o.order_number.replace(/^.*-0*/, '#') || o.order_number), [{ name: 'Total', values: os.slice(-10).map(o => o.total), color: CH_COLORS[0] }, { name: 'Abonado', values: os.slice(-10).map(o => o.paid), color: CH_COLORS[2] }], { label: 'Pedidos del cliente', h: 190 });
  box.innerHTML = os.length ? `<div class="tablewrap"><table class="adm"><thead><tr><th>Pedido</th><th>Fecha</th><th>Total</th><th>Abonado</th><th>Saldo</th><th>Estado</th><th></th></tr></thead><tbody>${os.map(o => `<tr><td>${esc(o.order_number)}</td><td>${String(o.created_at || '').slice(0, 10)}</td><td>${money(o.total)}</td><td>${money(o.paid)}</td><td>${money(o.balance)}</td><td>${pill(o.status)}</td><td class="acts"><button class="btn" onclick="openOrder('${o.id}')">Abrir</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Este cliente no tiene pedidos.</div>';
}
function renderRecent() {
  const last = [...ORDERS].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10);
  const rev = last.slice().reverse();
  chartBars('chRecent', rev.map(o => o.order_number.replace(/^.*-0*/, '#') || o.order_number), [{ name: 'Total', values: rev.map(o => o.total), color: CH_COLORS[0] }, { name: 'Abonado', values: rev.map(o => o.paid), color: CH_COLORS[2] }], { label: 'Total y abonado de los últimos pedidos', h: 190 });
  $('recentOrders').innerHTML = last.length ? `<div class="tablewrap"><table class="adm"><thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Saldo</th></tr></thead><tbody>${last.map(o => `<tr><td>${esc(o.order_number)}</td><td>${String(o.created_at || '').slice(0, 10)}</td><td>${esc(o.client_name || '—')}</td><td>${money(o.total)}</td><td>${money(o.balance)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No hay pedidos.</div>';
}
function renderLow() {
  const low = (ANALYTICS.stockRows || []).filter(x => x.status !== 'EN STOCK');
  if (!low.length) $('chLow').innerHTML = emptyChart;
  else {
    const mx = Math.max(1, ...low.map(x => Math.max(0, x.available)));
    $('chLow').innerHTML = '<div class="hbars">' + low.slice(0, 12).map(x => `<div class="row"><span class="lbl" title="${esc(x.name)}">${esc(x.name)}</span><span class="bar"><b style="width:${(Math.max(0, x.available) / mx * 100).toFixed(1)}%;background:${x.available <= 0 ? CH_COLORS[3] : CH_COLORS[1]}"></b></span><span class="val">${Math.max(0, x.available)} u.</span></div>`).join('') + '</div>';
  }
  $('lowStock').innerHTML = low.length ? low.map(p => `<div class="statusbar"><span>${esc(p.name)}</span>${pillStock(p.status)} <b>${Math.max(0, p.available)}</b></div>`).join('') : '<div class="empty">No hay productos con stock bajo.</div>';
}
/* ---------- Abonos por confirmar ---------- */
async function loadReports() {
  const rows = await api('/api/orders/reports/pending');
  $('reports').innerHTML = rows.length ?
    '<div class="tablewrap"><table class="adm"><thead><tr><th>Bolsita</th><th>Cliente</th><th>WhatsApp</th><th>Abono</th><th>Reportado</th><th>Acciones</th></tr></thead><tbody>' +
    rows.map(r => `<tr><td><b>${esc(r.order_number)}</b></td><td>${esc(r.client_name || '')}</td><td>${esc(r.client_whatsapp || '')}</td><td><b>${money(r.amount)}</b></td><td>${new Date(r.reported_at).toLocaleString('es-CO')}</td>
      <td class="acts"><button class="btn primary" onclick="resolveReport('${r.id}','approve')">Aprobar</button><button class="btn danger" onclick="resolveReport('${r.id}','reject')">Rechazar</button></td></tr>`).join('') +
    '</tbody></table></div>' : '<p class="note">No hay abonos pendientes por confirmar. ✔</p>';
}
async function resolveReport(id, decision) {
  try {
    const r = await api('/api/orders/reports/' + id + '/resolve', { method: 'POST', body: { decision } });
    toast(decision === 'approve' ? '✔ Abono aprobado → bolsita ' + (r.new_status === 'paid' ? 'PAGADA' : 'APARTADA') : 'Abono rechazado → vuelve a borrador');
    loadReports();
  } catch (e) { toast('⚠ ' + e.message); }
}
/* ---------- Inventario ---------- */
async function loadInventory() { await fetchCaches(); renderInventory(); }
function renderInventory() {
  const q = ($('invSearch').value || '').toLowerCase(), f = $('invFilter').value;
  const list = PRODUCTS.filter(p => (!q || p.name.toLowerCase().includes(q) || String(p.code || '').includes(q)) && (!f || p.status === f));
  $('invTable').innerHTML = '<div class="tablewrap"><table class="adm"><thead><tr><th>Producto</th><th>Código</th><th>Categoría</th><th>Costo</th><th>Envío</th><th>Stock</th><th>Disponible</th><th>Estado</th><th>Precio</th><th>Margen</th><th>Fecha compra</th><th>Acciones</th></tr></thead><tbody>' +
    (list.length ? list.map(p => {
      const marg = p.price > 0 ? (((Number(p.price) - Number(p.cost) - Number(p.shipping_cost)) / Number(p.price)) * 100).toFixed(1) + '%' : '—';
      return `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.code || '—')}</td><td>${esc(p.category || '—')}</td><td>${money(p.cost)}</td><td>${money(p.shipping_cost)}</td><td>${p.stock}</td><td>${p.available}</td><td>${pillStock(p.status)}</td><td>${money(p.price)}</td><td>${marg}</td><td>${esc(p.purchase_date || '—')}</td>
        <td class="acts"><button class="btn" onclick="openStock('${p.id}')">+ Stock</button><button class="btn" onclick="openProduct('${p.id}')">Editar</button><button class="btn danger" onclick="delProduct('${p.id}')">Eliminar</button></td></tr>`;
    }).join('') : '<tr><td colspan="12" class="empty">Sin productos.</td></tr>') + '</tbody></table></div>';
}
function openProduct(id) {
  const p = id ? PRODUCTS.find(x => x.id === id) : null;
  $('prodTitle').textContent = p ? 'Editar producto' : 'Nuevo producto';
  $('pId').value = p ? p.id : '';
  $('pName').value = p ? p.name : '';
  $('pCode').value = p ? (p.code || '') : '';
  $('pCat').innerHTML = '<option value="">Sin categoría</option>' + CATS.map(c => `<option value="${c.id}" ${p && p.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  $('pDate').value = p ? (p.purchase_date || '') : today();
  $('pCost').value = p ? p.cost : 0; $('pShip').value = p ? p.shipping_cost : 0; $('pPrice').value = p ? p.price : 0;
  $('pStock').value = p ? p.stock : 0; $('pMin').value = p ? p.min_stock : 1;
  openModal('productModal');
}
async function saveProduct() {
  const body = {
    name: $('pName').value.trim(), code: $('pCode').value.trim(), category_id: $('pCat').value || null,
    cost: Number($('pCost').value) || 0, shipping_cost: Number($('pShip').value) || 0, price: Number($('pPrice').value) || 0,
    stock: Math.max(0, Math.floor(Number($('pStock').value) || 0)), min_stock: Math.max(0, Math.floor(Number($('pMin').value) || 0)),
    purchase_date: $('pDate').value || null,
  };
  try {
    const id = $('pId').value;
    if (id) await api('/api/admin/products/' + id, { method: 'PUT', body });
    else await api('/api/admin/products', { method: 'POST', body });
    closeModal('productModal'); toast('✔ Producto guardado'); loadInventory();
  } catch (e) { toast('⚠ ' + e.message); }
}
async function openStock(id) {
  const p = PRODUCTS.find(x => x.id === id); if (!p) return;
  const qty = prompt(`Sumar stock a "${p.name}" (stock actual ${p.stock}).\nCantidad a sumar (o negativa para ajustar):`);
  if (qty === null || qty === '') return;
  const fecha = prompt('Fecha de compra de esta reposición (AAAA-MM-DD). Enter = hoy:', today());
  try {
    await api('/api/admin/products/' + id + '/stock', { method: 'POST', body: { qty: Number(qty) || 0, fecha: fecha || null } });
    toast('✔ Stock actualizado'); loadInventory();
  } catch (e) { toast('⚠ ' + e.message); }
}
async function delProduct(id) {
  const p = PRODUCTS.find(x => x.id === id); if (!p) return;
  if (!confirm(`¿Eliminar el producto "${p.name}"?`)) return;
  try { await api('/api/admin/products/' + id, { method: 'DELETE' }); toast('Producto eliminado'); loadInventory(); }
  catch (e) { toast('⚠ ' + e.message); }
}
/* ---------- Kits ---------- */
async function loadKits() { await fetchCaches(); renderKits(); }
function renderKits() {
  $('kitsTable').innerHTML = KITS.length ? '<div class="tablewrap"><table class="adm"><thead><tr><th>Kit</th><th>Componentes</th><th>Precio</th><th>Disponibles</th><th>Acciones</th></tr></thead><tbody>' +
    KITS.map(k => `<tr><td><b>🎁 ${esc(k.name)}</b></td><td>${(k.components || []).map(c => c.quantity + '× ' + esc(c.product_name)).join(' · ')}</td><td>${money(k.price)}</td><td>${k.available}</td>
      <td class="acts"><button class="btn" onclick="openKit('${k.id}')">Editar</button><button class="btn danger" onclick="delKitDirect('${k.id}')">Eliminar</button></td></tr>`).join('') +
    '</tbody></table></div>' : '<p class="note">Aún no hay kits.</p>';
}
function openKit(id) {
  const k = id ? KITS.find(x => x.id === id) : null;
  $('kitTitle').textContent = k ? 'Editar kit' : 'Nuevo kit';
  $('kId').value = k ? k.id : '';
  $('kName').value = k ? k.name : '';
  $('kPrice').value = k ? k.price : 0;
  $('kDel').style.display = k ? 'inline-block' : 'none';
  $('kComps').innerHTML = '';
  (k ? k.components : []).forEach(c => addKitRow(c.product_id, c.quantity));
  if (!k) addKitRow();
  openModal('kitModal');
}
function addKitRow(productId, qty) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><select class="kcProd">${PRODUCTS.map(p => `<option value="${p.id}" ${p.id === productId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td>
    <td style="width:110px"><input class="kcQty" type="number" min="1" value="${qty || 1}"></td>
    <td style="width:40px"><button class="btn danger" onclick="this.closest('tr').remove()">✕</button></td>`;
  $('kComps').appendChild(tr);
}
async function saveKit() {
  const components = [...$('kComps').querySelectorAll('tr')].map(tr => ({ product_id: tr.querySelector('.kcProd').value, quantity: Math.max(1, Math.floor(Number(tr.querySelector('.kcQty').value) || 1)) }));
  const body = { name: $('kName').value.trim(), price: Number($('kPrice').value) || 0, components };
  try {
    const id = $('kId').value;
    if (id) await api('/api/admin/kits/' + id, { method: 'PUT', body });
    else await api('/api/admin/kits', { method: 'POST', body });
    closeModal('kitModal'); toast('✔ Kit guardado'); loadKits();
  } catch (e) { toast('⚠ ' + e.message); }
}
async function delKitDirect(id) {
  const k = KITS.find(x => x.id === id); if (!k) return;
  if (!confirm(`¿Eliminar el kit "${k.name}"?`)) return;
  try { await api('/api/admin/kits/' + id, { method: 'DELETE' }); toast('Kit eliminado'); loadKits(); } catch (e) { toast('⚠ ' + e.message); }
}
async function delKit() { const id = $('kId').value; if (id) await delKitDirect(id); closeModal('kitModal'); }
/* ---------- Categorías ---------- */
async function loadCats() {
  CATS = await api('/api/admin/categories');
  $('catsBox').innerHTML = CATS.length ? '<div class="tablewrap"><table class="adm"><thead><tr><th>Categoría</th><th>Acciones</th></tr></thead><tbody>' +
    CATS.map(c => `<tr><td><b>${esc(c.name)}</b></td><td class="acts"><button class="btn" onclick="renameCategory('${c.id}')">Renombrar</button><button class="btn danger" onclick="delCategory('${c.id}')">Eliminar</button></td></tr>`).join('') +
    '</tbody></table></div>' : '<p class="note">Sin categorías.</p>';
}
async function addCategory() {
  const name = $('catNew').value.trim();
  if (!name) return toast('⚠ Escribe un nombre');
  try { await api('/api/admin/categories', { method: 'POST', body: { name } }); $('catNew').value = ''; toast('✔ Categoría creada'); loadCats(); }
  catch (e) { toast('⚠ ' + e.message); }
}
async function renameCategory(id) {
  const c = CATS.find(x => x.id === id); if (!c) return;
  const name = prompt('Nuevo nombre para la categoría:', c.name);
  if (!name || !name.trim()) return;
  try { await api('/api/admin/categories/' + id, { method: 'PUT', body: { name: name.trim() } }); toast('✔ Categoría renombrada'); loadCats(); }
  catch (e) { toast('⚠ ' + e.message); }
}
async function delCategory(id) {
  const c = CATS.find(x => x.id === id); if (!c) return;
  if (!confirm(`¿Eliminar la categoría "${c.name}"?`)) return;
  try { await api('/api/admin/categories/' + id, { method: 'DELETE' }); toast('Categoría eliminada'); loadCats(); }
  catch (e) { toast('⚠ ' + e.message); }
}
/* ---------- Clientes ---------- */
async function loadClients() { CLIENTS = await api('/api/admin/clients'); renderClients(); }
function renderClients() {
  const q = ($('cliSearch').value || '').toLowerCase();
  const list = CLIENTS.filter(c => !q || (c.name + ' ' + (c.whatsapp || '')).toLowerCase().includes(q));
  $('clientsTable').innerHTML = '<div class="tablewrap"><table class="adm"><thead><tr><th>Cliente</th><th>WhatsApp</th><th>Ciudad</th><th>Dirección</th><th>Estado</th><th>Pedidos</th><th>Total</th><th>Abonado</th><th>Saldo</th><th>Acciones</th></tr></thead><tbody>' +
    (list.length ? list.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.whatsapp || '—')}</td><td>${esc(c.city || '—')}</td><td>${esc(c.address || '—')}</td><td>${c.status === 'Activo' ? '<span class="pill ok">Activo</span>' : '<span class="pill danger">Inactivo</span>'}</td><td>${c.orders}</td><td>${money(c.total)}</td><td>${money(c.paid)}</td><td>${money(c.balance)}</td>
      <td class="acts"><button class="btn" onclick="openClient('${c.id}')">Editar</button></td></tr>`).join('') : '<tr><td colspan="10" class="empty">Sin clientes.</td></tr>') + '</tbody></table></div>';
}
function openClient(id) {
  const c = id ? CLIENTS.find(x => x.id === id) : null;
  $('cliTitle').textContent = c ? 'Editar cliente' : 'Nuevo cliente';
  $('cId').value = c ? c.id : '';
  $('cName').value = c ? c.name : '';
  $('cWa').value = c ? (c.whatsapp || '') : '';
  $('cCity').value = c ? (c.city || '') : '';
  $('cAddr').value = c ? (c.address || '') : '';
  $('cStatus').value = c ? c.status : 'Activo';
  $('cPin').value = '';
  $('cPinField').style.display = c ? 'none' : 'flex';
  openModal('clientModal');
}
async function saveClient() {
  const body = { name: $('cName').value.trim(), whatsapp: $('cWa').value.trim(), city: $('cCity').value.trim(), address: $('cAddr').value.trim(), status: $('cStatus').value };
  try {
    const id = $('cId').value;
    if (id) await api('/api/admin/clients/' + id, { method: 'PUT', body });
    else { if ($('cPin').value.trim()) body.pin = $('cPin').value.trim(); await api('/api/admin/clients', { method: 'POST', body }); }
    closeModal('clientModal'); toast('✔ Cliente guardado'); loadClients();
  } catch (e) { toast('⚠ ' + e.message); }
}
/* ---------- Pedidos ---------- */
async function loadOrders() {
  const q = $('ordSearch').value.trim(), f = $('ordFilter').value;
  const rows = await api('/api/admin/orders?' + new URLSearchParams({ q, status: f }));
  ORDERS = rows;
  $('ordersTable').innerHTML = rows.length ? '<div class="tablewrap"><table class="adm"><thead><tr><th>N.º</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th>Ítems</th><th>Total</th><th>Abonado</th><th>Saldo</th><th>Acciones</th></tr></thead><tbody>' +
    rows.map(o => `<tr><td><b>${esc(o.order_number)}</b></td><td>${esc(o.client_name || '—')}</td><td>${String(o.created_at || '').slice(0, 10)}</td><td>${pill(o.status)}</td><td>${o.items_count}</td><td>${money(o.total)}</td><td>${money(o.paid)}</td><td>${money(o.balance)}</td>
      <td class="acts"><button class="btn primary" onclick="openOrder('${o.id}')">Abrir</button></td></tr>`).join('') +
    '</tbody></table></div>' : '<p class="note">No hay pedidos con ese filtro.</p>';
}
/* Selector con agotados visibles (nota AGOTADO, no seleccionables) */
function optGroups() {
  return `<optgroup label="Productos">${PRODUCTS.map(p => `<option value="p:${p.id}" ${Number(p.available) <= 0 ? 'disabled' : ''}>${esc(p.name)} — ${money(p.price)}${Number(p.available) <= 0 ? ' — AGOTADO' : ' (disp ' + p.available + ')'}</option>`).join('')}</optgroup>` +
    `<optgroup label="Kits">${KITS.map(k => `<option value="k:${k.id}" ${Number(k.available) <= 0 ? 'disabled' : ''}>${esc(k.name)} — ${money(k.price)}${Number(k.available) <= 0 ? ' — AGOTADO' : ' (disp ' + k.available + ')'}</option>`).join('')}</optgroup>`;
}
async function openOrder(id) {
  try {
    if (!PRODUCTS.length) await fetchCaches();
    curOrderId = id;
    const o = await api('/api/admin/orders/' + id);
    $('orderBody').innerHTML = orderModalHtml(o);
    openModal('orderModal');
    omAddRow(true);
  } catch (e) { toast('⚠ ' + e.message); }
}
function orderModalHtml(o) {
  const wa = o.client_whatsapp ? 'https://wa.me/' + String(o.client_whatsapp).replace(/\D/g, '') : '';
  return `
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <b style="font-size:18px">${esc(o.order_number)}</b> ${pill(o.status)}
    <span class="note">${esc(o.client_name || 'Sin cliente')} ${esc(o.client_whatsapp || '')}</span>
    ${wa ? `<a class="btn wa" target="_blank" rel="noopener" href="${wa}">📲 WhatsApp</a>` : ''}
  </div>
  <div class="fgrid" style="margin:12px 0">
    <div class="field"><label>Estado</label><select onchange="orderStatusChanged(this.value)">
      ${['draft', 'pending_confirm', 'apartada', 'paid', 'shipped', 'delivered', 'canceled'].map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
    </select></div>
    <div class="field" style="grid-column:1/-1"><label>Notas</label><input id="oNotes" value="${esc(o.notes || '')}"></div>
  </div>
  <div class="actions" style="margin-bottom:10px"><button class="btn" onclick="saveOrderNotes()">Guardar notas</button>
  <button class="btn primary" onclick="generateInvoice('${o.id}')">📄 Generar factura PDF</button></div>
  <h3>Productos</h3>
  <div class="tablewrap"><table class="adm"><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Total</th><th></th></tr></thead><tbody id="omItems">
  ${o.items.map(i => `<tr><td>${esc(i.kit_name ? i.kit_name : i.product_name)}</td><td>${i.quantity}</td><td>${money(i.price)}</td><td>${money(i.price * i.quantity)}</td><td class="acts"><button class="btn danger" onclick="delOrderItem('${o.id}','${i.id}')">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin productos</td></tr>'}
  </tbody></table></div>
  <h3>Agregar productos (Enter agrega y crea la siguiente fila enfocada)</h3>
  <div class="tablewrap"><table class="adm"><tbody id="omRows"></tbody></table></div>
  <div class="actions"><button class="btn" onclick="omAddRow(true)">+ Producto</button></div>
  <div style="display:flex;gap:18px;justify-content:flex-end;font-weight:800;margin:8px 0" id="omTotals">
    <span>Total: ${money(o.total)}</span><span>Abonado: ${money(o.paid)}</span><span>Saldo: ${money(o.balance)}</span>
  </div>
  <h3>Abonos</h3>
  ${o.payments.length ? `<div class="tablewrap"><table class="adm"><thead><tr><th>Fecha</th><th>Medio</th><th>Referencia</th><th>Nota</th><th>Valor</th><th></th></tr></thead><tbody>${o.payments.map(p => `<tr><td>${esc(p.payment_date)}</td><td>${esc(p.method || '')}</td><td>${esc(p.reference || '')}</td><td>${esc(p.note || '')}</td><td>${money(p.amount)}</td><td class="acts"><button class="btn danger" onclick="delPayment('${p.id}','${o.id}')">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="note">Sin abonos registrados.</p>'}
  <div class="fgrid" style="margin-top:10px">
    <div class="field"><label>Valor del abono</label><input id="pAmount" type="number" min="0"></div>
    <div class="field"><label>Medio</label><select id="pMethod">${['Bre-b', 'Transferencia', 'Nequi', 'Daviplata', 'Efectivo', 'Tarjeta', 'Otro'].map(m => `<option>${m}</option>`).join('')}</select></div>
    <div class="field"><label>Referencia</label><input id="pRef"></div>
    <div class="field"><label>Fecha</label><input id="pDate" type="date" value="${today()}"></div>
    <div class="field"><label>&nbsp;</label><button class="btn primary" onclick="addOrderPayment('${o.id}')">Registrar abono</button></div>
  </div>`;
}
/* Filas de captura: Enter agrega y crea/enfoca la siguiente */
function omAddRow(focus) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><select class="omProd" onkeydown="omKey(event)"><option value="">Seleccionar…</option>${optGroups()}</select></td>
    <td style="width:90px"><input class="omQty" type="number" min="1" value="1" onkeydown="omKey(event)"></td>
    <td style="width:120px"><input class="omPrice" type="number" min="0" value="0" onkeydown="omKey(event)" title="Precio (se llena al elegir; editable)"></td>
    <td class="acts"><button class="btn primary" onclick="omCommit(this.closest('tr'))">Agregar</button> <button class="btn danger" onclick="this.closest('tr').remove()">✕</button></td>`;
  $('omRows').appendChild(tr);
  tr.querySelector('.omProd').onchange = (ev) => omPriceAuto(ev.target);
  if (focus) tr.querySelector('.omProd').focus();
  return tr;
}
function omPriceAuto(sel) {
  const tr = sel.closest('tr');
  const v = sel.value; if (!v) return;
  const id = v.slice(2);
  const p = v.startsWith('p:') ? PRODUCTS.find(x => x.id === id) : KITS.find(x => x.id === id);
  if (p) tr.querySelector('.omPrice').value = p.price;
}
function omKey(ev) {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  omCommit(ev.target.closest('tr'), true);
}
async function omCommit(row, thenNew) {
  const v = row.querySelector('.omProd').value;
  const qty = Math.max(1, Math.floor(Number(row.querySelector('.omQty').value) || 1));
  if (!v) { if (thenNew) omAddRow(true); return; }
  const body = v.startsWith('p:') ? { product_id: v.slice(2), quantity: qty } : { kit_id: v.slice(2), quantity: qty };
  try {
    await api('/api/admin/orders/' + curOrderId + '/items', { method: 'POST', body });
    row.remove();
    const o = await api('/api/admin/orders/' + curOrderId);
    $('omItems').innerHTML = o.items.map(i => `<tr><td>${esc(i.kit_name ? i.kit_name : i.product_name)}</td><td>${i.quantity}</td><td>${money(i.price)}</td><td>${money(i.price * i.quantity)}</td><td class="acts"><button class="btn danger" onclick="delOrderItem('${o.id}','${i.id}')">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin productos</td></tr>';
    $('omTotals').innerHTML = `<span>Total: ${money(o.total)}</span><span>Abonado: ${money(o.paid)}</span><span>Saldo: ${money(o.balance)}</span>`;
    toast('✔ Producto agregado');
    if (thenNew) omAddRow(true);
  } catch (e) { toast('⚠ ' + e.message); }
}
async function orderStatusChanged(status) {
  try { await api('/api/admin/orders/' + curOrderId, { method: 'PUT', body: { status } }); toast('✔ Estado actualizado'); openOrder(curOrderId); loadOrders(); }
  catch (e) { toast('⚠ ' + e.message); }
}
async function saveOrderNotes() {
  try { await api('/api/admin/orders/' + curOrderId, { method: 'PUT', body: { notes: $('oNotes').value } }); toast('✔ Notas guardadas'); }
  catch (e) { toast('⚠ ' + e.message); }
}
async function delOrderItem(orderId, itemId) {
  if (!confirm('¿Quitar este producto de la bolsita? (Solo el administrador puede hacerlo en bolsitas separadas o pagadas)')) return;
  try { await api('/api/admin/orders/' + orderId + '/items/' + itemId, { method: 'DELETE' }); toast('Producto quitado'); openOrder(orderId); loadOrders(); }
  catch (e) { toast('⚠ ' + e.message); }
}
async function addOrderPayment(orderId) {
  const amount = Number($('pAmount').value) || 0;
  if (amount <= 0) return toast('⚠ Indica un valor mayor a 0');
  try {
    await api('/api/admin/orders/' + orderId + '/payments', { method: 'POST', body: { amount, method: $('pMethod').value, reference: $('pRef').value.trim(), payment_date: $('pDate').value || null } });
    toast('✔ Abono registrado'); openOrder(orderId); loadOrders();
  } catch (e) { toast('⚠ ' + e.message); }
}
async function delPayment(payId, orderId) {
  if (!confirm('¿Eliminar este abono?')) return;
  try { await api('/api/admin/payments/' + payId, { method: 'DELETE' }); toast('Abono eliminado'); openOrder(orderId); loadOrders(); }
  catch (e) { toast('⚠ ' + e.message); }
}
/* ---------- Logística ---------- */
async function loadLogistics() {
  LOGIS = await api('/api/admin/logistics');
  const pend = LOGIS.filter(s => s.status !== 'enviado'), sent = LOGIS.filter(s => s.status === 'enviado');
  $('logisPending').innerHTML = pend.length ? '<div class="tablewrap"><table class="adm"><thead><tr><th>Pedido</th><th>Cliente</th><th>Ciudad</th><th>Estado</th><th>Pago</th><th>Transportadora</th><th>Monto</th><th>Acciones</th></tr></thead><tbody>' +
    pend.map(s => `<tr><td><b>${esc(s.order_number)}</b></td><td>${esc(s.client_name || '')}</td><td>${esc(s.city || '—')}</td><td>${s.status === 'guardado' ? '<span class="pill warn">Guardado</span>' : '<span class="pill">Por enviar</span>'}</td><td>${s.pay_mode === 'adelantado' ? 'Adelantado' : 'Por cobrar'}</td><td>${esc(s.carrier)}${s.carrier_other ? ' (' + esc(s.carrier_other) + ')' : ''}</td><td>${money(s.amount)}</td>
      <td class="acts"><button class="btn primary" onclick="openShip('${s.id}')">Preparar envío</button><button class="btn" onclick="openOrder('${s.order_id}')">Ver pedido</button></td></tr>`).join('') + '</tbody></table></div>'
    : '<p class="note">No hay pedidos por enviar. Los pedidos que pasan a Pagado entran aquí automáticamente.</p>';
  $('logisSent').innerHTML = sent.length ? '<div class="tablewrap"><table class="adm"><thead><tr><th>Pedido</th><th>Cliente</th><th>Enviado</th><th>Transportadora</th><th>Pago</th><th>Monto</th><th>Dirección de envío</th></tr></thead><tbody>' +
    sent.map(s => `<tr><td><b>${esc(s.order_number)}</b></td><td>${esc(s.client_name || '')}</td><td>${String(s.shipped_at || '').slice(0, 10)}</td><td>${esc(s.carrier)}${s.carrier_other ? ' (' + esc(s.carrier_other) + ')' : ''}</td><td>${s.pay_mode === 'adelantado' ? 'Adelantado' : 'Por cobrar'}</td><td>${money(s.amount)}</td><td>${esc(s.city || '')} — ${esc(s.address || '')}</td></tr>`).join('') + '</tbody></table></div>'
    : '<p class="note">Aún no hay envíos registrados.</p>';
}
function openShip(id) {
  const s = LOGIS.find(x => x.id === id); if (!s) return;
  $('shId').value = s.id;
  $('shTitle').textContent = 'Preparar envío — ' + s.order_number;
  $('shPay').value = s.pay_mode || 'adelantado';
  $('shAmount').value = s.amount || '';
  $('shCarrier').value = s.carrier || 'Interrapidísimo';
  $('shCarrierOther').value = s.carrier_other || '';
  $('shDims').value = s.dimensions || '';
  $('shCity').value = s.city || s.client_city || '';
  $('shAddress').value = s.address || s.client_address || '';
  $('shAddrKind').value = s.address_kind || 'temporal';
  carrierChanged(); shipValidate();
  openModal('shipModal');
}
function carrierChanged() {
  const need = ['envío local', 'otra'].includes($('shCarrier').value);
  $('shCarrierOtherField').style.display = need ? 'flex' : 'none';
  shipValidate();
}
function shipData() {
  return {
    pay_mode: $('shPay').value, amount: Number($('shAmount').value) || 0,
    carrier: $('shCarrier').value, carrier_other: $('shCarrierOther').value.trim(),
    dimensions: $('shDims').value.trim(), city: $('shCity').value.trim(), address: $('shAddress').value.trim(),
    address_kind: $('shAddrKind').value,
  };
}
function shipComplete(d) {
  const needOther = ['envío local', 'otra'].includes(d.carrier);
  return d.amount > 0 && !!d.city && !!d.address && (!needOther || !!d.carrier_other);
}
function shipValidate() {
  if (!$('shSendBtn')) return;
  const d = shipData();
  const ok = shipComplete(d);
  $('shSendBtn').disabled = !ok;
  const miss = [];
  if (!(d.amount > 0)) miss.push('monto'); if (!d.city) miss.push('ciudad'); if (!d.address) miss.push('dirección');
  if (['envío local', 'otra'].includes(d.carrier) && !d.carrier_other) miss.push('nombre de transportadora');
  $('shHint').textContent = ok ? 'Datos completos: puedes Enviar o Guardar.' : 'Faltan: ' + miss.join(', ') + '. (Guardar conserva el borrador; Enviar requiere todo completo.)';
}
['shPay', 'shAmount', 'shCarrier', 'shCarrierOther', 'shDims', 'shCity', 'shAddress', 'shAddrKind'].forEach(id => {
  document.addEventListener('input', (ev) => { if (ev.target && ev.target.id === id) shipValidate(); });
  document.addEventListener('change', (ev) => { if (ev.target && ev.target.id === id) shipValidate(); });
});
async function saveShipment(action) {
  const id = $('shId').value; const d = shipData();
  if (action === 'send' && !shipComplete(d)) return toast('⚠ Completa todos los datos para Enviar');
  try {
    await api('/api/admin/logistics/' + id, { method: 'PUT', body: { ...d, action } });
    closeModal('shipModal');
    toast(action === 'send' ? '🚚 Envío registrado: el pedido pasó a Enviado' : '✔ Envío guardado como borrador');
    LOGIS = await api('/api/admin/logistics');
    if (currentTab === 'logis') loadLogistics();
    if (currentTab === 'dash') loadDash();
  } catch (e) { toast('⚠ ' + e.message); }
}
/* ---------- Configuración ---------- */
async function loadConfig() {
  CFG = await api('/api/admin/settings');
  GOALS = await api('/api/admin/goals');
  DONATIONS = await api('/api/admin/donations');
  const ic = CFG.invoice_config || {};
  $('iEmpresa').value = ic.empresa || ''; $('iNit').value = ic.nit || ''; $('iTel').value = ic.telefono || '';
  $('iEmail').value = ic.email || ''; $('iDir').value = ic.direccion || ''; $('iMsg').value = ic.mensaje || '';
  $('iFontTitulos').value = ic.fontTitulos || 'Arial';
  $('iFontCuerpo').value = ic.fontCuerpo || 'Arial';
  logoData = ic.logo || null; wmData = ic.watermark || null; wmW = ic.watermarkW || 0; wmH = ic.watermarkH || 0;
  $('iLogoPrev').src = logoData || ''; $('iLogoPrev').style.display = logoData ? 'inline-block' : 'none';
  $('iWmPrev').src = wmData || ''; $('iWmPrev').style.display = wmData ? 'inline-block' : 'none';
  $('gBreb').value = CFG.bre_b_key || ''; $('gWa').value = CFG.whatsapp_number || ''; $('gTpl').value = CFG.whatsapp_template || '';
  $('gPrefix').value = CFG.order_prefix || ''; $('gStart').value = CFG.order_start || 1; $('gDigits').value = CFG.order_digits || 5;
  $('gMin').value = CFG.min_payment_amount || 0;
  const pc = profitConfig();
  $('gDiezmo').value = pc.diezmoPct; $('gOfrenda').value = pc.ofrendaPct;
  $('gReinv').value = pc.reinvEnabled ? '1' : '0'; $('gReinvPct').value = pc.reinvPct;
  $('uiThemeSel').value = localStorage.getItem('uiTheme') || 'light';
  $('uiLayoutSel').value = localStorage.getItem('uiLayout') || 'top';
  renderGoalsCfg(); renderDonations();
}
async function saveProfitCfg() {
  const pc = {
    diezmoPct: Math.max(0, Math.min(100, Number($('gDiezmo').value) || 0)),
    ofrendaPct: Math.max(0, Math.min(100, Number($('gOfrenda').value) || 0)),
    reinvEnabled: $('gReinv').value === '1',
    reinvPct: Math.max(0, Math.min(100, Number($('gReinvPct').value) || 0)),
  };
  try { await api('/api/admin/settings', { method: 'PUT', body: { profit_config: pc } }); CFG.profit_config = pc; toast('✔ Utilidad configurada'); }
  catch (e) { toast('⚠ ' + e.message); }
}
function renderGoalsCfg() {
  $('goalsCfg').innerHTML = GOALS.length ? '<div class="tablewrap"><table class="adm"><thead><tr><th>Objetivo</th><th>Meta</th><th>Aportado</th><th>Activo</th><th>Acciones</th></tr></thead><tbody>' +
    GOALS.map(g => `<tr><td><b>${esc(g.name)}</b></td><td>${money(g.target)}</td><td>${money(g.contributed)}</td><td>${g.active ? '<span class="pill ok">Sí</span>' : '<span class="pill">No</span>'}</td>
      <td class="acts"><button class="btn" onclick="toggleGoal('${g.id}',${!g.active})">${g.active ? 'Inactivar' : 'Activar'}</button><button class="btn" onclick="editGoal('${g.id}')">Editar</button><button class="btn danger" onclick="delGoal('${g.id}')">Eliminar</button></td></tr>`).join('') + '</tbody></table></div>'
    : '<p class="note">Sin objetivos aún (máximo 3).</p>';
}
async function saveGoal() {
  try {
    await api('/api/admin/goals', { method: 'POST', body: { name: $('gcName').value.trim(), target: Number($('gcTarget').value) || 0 } });
    $('gcName').value = ''; $('gcTarget').value = '';
    toast('✔ Objetivo creado'); GOALS = await api('/api/admin/goals'); renderGoalsCfg();
  } catch (e) { toast('⚠ ' + e.message); }
}
async function toggleGoal(id, active) {
  try { await api('/api/admin/goals/' + id, { method: 'PUT', body: { active } }); GOALS = await api('/api/admin/goals'); renderGoalsCfg(); toast('✔ Objetivo actualizado'); }
  catch (e) { toast('⚠ ' + e.message); }
}
async function editGoal(id) {
  const g = GOALS.find(x => x.id === id); if (!g) return;
  const name = prompt('Nombre del objetivo:', g.name); if (name === null) return;
  const target = prompt('Monto meta:', g.target); if (target === null) return;
  try { await api('/api/admin/goals/' + id, { method: 'PUT', body: { name, target: Number(target) || 0 } }); GOALS = await api('/api/admin/goals'); renderGoalsCfg(); toast('✔ Objetivo actualizado'); }
  catch (e) { toast('⚠ ' + e.message); }
}
async function delGoal(id) {
  if (!confirm('¿Eliminar este objetivo y sus aportes?')) return;
  try { await api('/api/admin/goals/' + id, { method: 'DELETE' }); GOALS = await api('/api/admin/goals'); renderGoalsCfg(); toast('Objetivo eliminado'); }
  catch (e) { toast('⚠ ' + e.message); }
}
function renderDonations() {
  $('donList').innerHTML = DONATIONS.length ? '<div class="tablewrap"><table class="adm"><thead><tr><th>Fecha</th><th>Entidad</th><th>Valor</th><th>Certificado</th><th>Nota</th><th></th></tr></thead><tbody>' +
    DONATIONS.map(d => `<tr><td>${esc(d.donation_date)}</td><td><b>${esc(d.entity)}</b></td><td>${money(d.amount)}</td><td>${esc(d.certificate || '—')}</td><td>${esc(d.note || '')}</td><td class="acts"><button class="btn danger" onclick="delDonation('${d.id}')">Eliminar</button></td></tr>`).join('') + '</tbody></table></div>'
    : '<p class="note">Sin donaciones certificadas registradas.</p>';
}
async function saveDonation() {
  try {
    await api('/api/admin/donations', { method: 'POST', body: { entity: $('dnEntity').value.trim(), amount: Number($('dnAmount').value) || 0, certificate: $('dnCert').value.trim(), donation_date: $('dnDate').value || today(), note: $('dnNote').value.trim() } });
    $('dnEntity').value = ''; $('dnAmount').value = ''; $('dnCert').value = ''; $('dnNote').value = '';
    toast('✔ Donación registrada'); DONATIONS = await api('/api/admin/donations'); renderDonations();
  } catch (e) { toast('⚠ ' + e.message); }
}
async function delDonation(id) {
  if (!confirm('¿Eliminar esta donación?')) return;
  try { await api('/api/admin/donations/' + id, { method: 'DELETE' }); DONATIONS = await api('/api/admin/donations'); renderDonations(); toast('Donación eliminada'); }
  catch (e) { toast('⚠ ' + e.message); }
}
function readImg(input, kind) {
  const f = input.files && input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = (ev) => {
    const url = ev.target.result;
    const img = new Image();
    img.onload = () => {
      if (kind === 'logo') { logoData = url; $('iLogoPrev').src = url; $('iLogoPrev').style.display = 'inline-block'; }
      else { wmData = url; wmW = img.naturalWidth; wmH = img.naturalHeight; $('iWmPrev').src = url; $('iWmPrev').style.display = 'inline-block'; }
    };
    img.src = url;
  };
  r.readAsDataURL(f);
}
function clearLogo() { logoData = null; $('iLogoPrev').style.display = 'none'; $('iLogo').value = ''; }
function clearWm() { wmData = null; wmW = 0; wmH = 0; $('iWmPrev').style.display = 'none'; $('iWm').value = ''; }
async function saveInvoiceCfg() {
  const prev = (CFG && CFG.invoice_config) || {};
  const nc = {
    ...prev,
    empresa: $('iEmpresa').value.trim(), nit: $('iNit').value.trim(), telefono: $('iTel').value.trim(),
    email: $('iEmail').value.trim(), direccion: $('iDir').value.trim(), mensaje: $('iMsg').value.trim(),
    fontTitulos: $('iFontTitulos').value, fontCuerpo: $('iFontCuerpo').value,
    logo: logoData || '', watermark: wmData || '', watermarkW: wmW, watermarkH: wmH,
  };
  try { await api('/api/admin/settings', { method: 'PUT', body: { invoice_config: nc } }); CFG.invoice_config = nc; toast('✔ Datos de factura guardados'); }
  catch (e) { toast('⚠ ' + e.message); }
}
async function saveGeneral() {
  try {
    await api('/api/admin/settings', { method: 'PUT', body: {
      bre_b_key: $('gBreb').value.trim(), whatsapp_number: $('gWa').value.trim(), whatsapp_template: $('gTpl').value,
      order_prefix: $('gPrefix').value.trim(), order_digits: Number($('gDigits').value) || 5, order_start: Number($('gStart').value) || 1,
      min_payment_amount: Number($('gMin').value) || 0,
    } });
    toast('✔ Configuración guardada'); loadConfig();
  } catch (e) { toast('⚠ ' + e.message); }
}
/* ---------- Importar JSON ---------- */
function onImportFile(ev) {
  const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    let d; try { d = JSON.parse(r.result); } catch (e) { $('importResult').textContent = '⚠ El archivo no es un JSON válido.'; return; }
    $('importResult').textContent = 'Importando… (puede tardar unos segundos)';
    try {
      const res = await api('/api/admin/import-json', { method: 'POST', body: d });
      $('importResult').innerHTML = '✅ Importación completada → ' + Object.entries(res.counts).map(([k, v]) => `${k}: <b>${v}</b>`).join(' · ') + '. Revisa Inventario, Clientes, Pedidos y Logística.';
      toast('✔ JSON importado');
    } catch (e) { $('importResult').textContent = '⚠ ' + e.message; }
  };
  r.readAsText(f);
}
/* ---------- Factura PDF ---------- */
const FONT_MAP = {
  'Arial': 'Inter', 'Nunito': 'NunitoSans', 'Montserrat': 'Montserrat',
  'Perfect Lemonade': 'PerfectLemonade', 'Sweetbliss Personal Use': 'Sweetbliss',
  'Shortcake Strawberry': 'ShortcakeStrawberry', 'Mochibop': 'Mochibop',
};
async function generateInvoice(orderId) {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) return toast('⚠ El generador de PDF aún carga; intenta en unos segundos');
    if (!CFG) CFG = await api('/api/admin/settings');
    const o = await api('/api/admin/orders/' + orderId);
    const cfg = CFG.invoice_config || {};
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const hasFonts = typeof window.registerCustomFonts === 'function';
    if (hasFonts) registerCustomFonts(doc);
    const green = [63, 125, 74], dark = [22, 22, 22], muted = [92, 106, 95], red = [192, 57, 43];
    const TF = hasFonts ? (FONT_MAP[cfg.fontTitulos] || FONT_MAP['Arial']) : 'helvetica';
    const BF = hasFonts ? (FONT_MAP[cfg.fontCuerpo] || FONT_MAP['Arial']) : 'helvetica';
    const setTitleFont = (st) => doc.setFont(TF, st || 'normal');
    const setBodyFont = (st) => doc.setFont(BF, st || 'normal');
    const tSup = hasFonts ? nTildeFallback(doc, TF) : { lower: true, upper: true };
    const bSup = hasFonts ? nTildeFallback(doc, BF) : { lower: true, upper: true };
    const tt = hasFonts ? (t) => applyNTildeFallback(t, tSup) : (t) => t;
    const bt = hasFonts ? (t) => applyNTildeFallback(t, bSup) : (t) => t;
    if (cfg.watermark && cfg.watermarkW && cfg.watermarkH) {
      try {
        const availW = 170, availH = 257, ratio = cfg.watermarkW / cfg.watermarkH;
        let w = availW, h = w / ratio; if (h > availH) { h = availH; w = h * ratio; }
        const fmt = /jpe?g/.test(cfg.watermark) ? 'JPEG' : 'PNG';
        doc.setGState(new doc.GState({ opacity: 0.12 }));
        doc.addImage(cfg.watermark, fmt, (210 - w) / 2, (297 - h) / 2, w, h, undefined, 'FAST');
        doc.setGState(new doc.GState({ opacity: 1 }));
      } catch (e) { }
    }
    let y = 18;
    const drawCompanyName = () => { setTitleFont('bold'); doc.setFontSize(16); doc.setTextColor(...green); doc.text(tt(cfg.empresa || 'Pandala Kawaii'), 14, y + 4); };
    if (cfg.logo) { try { doc.addImage(cfg.logo, /jpe?g/.test(cfg.logo) ? 'JPEG' : 'PNG', 14, y - 6, 40, 22, undefined, 'FAST'); } catch (e) { drawCompanyName(); } }
    else drawCompanyName();
    setBodyFont('normal'); doc.setFontSize(9); doc.setTextColor(...muted);
    let iy = y + 18;
    const info = [];
    if (cfg.direccion) info.push(cfg.direccion);
    const contact = []; if (cfg.telefono) contact.push('Tel: ' + cfg.telefono); if (cfg.email) contact.push(cfg.email);
    if (contact.length) info.push(contact.join(' · '));
    if (cfg.nit) info.push('NIT/Doc: ' + cfg.nit);
    info.forEach(l => { doc.text(bt(l), 14, iy); iy += 4.5; });
    setTitleFont('bold'); doc.setFontSize(18); doc.setTextColor(...green);
    doc.text('FACTURA', 196, y + 2, { align: 'right' });
    setBodyFont('normal'); doc.setFontSize(10); doc.setTextColor(...dark);
    doc.text('No. ' + o.order_number, 196, y + 9, { align: 'right' });
    doc.text('Fecha: ' + String(o.created_at || '').slice(0, 10), 196, y + 14, { align: 'right' });
    doc.text('Estado: ' + (STATUS_LABEL[o.status] || o.status), 196, y + 19, { align: 'right' });
    const lineY = Math.max(iy, y + 24) + 2;
    doc.setDrawColor(...green); doc.setLineWidth(0.6); doc.line(14, lineY, 196, lineY);
    let by = lineY + 8;
    setTitleFont('bold'); doc.setFontSize(9); doc.setTextColor(...muted);
    doc.text('CLIENTE', 14, by);
    setBodyFont('normal'); doc.setFontSize(10); doc.setTextColor(...dark);
    doc.text(bt(o.client_name || ''), 14, by + 6);
    doc.setFontSize(9); doc.setTextColor(...muted);
    let cy = by + 11;
    if (o.client_whatsapp) { doc.text(bt(String(o.client_whatsapp)), 14, cy); cy += 4.5; }
    if (o.client_city) { doc.text(bt('Ciudad: ' + o.client_city), 14, cy); cy += 4.5; }
    if (o.client_address) { doc.text(bt(String(o.client_address)), 14, cy); cy += 4.5; }
    doc.autoTable({
      startY: cy + 6,
      head: [['Producto', 'Fecha', 'Cant.', 'Precio Un.', 'Total']],
      body: o.items.map(i => [bt(i.kit_name ? ('Kit: ' + i.kit_name) : String(i.product_name || '')), String(i.added_at || '').slice(0, 10), String(i.quantity), pdfMoney(i.price), pdfMoney(i.price * i.quantity)]),
      theme: 'plain',
      styles: { font: BF, fontSize: 9, textColor: dark, cellPadding: 2.5 },
      headStyles: { font: TF, fontStyle: 'bold', fillColor: [233, 244, 234], textColor: [47, 95, 56] },
      columnStyles: { 1: { halign: 'center', cellWidth: 25 }, 2: { halign: 'center', cellWidth: 16 }, 3: { halign: 'right', cellWidth: 28 }, 4: { halign: 'right', cellWidth: 28 } },
      margin: { left: 14, right: 14 },
    });
    let ay = doc.lastAutoTable.finalY + 8;
    setBodyFont('normal'); doc.setFontSize(10); doc.setTextColor(...dark);
    doc.text('Total pedido:', 150, ay); doc.text(pdfMoney(o.total), 196, ay, { align: 'right' });
    doc.text('Total abonado:', 150, ay + 6); doc.text(pdfMoney(o.paid), 196, ay + 6, { align: 'right' });
    doc.setDrawColor(...green); doc.line(150, ay + 9, 196, ay + 9);
    setBodyFont('bold'); doc.setFontSize(12); doc.setTextColor(...red);
    doc.text('Saldo:', 150, ay + 16); doc.text(pdfMoney(o.balance), 196, ay + 16, { align: 'right' });
    let py = ay + 26;
    setTitleFont('bold'); doc.setFontSize(9); doc.setTextColor(...muted);
    doc.text('HISTORIAL DE ABONOS', 14, py);
    if (o.payments && o.payments.length) {
      doc.autoTable({
        startY: py + 3,
        head: [['Fecha', 'Medio', 'Referencia', 'Nota', 'Valor']],
        body: o.payments.map(p => [String(p.payment_date || ''), bt(String(p.method || '')), bt(String(p.reference || '—')), bt(String(p.note || '')), pdfMoney(p.amount)]),
        theme: 'plain',
        styles: { font: BF, fontSize: 8.5, textColor: dark, cellPadding: 2 },
        headStyles: { font: TF, fontStyle: 'bold', fillColor: [247, 250, 247], textColor: muted },
        columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 26 }, 2: { cellWidth: 34 }, 4: { halign: 'right', cellWidth: 28 } },
        margin: { left: 14, right: 14 },
      });
      py = doc.lastAutoTable.finalY + 10;
    } else { setBodyFont('normal'); doc.setFontSize(9); doc.text('Sin abonos registrados', 14, py + 6); py += 16; }
    const nota = String(o.notes || '').trim();
    if (nota) {
      const lines = doc.splitTextToSize(bt(nota), 182);
      setTitleFont('bold'); doc.setFontSize(9); doc.setTextColor(...muted);
      doc.text('NOTAS', 14, py);
      setBodyFont('normal'); doc.setTextColor(...dark);
      doc.text(lines, 14, py + 5);
    }
    const H = doc.internal.pageSize.getHeight();
    setBodyFont('italic'); doc.setFontSize(8.5); doc.setTextColor(...muted);
    doc.text(bt(cfg.mensaje || ''), 105, H - 12, { align: 'center' });
    doc.save('Factura_' + o.order_number + '.pdf');
    toast('✔ Factura generada');
  } catch (e) { console.error(e); toast('⚠ ' + e.message); }
}

document.addEventListener('DOMContentLoaded', init);