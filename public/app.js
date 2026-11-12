/* ===== Pandala Kawaii · Tienda (frontend cliente) ===== */
const SLUG = new URLSearchParams(location.search).get('t') || 'tuliveshop';
let token = localStorage.getItem('token') || '';
let user = JSON.parse(localStorage.getItem('user') || 'null');
let products = [], kits = [], categories = [], config = null;
let bolsitas = [];
let selCats = new Set();
let payTarget = null;
let socket = null;
let avatarPending = null; // null = sin cambio; '' = quitar; dataURL = nueva foto

const $ = (id) => document.getElementById(id);
const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);
const pdfMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const ACTIVE = ['draft', 'pending_confirm', 'apartada'];
const STATUS_LABEL = { draft: 'Borrador', pending_confirm: 'Por confirmar', apartada: 'Apartada', paid: 'Pagada', shipped: 'Enviada', delivered: 'Entregada', expired: 'Vencida', canceled: 'Cancelada' };
const STATUS_CLASS = { draft: '', pending_confirm: 'warn', apartada: 'warn', paid: 'ok', shipped: 'ok', delivered: 'ok', expired: 'danger', canceled: 'danger' };
const pill = (s) => `<span class="pill ${STATUS_CLASS[s] || ''}">${STATUS_LABEL[s] || esc(s)}</span>`;

if (user && !user.role) {
  user.role = user.whatsapp ? 'client' : 'admin';
  localStorage.setItem('user', JSON.stringify(user));
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
  return data;
}

function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 3500); }
function fail(e, el) { if (el) $(el).textContent = e.message; else toast('⚠ ' + e.message); }
function closeModal(id) { $(id).classList.remove('open'); }
function openModal(id) { $(id).classList.add('open'); }

/* ---------- Tema (claro / cálido / oscuro) ---------- */
function setTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === mode));
  localStorage.setItem('uiTheme', mode);
}

/* ---------- Vistas ---------- */
function showView(v) {
  document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
  $('view-' + v).classList.add('active');
  const client = (v === 'shop' || v === 'bolsita' || v === 'facturas');
  $('hdr').classList.toggle('hidden', v === 'access');
  $('search').classList.toggle('hidden', v !== 'shop');
  $('btnBolsita').classList.toggle('hidden', v !== 'shop' && v !== 'bolsita');
  $('clientWhoWrap').classList.toggle('hidden', v === 'access');
  if (v === 'shop') loadCatalog();
  if (v === 'bolsita') loadBolsitas();
  if (v === 'facturas') loadFacturas();
}

function goHome() {
  if (!user || !token) return showView('access');
  if (user.role !== 'client') { location.href = '/admin.html'; return; }
  showView('shop');
}

/* ---------- Menú del cliente ---------- */
function toggleClientMenu() { $('clientMenu').classList.toggle('hidden'); }
function closeClientMenu() { $('clientMenu').classList.add('hidden'); }
function menuClient(v) {
  closeClientMenu();
  if (v === 'profile') openProfile();
  else if (v === 'address') openAddress();
  else if (v === 'facturas') showView('facturas');
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('#clientWhoWrap')) closeClientMenu();
  if (!e.target.closest('.cats-drop')) closeCatsDrop();
});

function updateWho() {
  if ($('clientWhoName')) $('clientWhoName').textContent = (user && user.name) || '—';
}

/* ---------- Sesión ---------- */
function setAuthTab(tab) {
  $('tabLogin').classList.toggle('active', tab === 'login');
  $('tabReg').classList.toggle('active', tab === 'reg');
  $('formLogin').classList.toggle('hidden', tab !== 'login');
  $('formReg').classList.toggle('hidden', tab !== 'reg');
}

function saveSession(d) {
  token = d.token; user = d.user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  if (d.portfolio) localStorage.setItem('portfolio', JSON.stringify(d.portfolio));
  updateWho();
  joinRoom();
}

function logout() {
  token = ''; user = null;
  localStorage.removeItem('token'); localStorage.removeItem('user');
  localStorage.removeItem('portfolio');
  showView('access');
}

async function clientLogin(ev) {
  ev.preventDefault(); $('loginErr').textContent = '';
  try {
    const d = await api('/api/auth/client/login', { method: 'POST', body: { whatsapp: $('loginWa').value.trim(), pin: $('loginPin').value.trim(), portfolio_slug: SLUG } });
    d.user.role = d.user.role || 'client';
    saveSession(d); toast('¡Hola, ' + d.user.name + '!'); showView('shop');
  } catch (e) { fail(e, 'loginErr'); }
}

async function clientRegister(ev) {
  ev.preventDefault(); $('regErr').textContent = '';
  try {
    const d = await api('/api/auth/client/register', { method: 'POST', body: { name: $('regName').value.trim(), whatsapp: $('regWa').value.trim(), city: $('regCity').value.trim(), address: $('regAddress').value.trim(), pin: $('regPin').value.trim(), portfolio_slug: SLUG } });
    d.user.role = d.user.role || 'client';
    saveSession(d); toast('Cuenta creada. ¡Bienvenida!'); showView('shop');
  } catch (e) { fail(e, 'regErr'); }
}

/* ---------- Mi perfil ---------- */
async function openProfile() {
  try {
    const d = await api('/api/auth/me');
    user = { ...user, ...d.user };
    localStorage.setItem('user', JSON.stringify(user));
  } catch (e) { /* usa los datos en sesión */ }
  avatarPending = null;
  $('pfNameC').value = user.name || '';
  $('pfWaC').value = user.whatsapp || '';
  $('pfCityC').value = user.city || '';
  $('pfAddrC').value = user.address || '';
  $('pfTiktok').value = user.tiktok || '';
  $('pfInsta').value = user.instagram || '';
  setAvatarPrev(user.avatar || '');
  openModal('profileModal');
}
function setAvatarPrev(src) {
  const img = $('pfAvatarPrev');
  img.src = src || '';
  img.style.display = src ? 'inline-block' : 'none';
}
function readAvatar(input) {
  const f = input.files && input.files[0]; if (!f) return;
  if (f.size > 1500000) { toast('⚠ La foto pesa más de 1.5 MB'); input.value = ''; return; }
  const r = new FileReader();
  r.onload = (ev) => { avatarPending = ev.target.result; setAvatarPrev(avatarPending); };
  r.readAsDataURL(f);
}
function clearAvatar() { avatarPending = ''; setAvatarPrev(''); $('pfAvatar').value = ''; }
async function saveProfile() {
  const body = {
    name: $('pfNameC').value.trim(), city: $('pfCityC').value.trim(), address: $('pfAddrC').value.trim(),
    tiktok: $('pfTiktok').value.trim(), instagram: $('pfInsta').value.trim(),
  };
  if (avatarPending !== null) body.avatar = avatarPending;
  try {
    const d = await api('/api/auth/me', { method: 'PUT', body });
    user = { ...user, ...d.user };
    localStorage.setItem('user', JSON.stringify(user));
    updateWho(); closeModal('profileModal'); toast('✔ Perfil actualizado');
  } catch (e) { toast('⚠ ' + e.message); }
}

/* ---------- Mi dirección ---------- */
function openAddress() {
  $('adCity').value = user.city || '';
  $('adAddr').value = user.address || '';
  openModal('addressModal');
}
async function saveAddress() {
  try {
    const d = await api('/api/auth/me', { method: 'PUT', body: { city: $('adCity').value.trim(), address: $('adAddr').value.trim() } });
    user = { ...user, ...d.user };
    localStorage.setItem('user', JSON.stringify(user));
    closeModal('addressModal'); toast('✔ Dirección actualizada');
  } catch (e) { toast('⚠ ' + e.message); }
}

/* ---------- Mis facturas ---------- */
async function loadFacturas() {
  try {
    const rows = await api('/api/orders/mine');
    $('facturasList').innerHTML = rows.length ?
      '<div class="tablewrap" style="overflow:auto;border:1px solid var(--border);border-radius:12px"><table class="rep"><thead><tr><th>Bolsita</th><th>Fecha</th><th>Estado</th><th>Total</th><th>Abonado</th><th>Pendiente</th><th>Factura</th></tr></thead><tbody>' +
      rows.map(o => `<tr><td><b>${esc(o.order_number)}</b></td><td>${String(o.created_at || '').slice(0, 10)}</td><td>${pill(o.status)}</td><td>${money(o.total)}</td><td>${money(o.paid)}</td><td>${money(o.balance)}</td>
        <td><button class="btn" onclick="clientInvoice('${o.id}')">📄 Descargar PDF</button></td></tr>`).join('') +
      '</tbody></table></div>' : '<p class="note">Aún no tienes bolsitas registradas.</p>';
  } catch (e) { toast('⚠ ' + e.message); }
}

const FONT_MAP = {
  'Arial': 'Inter', 'Nunito': 'NunitoSans', 'Montserrat': 'Montserrat',
  'Perfect Lemonade': 'PerfectLemonade', 'Sweetbliss Personal Use': 'Sweetbliss',
  'Shortcake Strawberry': 'ShortcakeStrawberry', 'Mochibop': 'Mochibop',
};
async function clientInvoice(id) {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) return toast('⚠ El generador de PDF aún carga; intenta en unos segundos');
    const d = await api('/api/orders/' + id + '/invoice');
    buildClientPdf(d);
  } catch (e) { toast('⚠ ' + e.message); }
}
function buildClientPdf(d) {
  const o = d.order, cfg = d.config || {}, client = d.client || {};
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
      const ratio = cfg.watermarkW / cfg.watermarkH;
      let w = 170, h = w / ratio; if (h > 257) { h = 257; w = h * ratio; }
      doc.setGState(new doc.GState({ opacity: 0.12 }));
      doc.addImage(cfg.watermark, /jpe?g/.test(cfg.watermark) ? 'JPEG' : 'PNG', (210 - w) / 2, (297 - h) / 2, w, h, undefined, 'FAST');
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
  doc.text(bt(client.name || ''), 14, by + 6);
  doc.setFontSize(9); doc.setTextColor(...muted);
  let cy = by + 11;
  if (client.whatsapp) { doc.text(bt(String(client.whatsapp)), 14, cy); cy += 4.5; }
  if (client.city) { doc.text(bt('Ciudad: ' + client.city), 14, cy); cy += 4.5; }
  if (client.address) { doc.text(bt(String(client.address)), 14, cy); cy += 4.5; }
  doc.autoTable({
    startY: cy + 6,
    head: [['Producto', 'Fecha', 'Cant.', 'Precio Un.', 'Total']],
    body: d.items.map(i => [bt(i.kit_name ? ('Kit: ' + i.kit_name) : String(i.product_name || '')), String(i.added_at || '').slice(0, 10), String(i.quantity), pdfMoney(i.price), pdfMoney(i.price * i.quantity)]),
    theme: 'plain',
    styles: { font: BF, fontSize: 9, textColor: dark, cellPadding: 2.5 },
    headStyles: { font: TF, fontStyle: 'bold', fillColor: [233, 244, 234], textColor: [47, 95, 56] },
    columnStyles: { 1: { halign: 'center', cellWidth: 25 }, 2: { halign: 'center', cellWidth: 16 }, 3: { halign: 'right', cellWidth: 28 }, 4: { halign: 'right', cellWidth: 28 } },
    margin: { left: 14, right: 14 },
  });
  let ay = doc.lastAutoTable.finalY + 8;
  setBodyFont('normal'); doc.setFontSize(10); doc.setTextColor(...dark);
  doc.text('Total pedido:', 150, ay); doc.text(pdfMoney(d.total), 196, ay, { align: 'right' });
  doc.text('Total abonado:', 150, ay + 6); doc.text(pdfMoney(d.paid), 196, ay + 6, { align: 'right' });
  doc.setDrawColor(...green); doc.line(150, ay + 9, 196, ay + 9);
  setBodyFont('bold'); doc.setFontSize(12); doc.setTextColor(...red);
  doc.text('Saldo:', 150, ay + 16); doc.text(pdfMoney(d.balance), 196, ay + 16, { align: 'right' });
  let py = ay + 26;
  setTitleFont('bold'); doc.setFontSize(9); doc.setTextColor(...muted);
  doc.text('HISTORIAL DE ABONOS', 14, py);
  if (d.payments && d.payments.length) {
    doc.autoTable({
      startY: py + 3,
      head: [['Fecha', 'Medio', 'Referencia', 'Nota', 'Valor']],
      body: d.payments.map(p => [String(p.payment_date || ''), bt(String(p.method || '')), bt(String(p.reference || '—')), bt(String(p.note || '')), pdfMoney(p.amount)]),
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
  toast('✔ Factura descargada');
}

/* ---------- Catálogo ---------- */
async function loadCatalog() {
  try {
    const [p, k, c, cfg] = await Promise.all([
      api('/api/products/portfolio/' + SLUG),
      api('/api/products/kits/' + SLUG),
      api('/api/products/categories/' + SLUG),
      config ? Promise.resolve(config) : api('/api/products/config/' + SLUG),
    ]);
    products = p; kits = k; categories = c; config = cfg;
    renderCats();
    renderCatalog();
    loadBolsitas(true);
  } catch (e) { toast('⚠ ' + e.message); }
}

/* Categorías: mismo contenido en el menú lateral (PC) y en el desplegable (tablet/celular) */
function catRowsHtml() {
  return categories.length ? categories.map((c, i) =>
    `<label class="cat-row"><input type="checkbox" ${selCats.has(c.name) ? 'checked' : ''} onchange="toggleCatIdx(${i},this.checked)"> <span title="${esc(c.name)}">${esc(c.name)}</span></label>`
  ).join('') : '<p class="note">Sin categorías.</p>';
}
function renderCats() {
  const html = catRowsHtml();
  $('catsList').innerHTML = html;
  $('catsDropList').innerHTML = html;
  $('catsDropLabel').textContent = selCats.size
    ? '🗂 Categorías: ' + selCats.size + ' seleccionada(s)'
    : '🗂 Categorías: todas';
}
function toggleCatIdx(i, on) {
  const n = categories[i].name;
  if (on) selCats.add(n); else selCats.delete(n);
  renderCats();
  renderCatalog();
}
function clearCats() { selCats.clear(); renderCats(); renderCatalog(); }
function toggleCatsDrop() { $('catsDropPanel').classList.toggle('open'); }
function closeCatsDrop() { const p = $('catsDropPanel'); if (p) p.classList.remove('open'); }

function sortedProducts(list) {
  const m = $('sortSel') ? $('sortSel').value : 'alpha';
  const arr = [...list];
  if (m === 'alpha') arr.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (m === 'new') arr.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  if (m === 'priceDesc') arr.sort((a, b) => Number(b.price) - Number(a.price));
  if (m === 'priceAsc') arr.sort((a, b) => Number(a.price) - Number(b.price));
  if (m === 'avail') arr.sort((a, b) => Number(b.available) - Number(a.available));
  return arr;
}

/* Catálogo: los agotados NO se muestran al cliente (ni productos ni kits) */
function renderCatalog() {
  const q = ($('search').value || '').toLowerCase();
  const list = sortedProducts(products.filter(p =>
    Number(p.available) > 0 &&
    (!selCats.size || selCats.has(p.category || '')) &&
    (!q || p.name.toLowerCase().includes(q) || String(p.code || '').includes(q))));
  $('catCount').textContent = list.length + ' producto(s)' + (selCats.size ? ' · ' + selCats.size + ' categoría(s) seleccionada(s)' : '');
  $('catalog').innerHTML = list.length ? list.map(p => {
    return '<div class="pcard"><div class="cat">' + esc(p.category || 'SIN CATEGORÍA') + '</div><div class="name">' + esc(p.name) + '</div><div class="price">' + money(p.price) + '</div>' +
      '<span class="pill ' + (Number(p.available) <= 2 ? 'warn' : 'ok') + '">Disponibles: ' + p.available + '</span>' +
      '<button class="btn primary" onclick="addProduct(\'' + p.id + '\')">Agregar</button></div>';
  }).join('') : '<p class="note">No hay productos disponibles con esos filtros.</p>';
  const kitsOk = kits.filter(k => Number(k.available) > 0);
  $('kits').innerHTML = kitsOk.length ? kitsOk.map(k => {
    return '<div class="pcard"><div class="cat">KIT</div><div class="name">🎁 ' + esc(k.name) + '</div><div class="note">' + (k.components || []).map(c => c.quantity + '× ' + esc(c.product_name)).join(' · ') + '</div><div class="price">' + money(k.price) + '</div>' +
      '<span class="pill ' + (Number(k.available) <= 2 ? 'warn' : 'ok') + '">Disponibles: ' + k.available + '</span>' +
      '<button class="btn primary" onclick="addKit(\'' + k.id + '\')">Agregar</button></div>';
  }).join('') : '<p class="note">No hay kits disponibles por ahora.</p>';
}

/* ---------- Bolsita actual ---------- */
function currentBolsita() {
  const act = bolsitas.filter(b => ACTIVE.includes(b.status));
  act.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return act[0] || null;
}
async function ensureDraft() {
  const o = await api('/api/orders', { method: 'POST' });
  return o.id;
}
async function addItem(body) {
  const oid = await ensureDraft();
  try {
    return await api('/api/orders/' + oid + '/items', { method: 'POST', body });
  } catch (e) {
    if (/no encontrada|ya no puede modificarse/i.test(e.message)) {
      await loadBolsitas(true);
      const oid2 = await ensureDraft();
      return api('/api/orders/' + oid2 + '/items', { method: 'POST', body });
    }
    throw e;
  }
}
async function addProduct(id) {
  try { await addItem({ product_id: id, quantity: 1 }); toast('✔ Agregado a tu bolsita'); loadCatalog(); }
  catch (e) { toast('⚠ ' + e.message); loadCatalog(); }
}
async function addKit(id) {
  try { await addItem({ kit_id: id, quantity: 1 }); toast('✔ Kit agregado a tu bolsita'); loadCatalog(); }
  catch (e) { toast('⚠ ' + e.message); loadCatalog(); }
}

/* ---------- Mi Bolsita ---------- */
async function loadBolsitas(silent) {
  try {
    bolsitas = await api('/api/orders/mine');
    const cur = currentBolsita();
    $('bolsitaCount').textContent = cur ? '(' + cur.items.reduce((a, i) => a + Number(i.quantity), 0) + ')' : '';
    if (!silent) renderBolsitas();
  } catch (e) {
    if (/Token/i.test(e.message)) logout();
    else if (!silent) toast('⚠ ' + e.message);
  }
}
const hoursLeft = (iso) => Math.max(0, Math.round((new Date(iso) - Date.now()) / 3600000));
function bolsitaCard(b) {
  const canEdit = b.status === 'draft';
  const canPay = ACTIVE.includes(b.status);
  return '<div class="bolsita"><div class="head"><b>' + b.order_number + '</b><span class="pill ' + (STATUS_CLASS[b.status] || '') + '">' + STATUS_LABEL[b.status] + '</span>' +
    (b.status === 'draft' && b.expires_at ? '<span class="note">⏱ expira en ' + hoursLeft(b.expires_at) + ' h</span>' : '') +
    (b.status === 'pending_confirm' ? '<span class="note">Tu abono está en confirmación</span>' : '') + '</div>' +
    '<table class="lines">' + b.items.map(i => '<tr><td>' + (i.kit_name ? '🎁 ' + esc(i.kit_name) : esc(i.product_name)) + '</td><td>×' + i.quantity + '</td><td style="text-align:right">' + money(i.price * i.quantity) + '</td>' +
    (canEdit ? '<td style="width:40px"><button class="btn danger" onclick="removeItem(\'' + b.id + '\',\'' + i.id + '\')">✕</button></td>' : '<td></td>') + '</tr>').join('') + '</table>' +
    '<div class="totals"><span>Total: ' + money(b.total) + '</span><span>Abonado: ' + money(b.paid) + '</span><span>Saldo: ' + money(b.balance) + '</span></div>' +
    (canPay ? '<div class="actions"><button class="btn primary" onclick="openPay(\'' + b.id + '\',\'separar\')">Separar / Abonar</button><button class="btn" onclick="openPay(\'' + b.id + '\',\'total\')">Pagar total</button></div>' : '') +
    '</div>';
}
function renderBolsitas() {
  const act = bolsitas.filter(b => ACTIVE.includes(b.status));
  const hist = bolsitas.filter(b => !ACTIVE.includes(b.status));
  $('bolsitas').innerHTML = act.length ? act.map(bolsitaCard).join('') : '<p class="note">No tienes bolsitas activas. Agrega productos desde el catálogo.</p>';
  $('historial').innerHTML = hist.length ? hist.map(bolsitaCard).join('') : '<p class="note">Aún no tienes historial.</p>';
}
async function removeItem(orderId, itemId) {
  try {
    await api('/api/orders/' + orderId + '/items/' + itemId, { method: 'DELETE' });
    toast('Producto quitado'); loadCatalog(); loadBolsitas();
  } catch (e) { toast('⚠ ' + e.message); }
}

/* ---------- Pago Bre-b + WhatsApp ---------- */
async function openPay(id, mode) {
  const b = bolsitas.find(x => x.id === id); if (!b) return;
  payTarget = { id, mode };
  try { if (!config) config = await api('/api/products/config/' + SLUG); } catch (e) { toast('⚠ ' + e.message); return; }
  $('brebKey').textContent = config.bre_b_key;
  $('payTitle').textContent = (mode === 'total' ? 'Pagar total — ' : 'Separar / Abonar — ') + b.order_number;
  const min = Math.min(Number(b.balance), 10000);
  $('paySummary').innerHTML = 'Total: <b>' + money(b.total) + '</b> · Abonado: <b>' + money(b.paid) + '</b> · Saldo: <b>' + money(b.balance) + '</b><br>' +
    (mode === 'total' ? 'Reportarás el pago completo del saldo.' : 'Abono mínimo: <b>' + money(min) + '</b>' + (Number(b.balance) < 10000 ? ' (el saldo, porque es menor a $10.000)' : '') + '.');
  $('payAmount').value = mode === 'total' ? b.balance : min;
  $('payError').textContent = '';
  $('payForm').classList.remove('hidden');
  $('payWhatsapp').classList.add('hidden');
  $('payModal').classList.add('open');
}
function closePay() { $('payModal').classList.remove('open'); payTarget = null; }
function copyBreb() { navigator.clipboard.writeText(config.bre_b_key).then(() => toast('Llave Bre-b copiada ✔')); }
async function reportPayment() {
  if (!payTarget) return;
  const amount = Number($('payAmount').value) || 0;
  $('payError').textContent = '';
  try {
    const r = await api('/api/orders/' + payTarget.id + '/separar', { method: 'POST', body: { amount } });
    $('payForm').classList.add('hidden');
    $('waLink').href = r.whatsapp_link;
    $('payWhatsapp').classList.remove('hidden');
    loadBolsitas(); loadCatalog();
  } catch (e) { $('payError').textContent = e.message; }
}

/* ---------- Tiempo real + arranque ---------- */
function joinRoom() {
  if (!socket) return;
  let pf = null;
  try { pf = JSON.parse(localStorage.getItem('portfolio') || 'null'); } catch (e) { pf = null; }
  if (pf && pf.id) socket.emit('join-portfolio', pf.id);
}
function initSocket() {
  if (!window.io) return;
  socket = io();
  socket.on('connect', joinRoom);
  socket.on('stock-updated', () => {
    const active = document.querySelector('.view.active');
    if (!active) return;
    if (active.id === 'view-shop') loadCatalog();
    if (active.id === 'view-bolsita') loadBolsitas();
  });
  socket.on('report-resolved', (p) => {
    if (!user || !p || p.clientId !== user.id) return;
    if (p.decision === 'approve') toast('✔ Tu abono en ' + p.orderNumber + ' fue APROBADO → bolsita ' + (STATUS_LABEL[p.newStatus] || p.newStatus));
    else toast('⚠ Tu abono en ' + p.orderNumber + ' fue RECHAZADO. Tu bolsita volvió a borrador: puedes corregirlo y reportar de nuevo.');
    loadBolsitas(); loadCatalog();
  });
}
function init() {
  setTheme(localStorage.getItem('uiTheme') || 'light');
  initSocket();
  if (user && token) {
    if (user.role === 'client') { updateWho(); showView('shop'); }
    else location.href = '/admin.html';
  } else showView('access');
}
document.addEventListener('DOMContentLoaded', init);