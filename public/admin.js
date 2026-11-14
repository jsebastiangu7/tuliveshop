/* ===== Pandala Kawaii · Panel Administrador (limpio + Excel + import + responsive + seguridad) ===== */
let token = localStorage.getItem('token') || '';
let user = JSON.parse(localStorage.getItem('user') || 'null');
let CFG = null, PRODUCTS = [], KITS = [], CATS = [], CLIENTS = [], ORDERS = [];
let ANALYTICS = null, GOALS = [], DONATIONS = [], LOGIS = [];
let curOrderId = null, logoData = null, wmData = null, wmW = 0, wmH = 0;
let legalDoc = 'privacy';
let impRows = [], impFileName = '';

const $ = (id) => document.getElementById(id);
const put = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
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
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.includes('/auth/')) { logout(); throw new Error('Sesión vencida: ingresa de nuevo'); }
  if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
  return data;
}
function toast(msg) { const t = $('toast'); if (!t) return; t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 3200); }
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
  const v = $('view-login'); if (v) v.classList.add('active');
  const h = $('hdr'); if (h) h.classList.add('hidden');
}
function enterPanel() {
  $('hdr').classList.remove('hidden');
  if ($('whoName')) $('whoName').textContent = user.name;
  ensureExtraUI();
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
    if (d.must_change_password) { const cp = document.getElementById('pkChangePwd'); if (cp) cp.classList.add('open'); }
  } catch (e) { $('aErr').textContent = e.message; }
}
function logout() {
  token = ''; user = null;
  localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('portfolio');
  showLogin();
}

/* ---------- Menú del administrador ---------- */
function toggleUserMenu() { $('userMenu').classList.toggle('hidden'); }
function closeUserMenu() { const m = $('userMenu'); if (m) m.classList.add('hidden'); }
function menuGo(v) { closeUserMenu(); showTab(v); }
document.addEventListener('click', (e) => { if (!e.target.closest('.who-wrap')) closeUserMenu(); });

/* ---------- Navegación ---------- */
const TABS = [
  ['dash', 'Dashboard'], 
  ['ventas', 'Ventas'], 
  ['ventas-prod', 'Ventas x Prod.'], 
  ['abonos', 'Abonos'], 
  ['inv', 'Inventario'], 
  ['kits', 'Kits'], 
  ['clients', 'Clientes'], 
  ['orders', 'Pedidos'],
  ['cats', 'Categorías'],
  ['logis', 'Logística'] 
];
let currentTab = 'dash';
function renderTabs() { const t = $('tabs'); if (t) t.innerHTML = TABS.map(([id, n]) => `<button class="chip ${currentTab === id ? 'active' : ''}" onclick="showTab('${id}')">${n}</button>`).join(''); }
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
  if (!window.LEGAL_DOCS || !$('legalContent')) return;
  const lang = $('legalLang').value || 'es';
  $('legalContent').innerHTML = window.LEGAL_DOCS[legalDoc][lang];
  $('legalBtnPrivacy').className = 'btn' + (legalDoc === 'privacy' ? ' primary' : '');
  $('legalBtnTerms').className = 'btn' + (legalDoc === 'terms' ? ' primary' : '');
}

/* ---------- UI extra inyectada ---------- */
function injectStyleOnce() {
  if ($('admExtraCss')) return;
  const s = document.createElement('style'); s.id = 'admExtraCss';
  s.textContent = `@media(max-width:900px){header{padding:8px 10px}.hdr-bottom{gap:8px}nav#tabs{overflow-x:auto;flex-wrap:nowrap;scrollbar-width:thin}.hdr-icons{margin-left:0}} @media(max-width:650px){.toolbar{gap:6px}.toolbar input,.toolbar select{flex:1 1 46%;min-width:0}.modal{padding:16px}.fgrid{grid-template-columns:1fr 1fr}.who-btn span{max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.metric{font-size:23px}} @media(max-width:430px){.fgrid{grid-template-columns:1fr}.cards{grid-template-columns:1fr 1fr}.metric{font-size:21px;white-space:nowrap}} .imp-table input,.imp-table select{padding:6px 8px;font-size:12.5px;min-width:70px}`;
  document.head.appendChild(s);
}
function ensureXLSX() {
  if (window.XLSX) return;
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  document.head.appendChild(s);
}
function ensureExtraUI() {
  injectStyleOnce(); ensureXLSX();
  if ($('dashSummary') && !$('sumBaseWrap')) {
    const wrap = document.createElement('div');
    wrap.id = 'sumBaseWrap'; wrap.className = 'toolbar'; wrap.style.marginBottom = '10px';
    wrap.innerHTML = `<label class="note" style="display:flex;gap:6px;align-items:center">Base del resumen <select id="sumBase" onchange="renderSummary()"><option value="cobrado" selected>Lo cobrado (como tu app original)</option><option value="vendido">Lo vendido</option></select></label>`;
    $('dashSummary').parentNode.insertBefore(wrap, $('dashSummary'));
  }
  const invTb = document.querySelector('#view-inv .toolbar');
  if (invTb && !$('btnInvTpl')) {
    invTb.insertAdjacentHTML('beforeend', `<button class="btn" id="btnInvTpl" onclick="downloadInventoryTemplate()">Plantilla Excel</button><button class="btn" id="btnInvLoad" onclick="$('invImportFile').click()">📥 Cargar inventario</button><input type="file" id="invImportFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleInventoryFile(event)"><button class="btn" onclick="exportInventoryExcel()">⬇ Excel</button>`);
  }
  const ordTb = document.querySelector('#view-orders .toolbar');
  if (ordTb && !$('btnOrdXlsx')) ordTb.insertAdjacentHTML('beforeend', `<button class="btn" id="btnOrdXlsx" onclick="exportOrdersExcel()">⬇ Excel</button>`);
  const cliTb = document.querySelector('#view-clients .toolbar');
  if (cliTb && !$('btnCliXlsx')) cliTb.insertAdjacentHTML('beforeend', `<button class="btn" id="btnCliXlsx" onclick="exportClientsExcel()">⬇ Excel</button>`);
  const logisView = $('view-logis');
  if (logisView && !$('btnLogXlsx')) logisView.querySelector('h1').insertAdjacentHTML('afterend', `<div class="toolbar"><button class="btn" id="btnLogXlsx" onclick="exportShipmentsExcel()">⬇ Excel envíos</button></div>`);
  if (!$('invImportModal')) {
    document.body.insertAdjacentHTML('beforeend', `
<div id="invImportModal" class="modal-backdrop"><div class="modal" style="width:min(1080px,100%)">
  <h2>Revisar archivo de inventario</h2>
  <p class="note">Nada se guarda hasta confirmar. En <b>existentes</b> la cantidad se suma al stock y se actualizan costo/envío/categoría/fecha; en <b>nuevos</b> define el stock inicial.</p>
  <div id="impSummary" class="note" style="margin:8px 0"></div>
  <div class="tablewrap" style="max-height:52vh"><table class="adm imp-table"><thead><tr><th>Estado</th><th>Producto</th><th>Código</th><th>Categoría</th><th>Costo</th><th>Envío</th><th>Cant.</th><th>Precio</th><th>Fecha compra</th><th>Avisos</th></tr></thead><tbody id="impBody"></tbody></table></div>
  <div class="modal-actions"><button class="btn" onclick="closeInvImport()">Cerrar</button><button class="btn" onclick="closeInvImport()">Cancelar</button><button class="btn primary" id="impSaveBtn" onclick="confirmInventoryImport()">Guardar</button></div>
</div></div>`);
  }
}

/* ---------- Excel ---------- */
function downloadExcel(filename, sheetName, rows) {
  if (!window.XLSX) { toast('⚠ La librería de Excel aún carga; intenta en unos segundos'); return; }
  if (!rows || !rows.length) { toast('⚠ No hay datos para exportar'); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
function exportOrdersExcel() {
  downloadExcel('Pedidos_' + today() + '.xlsx', 'Pedidos', ORDERS.map(o => ({
    Pedido: o.order_number, Fecha: String(o.created_at || '').slice(0, 10), Cliente: o.client_name || '',
    Estado: STATUS_LABEL[o.status] || o.status, 'Ítems': o.items_count, Total: o.total, Abonado: o.paid, Saldo: o.balance,
  })));
}
function exportClientsExcel() {
  downloadExcel('Clientes_' + today() + '.xlsx', 'Clientes', CLIENTS.map(c => ({
    Cliente: c.name, WhatsApp: c.whatsapp || '', Ciudad: c.city || '', 'Dirección': c.address || '',
    Estado: c.status, Pedidos: c.orders, Total: c.total, Abonado: c.paid, Saldo: c.balance,
  })));
}
function exportShipmentsExcel() {
  downloadExcel('Envios_' + today() + '.xlsx', 'Envíos', LOGIS.map(s => ({
    Pedido: s.order_number, Cliente: s.client_name || '',
    Estado: s.status === 'enviado' ? 'Enviado' : (s.status === 'guardado' ? 'Guardado' : 'Por enviar'),
    Pago: s.pay_mode === 'adelantado' ? 'Adelantado' : 'Por cobrar', Monto: Number(s.amount) || 0,
    Transportadora: s.carrier + (s.carrier_other ? ' (' + s.carrier_other + ')' : ''), Medidas: s.dimensions || '',
    Ciudad: s.city || '', 'Dirección': s.address || '', 'Dirección principal': s.address_kind === 'principal' ? 'Sí' : 'No',
    Enviado: s.shipped_at ? String(s.shipped_at).slice(0, 10) : '',
  })));
}
function exportInventoryExcel() {
  downloadExcel('Inventario_' + today() + '.xlsx', 'Inventario', PRODUCTS.map(p => ({
    Producto: p.name, 'Código de barras': p.code || '', 'Categoría': p.category || '', Costo: Number(p.cost) || 0,
    'Envío': Number(p.shipping_cost) || 0, Stock: p.stock, Disponible: p.available, Estado: p.status,
    'Precio venta': Number(p.price) || 0,
    'Margen %': p.price > 0 ? Number((((Number(p.price) - Number(p.cost) - Number(p.shipping_cost)) / Number(p.price)) * 100).toFixed(1)) : 0,
    'Fecha compra': p.purchase_date || '',
  })));
}
const IMPORT_COLS = ['Producto', 'Código de barras', 'Categoría', 'Costo', 'Envío', 'Cantidad', 'Precio venta', 'Fecha compra'];
function downloadInventoryTemplate() {
  if (!window.XLSX) { toast('⚠ La librería de Excel aún carga; intenta en unos segundos'); return; }
  const ws = XLSX.utils.aoa_to_sheet([IMPORT_COLS, ['Lapicero gel azul', '7701234567890', 'ESCRITURA', 1200, 100, 24, 3500, today()]]);
  ws['!cols'] = IMPORT_COLS.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  XLSX.writeFile(wb, 'Plantilla_Inventario.xlsx');
}

/* ---------- Cargar inventario con plantilla (vista previa editable) ---------- */
const impNorm = t => String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const IMP_ALIAS = { producto: 'nombre', nombre: 'nombre', codigodebarras: 'codigo', codigo: 'codigo', codbarras: 'codigo', barras: 'codigo', categoria: 'categoria', costo: 'costo', envio: 'envio', cantidad: 'cantidad', cant: 'cantidad', precioventa: 'precio', precio: 'precio', fechacompra: 'fecha', fecha: 'fecha' };
function impNum(v) {
  if (v == null || v === '') return { empty: true, n: 0 };
  if (typeof v === 'number') return isFinite(v) ? { n: v } : { bad: true };
  let t = String(v).replace(/[$\s]/g, '');
  if (!t) return { empty: true, n: 0 };
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^-?\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  const n = Number(t); return isFinite(n) ? { n } : { bad: true };
}
function impDate(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return new Date(v.getTime() + 12 * 3600000).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000) + 12 * 3600000).toISOString().slice(0, 10);
  const t = String(v).trim(); let m;
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
function handleInventoryFile(event) {
  const input = event.target, file = input.files && input.files[0]; input.value = '';
  if (!file) return;
  if (!window.XLSX) { toast('⚠ La librería de Excel aún carga; intenta de nuevo'); return; }
  const isCsv = /\.(csv|txt)$/i.test(file.name);
  const r = new FileReader();
  r.onload = () => {
    try {
      const wb = isCsv ? XLSX.read(r.result, { type: 'string', raw: true }) : XLSX.read(r.result, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
      buildImportRows(grid, file.name);
    } catch (e) { console.error(e); toast('⚠ No se pudo interpretar el archivo. Usa la plantilla .xlsx o un .csv con: ' + IMPORT_COLS.join(', ')); }
  };
  if (isCsv) r.readAsText(file, 'utf-8'); else r.readAsArrayBuffer(file);
}
function buildImportRows(grid, fileName) {
  if (!grid || !grid.length) { toast('⚠ El archivo está vacío'); return; }
  const hi = grid.findIndex(row => row.some(c => impNorm(c) === 'producto' || impNorm(c) === 'nombre'));
  if (hi < 0) { toast('⚠ No encontré la columna "Producto". Usa la plantilla.'); return; }
  const idx = {}; grid[hi].forEach((c, i) => { const k = IMP_ALIAS[impNorm(c)]; if (k && !(k in idx)) idx[k] = i; });
  if (!('nombre' in idx) || !('cantidad' in idx)) { toast('⚠ Faltan columnas obligatorias: Producto y Cantidad'); return; }
  const get = (row, k) => (k in idx ? row[idx[k]] : null);
  impRows = [];
  grid.slice(hi + 1).forEach((row, n) => {
    const nombre = String(get(row, 'nombre') == null ? '' : get(row, 'nombre')).trim();
    const codigo = String(get(row, 'codigo') == null ? '' : get(row, 'codigo')).trim();
    if (!nombre && !codigo) return;
    const byName = PRODUCTS.find(p => p.name.trim().toLowerCase() === nombre.toLowerCase());
    const byCode = codigo ? PRODUCTS.find(p => p.code && String(p.code).trim() === codigo) : null;
    const match = byCode || byName;
    impRows.push({
      line: hi + 2 + n,
      estado: match ? 'existente' : 'nuevo',
      nombre: match ? match.name : nombre,
      codigo: match && match.code ? match.code : codigo,
      categoria: String(get(row, 'categoria') == null ? '' : get(row, 'categoria')).trim(),
      costo: impNum(get(row, 'costo')).n || 0,
      envio: impNum(get(row, 'envio')).n || 0,
      cantidad: Math.max(0, Math.floor(impNum(get(row, 'cantidad')).n || 0)),
      precio: impNum(get(row, 'precio')).n || (match ? Number(match.price) || 0 : 0),
      fecha: impDate(get(row, 'fecha')) || today(),
      errs: [],
    });
  });
  if (!impRows.length) { toast('⚠ No encontré filas con datos debajo de los encabezados'); return; }
  impFileName = fileName;
  impRows.forEach(impValidateRow);
  impRender();
  openModal('invImportModal');
}
function impValidateRow(r) {
  const errs = [];
  if (r.estado === 'existente') {
    if (!PRODUCTS.some(p => p.name === r.nombre)) errs.push('El producto elegido no existe');
  } else {
    if (!r.nombre) errs.push('Falta el nombre');
    else if (PRODUCTS.some(p => p.name.trim().toLowerCase() === r.nombre.trim().toLowerCase())) errs.push('Ya existe: márcalo Existente');
  }
  if (!(r.cantidad > 0)) errs.push('Cantidad debe ser mayor a 0');
  if (r.costo < 0 || r.envio < 0 || r.precio < 0) errs.push('Costos/precio no pueden ser negativos');
  if (r.codigo && PRODUCTS.some(p => p.code && String(p.code).trim() === String(r.codigo).trim() && p.name !== r.nombre)) errs.push('Ese código pertenece a otro producto');
  r.errs = errs;
}
function impSetState(i, v) {
  const r = impRows[i]; if (!r) return;
  r.estado = v;
  if (v === 'existente' && !PRODUCTS.some(p => p.name === r.nombre)) r.nombre = '';
  impValidateRow(r); impRender();
}
function impSetField(i, k, v) {
  const r = impRows[i]; if (!r) return;
  if (k === 'cantidad') r.cantidad = Math.max(0, Math.floor(Number(v) || 0));
  else if (k === 'costo' || k === 'envio' || k === 'precio') r[k] = Number(v) || 0;
  else r[k] = String(v == null ? '' : v);
  impValidateRow(r); impRender();
}
function impRender() {
  const names = [...PRODUCTS].sort((a, b) => a.name.localeCompare(b.name, 'es')).map(p => p.name);
  put('impBody', impRows.map((r, i) => `<tr${r.errs.length ? ' style="opacity:.8"' : ''}>
    <td><select onchange="impSetState(${i},this.value)"><option value="nuevo" ${r.estado === 'nuevo' ? 'selected' : ''}>Nuevo</option><option value="existente" ${r.estado === 'existente' ? 'selected' : ''}>Existente</option></select></td>
    <td>${r.estado === 'existente' ? `<select onchange="impSetField(${i},'nombre',this.value)"><option value="">Seleccionar…</option>${names.map(n => `<option ${n === r.nombre ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : `<input value="${esc(r.nombre)}" onchange="impSetField(${i},'nombre',this.value)">`}</td>
    <td><input value="${esc(r.codigo)}" onchange="impSetField(${i},'codigo',this.value)"></td>
    <td><input value="${esc(r.categoria)}" onchange="impSetField(${i},'categoria',this.value)"></td>
    <td><input type="number" min="0" value="${r.costo}" onchange="impSetField(${i},'costo',this.value)"></td>
    <td><input type="number" min="0" value="${r.envio}" onchange="impSetField(${i},'envio',this.value)"></td>
    <td><input type="number" min="0" value="${r.cantidad}" onchange="impSetField(${i},'cantidad',this.value)"></td>
    <td><input type="number" min="0" value="${r.precio}" onchange="impSetField(${i},'precio',this.value)"></td>
    <td><input type="date" value="${esc(r.fecha)}" onchange="impSetField(${i},'fecha',this.value)"></td>
    <td>${r.errs.length ? r.errs.map(e => `<span class="pill danger">${esc(e)}</span>`).join(' ') : '<span class="pill ok">Listo</span>'}</td>
  </tr>`).join(''));
  const ok = impRows.filter(r => !r.errs.length);
  const nuevos = ok.filter(r => r.estado === 'nuevo').length;
  put('impSummary', `<b>${esc(impFileName)}</b> — ${impRows.length} fila(s): <b>${nuevos}</b> nueva(s), <b>${ok.length - nuevos}</b> existente(s)${impRows.length - ok.length ? `, <span class="pill danger">${impRows.length - ok.length} con error (se omiten)</span>` : ''}.`);
  const b = $('impSaveBtn'); if (b) b.disabled = !ok.length;
}
function closeInvImport() { closeModal('invImportModal'); impRows = []; }
async function confirmInventoryImport() {
  const ok = impRows.filter(r => !r.errs.length);
  if (!ok.length) return toast('⚠ No hay filas válidas para guardar');
  let nuevos = 0, existentes = 0, unidades = 0;
  try {
    for (const r of ok) {
      let catId = null;
      const catName = String(r.categoria || '').trim().toUpperCase();
      if (catName) {
        let c = CATS.find(x => x.name === catName);
        if (!c) { c = await api('/api/admin/categories', { method: 'POST', body: { name: catName } }); CATS.push(c); }
        catId = c.id;
      }
      if (r.estado === 'nuevo') {
        await api('/api/admin/products', { method: 'POST', body: { name: r.nombre.trim(), code: r.codigo || null, category_id: catId, cost: r.costo, shipping_cost: r.envio, price: r.precio, stock: r.cantidad, min_stock: 1, purchase_date: r.fecha || today() } });
        nuevos++; unidades += r.cantidad;
      } else {
        const p = PRODUCTS.find(x => x.name === r.nombre);
        if (!p) continue;
        await api('/api/admin/products/' + p.id, { method: 'PUT', body: { name: p.name, code: p.code, category_id: catId || p.category_id, cost: r.costo, shipping_cost: r.envio, price: Number(p.price), stock: p.stock, min_stock: p.min_stock, purchase_date: r.fecha || p.purchase_date } });
        await api('/api/admin/products/' + p.id + '/stock', { method: 'POST', body: { qty: r.cantidad, fecha: r.fecha || today() } });
        existentes++; unidades += r.cantidad;
      }
    }
    closeInvImport();
    toast(`✔ Inventario actualizado: ${nuevos} nuevo(s), ${existentes} existente(s), ${unidades} unidades`);
    await fetchCaches(); renderInventory();
  } catch (e) { toast('⚠ ' + e.message); }
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
  el.innerHTML = '<div class="hbars">' + list.map(it => `<div class="row"><span class="lbl" title="${esc(it.label)}">${esc(it.label)}</span><span class="bar"><b style="width:${(it.value / mx * 100).toFixed(1)}%;background:${it.color || CH_COLORS[0]}"></b></span><span class="val">${esc(it.extra ? it.extra + ' · ' : '')}${esc(full(it.value))}</span></div>`).join('') + '</div>';
}
const mesLabel = k => MES_CORTO[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(2, 4);
function monthKeysBack(n, endKey) { let y = Number(endKey.slice(0, 4)), m = Number(endKey.slice(5, 7)), out = []; for (let i = 0; i < n; i++) { out.unshift(y + '-' + String(m).padStart(2, '0')); m--; if (m < 1) { m = 12; y--; } } return out; }

/* ---------- Utilidad: periodos y bases ---------- */
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
function monthSold(key) { const rows = salesLines().filter(r => String(r.fecha).slice(0, 7) === key); return { ventas: rows.reduce((a, r) => a + r.venta, 0), costo: rows.reduce((a, r) => a + r.costo, 0) }; }
function monthProfit(key) { const s = monthSold(key); return s.ventas - s.costo; }
function monthMargin(key) { const s = monthSold(key); return s.ventas > 0 ? (s.ventas - s.costo) / s.ventas : 0; }
function monthCollected(key) { const p = (ANALYTICS && ANALYTICS.paysMonth || []).find(x => x.month === key); return p ? Number(p.amount) : 0; }
function monthUtilBase(key, base) { return base === 'cobrado' ? monthCollected(key) * monthMargin(key) : monthProfit(key); }

/* ---------- Impuesto de renta ---------- */
const UVT_2027_ESTIMADA = 55668;
const TAX_TABLE = [[0, 1090, 0, 0], [1090, 1700, 0.19, 0], [1700, 4100, 0.28, 116], [4100, 8670, 0.33, 788], [8670, 18970, 0.35, 2296], [18970, 31000, 0.37, 5901], [31000, Infinity, 0.39, 10352]];
const incomeTaxUvt = b => { const r = TAX_TABLE.find(x => b > x[0] && b <= x[1]); return r ? (b - r[0]) * r[2] + r[3] : 0; };
function taxCfg() { try { return JSON.parse(localStorage.getItem('taxCfg') || 'null') || { uvt: UVT_2027_ESTIMADA, gastos: {} }; } catch (e) { return { uvt: UVT_2027_ESTIMADA, gastos: {} }; } }
function computeTax(year) {
  const c = taxCfg();
  const uvt = Number(c.uvt) || UVT_2027_ESTIMADA, gastos = Number((c.gastos || {})[year]) || 0;
  const rows = salesLines().filter(r => String(r.fecha).slice(0, 4) === String(year));
  const ingresos = rows.reduce((a, r) => a + r.venta, 0), util = ingresos - rows.reduce((a, r) => a + r.costo, 0);
  const base = Math.max(0, util - gastos), baseUvt = base / uvt, imp = Math.round(incomeTaxUvt(baseUvt) * uvt);
  return { ingresos, util, base, baseUvt, imp, efectiva: util > 0 ? imp / util : 0 };
}
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
  const t = computeTax(y);
  $('tIngresos').textContent = money(t.ingresos); $('tUtil').textContent = money(t.util); $('tBase').textContent = money(t.base);
  $('tUvt').textContent = t.baseUvt.toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' UVT';
  $('tImpuesto').textContent = money(t.imp);
  $('tEfectiva').textContent = t.base > 0 ? (t.imp / t.base * 100).toFixed(1) + '%' : '0%';
  const tope = 1400 * (Number(c.uvt) || UVT_2027_ESTIMADA);
  const pct = tope > 0 ? Math.min(100, t.ingresos / tope * 100) : 0;
  put('chTax', `<div class="hbars"><div class="row" style="grid-template-columns:1fr"><span class="bar" style="height:18px"><b style="width:${pct.toFixed(1)}%;background:${t.ingresos >= tope ? CH_COLORS[3] : CH_COLORS[0]}"></b></span></div></div><div class="note" style="margin-top:6px">${esc(money(t.ingresos))} de ${esc(money(tope))} (${pct.toFixed(0)}%) del tope de 1.400 UVT</div>`);
  const el = $('taxObligation');
  if (el) el.textContent = t.ingresos >= tope
    ? `⚠ Tus ingresos brutos del año (${money(t.ingresos)}) superan 1.400 UVT (${money(tope)}): probablemente estás obligado a declarar renta.`
    : `Tus ingresos brutos del año no superan 1.400 UVT (${money(tope)}). Aun así, podrías estar obligado a declarar por patrimonio, consumos con tarjeta, compras o consignaciones.`;
}

/* ---------- Dashboard ---------- */
async function loadDash() {
  const [d, an, goals, dons, logis, clients, orders] = await Promise.all([
    api('/api/admin/dashboard'), api('/api/admin/analytics'), api('/api/admin/goals'),
    api('/api/admin/donations'), api('/api/admin/logistics'), api('/api/admin/clients'), api('/api/admin/orders'),
  ]);
  ANALYTICS = an; GOALS = goals; DONATIONS = dons; LOGIS = logis; CLIENTS = clients; ORDERS = orders;
  if (!CFG) CFG = await api('/api/admin/settings');
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('mVentas', money(d.ventas)); set('mAbonos', money(d.abonos)); set('mSaldo', money(d.saldo));
  set('mAbiertos', d.abiertos); set('mStock', d.stockBajo);
  renderSummary(); renderResumenCharts();
  renderUtilidad();
  renderProfitBox(); renderGoalsBox(); renderInventoryValue();
  renderLogisDash(); fillDashboardClients(); renderClientOrders(); renderRecent(); renderLow();
}
function renderSummary() {
  const box = $('dashSummary'); if (!box) return;
  const pc = profitConfig();
  const base = $('sumBase') ? $('sumBase').value : 'cobrado';
  const nowK = today().slice(0, 7), prevK = monthKeysBack(2, nowK)[0];
  const utilOf = k => monthUtilBase(k, base);
  const rate = y => computeTax(y).efectiva;
  const libreOf = k => { const u = utilOf(k); return u - u * pc.diezmoPct / 100 - u * pc.ofrendaPct / 100 - (pc.reinvEnabled ? u * pc.reinvPct / 100 : 0) - u * rate(k.slice(0, 4)); };
  const utilM = utilOf(nowK), utilP = utilOf(prevK);
  const diez = utilM * pc.diezmoPct / 100, ofr = utilM * pc.ofrendaPct / 100;
  const reinvS = pc.reinvEnabled ? utilM * pc.reinvPct / 100 : 0;
  const impM = utilM * rate(nowK.slice(0, 4));
  const libre = libreOf(nowK);
  const act = GOALS.filter(g => g.active);
  const topGoal = act.map(g => ({ ...g, pct: g.target > 0 ? Math.min(100, g.contributed / g.target * 100) : 0 })).sort((a, b) => b.pct - a.pct)[0];
  const delta = utilP !== 0 ? ((utilM - utilP) / Math.abs(utilP) * 100) : null;
  const y = nowK.slice(0, 4);
  const utilY = monthKeysBack(12, y + '-12').reduce((a, k) => a + utilOf(k), 0);
  const dyCalc = utilY * pc.diezmoPct / 100, ofCalc = utilY * pc.ofrendaPct / 100;
  const entregado = DONATIONS.filter(d => String(d.donation_date || '').slice(0, 4) === y).reduce((a, d) => a + d.amount, 0);
  const keys = monthKeysBack(6, nowK);
  box.innerHTML = `
<div class="note" style="margin-bottom:8px">Resumen ${MONTHS_ES[Number(nowK.slice(5, 7)) - 1]} ${y} · base: <b>${base === 'cobrado' ? 'lo cobrado' : 'lo vendido'}</b></div>
<div class="grid cards3">
  <div class="card"><div class="label">Utilidad neta del mes</div><div class="metric">${money(utilM)}</div>
    <div class="note">${delta === null ? 'Sin mes anterior para comparar' : (delta >= 0 ? '▲ ' : '▼ ') + Math.abs(delta).toFixed(1) + '% vs mes anterior (' + money(utilP) + ')'}</div></div>
  <div class="card"><div class="label">Libre del mes</div><div class="metric">${money(libre)}</div>
    <div class="note">después de diezmo, ofrenda, impuesto y reinversión</div></div>
  <div class="card"><div class="label">Objetivos</div><div class="metric">${topGoal ? topGoal.pct.toFixed(0) + '%' : 'Sin objetivos'}</div>
    <div class="note">${act.length} activo(s) · ${GOALS.filter(g => g.target > 0 && g.contributed >= g.target).length} cumplido(s)</div></div>
  <div class="card"><div class="label">Diezmo y ofrenda del año</div><div class="metric">${money(entregado)} entregado</div>
    <div class="note">calculado ${money(dyCalc + ofCalc)} · pendiente ${money(Math.max(0, dyCalc + ofCalc - entregado))}</div></div>
  <div class="card"><div class="label">Reinversión sugerida</div><div class="metric">${pc.reinvEnabled ? money(reinvS) : 'Desactivada'}</div>
    <div class="note">listo para reponer inventario top</div></div>
</div>
<div class="grid dashboard-grid" style="margin-top:14px">
  <div class="panel"><h2>Utilidad neta y libre (6 meses)</h2><div id="chUtilNetaLibre"></div></div>
  <div class="panel"><h2>Reparto de la utilidad del mes</h2><div id="chReparto"></div></div>
</div>
<div class="grid dashboard-grid" style="margin-top:14px">
  <div class="panel"><h2>Cumplimiento de objetivos</h2><div id="sumGoals"></div></div>
  <div class="panel"><h2>Reinversión: sugerida vs real</h2><div id="sumReinv"></div></div>
</div>`;
  chartBars('chUtilNetaLibre', keys.map(mesLabel), [
    { name: 'Utilidad neta', values: keys.map(utilOf), color: CH_COLORS[0] },
    { name: 'Libre', values: keys.map(libreOf), color: CH_COLORS[1] },
  ], { label: 'Utilidad neta y libre por mes' });
  chartDonut('chReparto', [
    { label: 'Libre', value: Math.max(0, libre), color: CH_COLORS[0] },
    { label: 'Diezmo', value: diez, color: CH_COLORS[6] },
    { label: 'Ofrenda', value: ofr, color: CH_COLORS[2] },
    { label: 'Impuesto estimado', value: impM, color: CH_COLORS[3] },
    { label: 'Reinversión', value: reinvS, color: CH_COLORS[1] },
  ], { label: 'Reparto de la utilidad del mes' });
  const actG = GOALS.filter(g => g.active);
  if (actG.length) chartHBars('sumGoals', actG.map(g => ({ label: g.name, value: g.contributed, extra: (g.target > 0 ? Math.min(100, g.contributed / g.target * 100).toFixed(0) + '%' : '') })), { full: money });
  else put('sumGoals', '<div class="empty">Sin objetivos activos. Créalos en Configuración.</div>');
  chartBars('sumReinv', keys.map(mesLabel), [
    { name: 'Reinversión sugerida', values: keys.map(k => monthUtilBase(k, base) * pc.reinvPct / 100), color: CH_COLORS[0] },
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
  const set = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  set('utilRange', 'Periodo: ' + per.label);
  set('uVentas', money(ventas)); set('uCosto', money(costo)); set('uUtil', money(util));
  const um = $('uUtil'); if (um) um.style.color = util < 0 ? 'var(--danger)' : '';
  set('uMargen', ventas > 0 ? (util / ventas * 100).toFixed(1) + '%' : '0%');
  const by = {}; rows.forEach(r => { const o = by[r.producto] || (by[r.producto] = { producto: r.producto, qty: 0, venta: 0, costo: 0 }); o.qty += r.qty; o.venta += r.venta; o.costo += r.costo; });
  const top = Object.values(by).map(o => ({ ...o, util: o.venta - o.costo })).sort((a, b) => b.util - a.util).slice(0, 10);
  renderUtilChart(rows, per);
  put('utilTop', top.length ? `<div class="tablewrap"><table class="adm"><thead><tr><th>Producto (top 10 por utilidad)</th><th>Unid.</th><th>Ventas</th><th>Costo</th><th>Utilidad</th></tr></thead><tbody>${top.map(o => `<tr><td>${esc(o.producto)}</td><td>${o.qty}</td><td>${money(o.venta)}</td><td>${money(o.costo)}</td><td>${money(o.util)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No hay ventas en este periodo.</div>');
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
  const set = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  set('invMes', money(inMonth.reduce((a, p) => a + (Number(p.stock) || 0) * ((Number(p.cost) || 0) + (Number(p.shipping_cost) || 0)), 0)));
  set('invUnid', inMonth.reduce((a, p) => a + (Number(p.stock) || 0), 0).toLocaleString('es-CO'));
  set('invCompras', inMonth.length);
  set('invVentas', money(salesLines().filter(r => String(r.fecha).slice(0, 7) === key).reduce((a, r) => a + r.venta, 0)));
  const keys = Array.from({ length: 12 }, (_, i) => y + '-' + String(i + 1).padStart(2, '0'));
  chartBars('chInv', keys.map(mesLabel), [
    { name: 'Inversión (inventario ingresado)', values: keys.map(k => investmentOf(k)), color: CH_COLORS[3] },
    { name: 'Ventas', values: keys.map(k => salesLines().filter(r => String(r.fecha).slice(0, 7) === k).reduce((a, r) => a + r.venta, 0)), color: CH_COLORS[0] },
  ], { label: 'Inversión y ventas por mes del año ' + y });
}
function renderProfitBox() {
  const el = $('profitBox'); if (!el) return;
  const pc = profitConfig(), y = String(new Date().getFullYear());
  const utilY = monthKeysBack(12, y + '-12').reduce((a, k) => a + monthProfit(k), 0);
  const diez = utilY * pc.diezmoPct / 100, ofr = utilY * pc.ofrendaPct / 100;
  const reinvS = utilY * pc.reinvPct / 100;
  const reinvR = monthKeysBack(12, y + '-12').reduce((a, k) => a + investmentOf(k), 0);
  el.innerHTML = `
<div class="grid cards3">
  <div class="card"><div class="label">Diezmo (${pc.diezmoPct}% utilidad ${y})</div><div class="metric">${money(diez)}</div></div>
  <div class="card"><div class="label">Ofrenda (${pc.ofrendaPct}% utilidad ${y})</div><div class="metric">${money(ofr)}</div></div>
  <div class="card"><div class="label">Reinversión sugerida (${pc.reinvPct}%)</div><div class="metric">${pc.reinvEnabled ? money(reinvS) : 'Desactivada'}</div>
    <div class="note">real invertido: ${money(reinvR)}</div></div>
</div>
<div class="note" style="margin-top:8px">Utilidad ${y}: <b>${money(utilY)}</b>. Edita porcentajes en el menú 👑 → Configuración.</div>`;
}
function renderGoalsBox() {
  const el = $('goalsBox'); if (!el) return;
  const act = GOALS.filter(g => g.active);
  const done = GOALS.filter(g => g.target > 0 && g.contributed >= g.target).length;
  el.innerHTML = GOALS.length ? `<div class="note" style="margin-bottom:8px">${act.length} activo(s) · ${done} cumplido(s)</div>` +
    GOALS.map(g => { const pct = g.target > 0 ? Math.min(100, g.contributed / g.target * 100) : 0; return `<div class="hbars"><div class="row"><span class="lbl" title="${esc(g.name)}">${esc(g.name)}${g.active ? '' : ' (inactivo)'}</span><span class="bar"><b style="width:${pct.toFixed(1)}%;background:${pct >= 100 ? 'var(--ok)' : CH_COLORS[0]}"></b></span><span class="val">${pct.toFixed(0)}% · ${money(g.contributed)} / ${money(g.target)}</span></div></div>`; }).join('')
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
function renderInventoryValue() {
  const inv = ANALYTICS.inventory;
  const set = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  set('mInvTotal', money(inv.totalCosto)); set('mInvEnvio', money(inv.totalEnvio));
  set('mInv90', money(inv.over90)); set('mInv90Pct', inv.over90Pct.toFixed(1) + '%');
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
  const cp = $('catPeriod'); if (cp) cp.textContent = 'Ventas del periodo: ' + per.label + ' (se cambia en "Utilidad bruta"). Inventario: valor actual.';
  $('catHead').innerHTML = '<tr><th>Categoría</th><th>Monto en inventario</th><th>% inventario</th><th>Monto vendido</th><th>% ventas</th></tr>';
  $('catBody').innerHTML = list.length ? list.map(r => `<tr><td>${esc(r.cat)}</td><td>${money(r.inv)}</td><td>${r.invPct.toFixed(1)}%</td><td>${money(r.ven)}</td><td>${r.venPct.toFixed(1)}%</td></tr>`).join('') + `<tr style="font-weight:800"><td>Total</td><td>${money(totI)}</td><td>${totI > 0 ? '100.0%' : '0.0%'}</td><td>${money(totV)}</td><td>${totV > 0 ? '100.0%' : '0.0%'}</td></tr>` : '<tr><td colspan="5" class="empty">Sin categorías.</td></tr>';
  chartDonut('chCatInv', list.map(r => ({ label: r.cat, value: r.inv })), { label: 'Participación en inventario' });
  chartDonut('chCatVen', list.map(r => ({ label: r.cat, value: r.ven })), { label: 'Participación en ventas' });
}
function renderLogisDash() {
  const el = $('dashLogis'); if (!el) return;
  const pend = LOGIS.filter(s => s.status !== 'enviado'), sent = LOGIS.filter(s => s.status === 'enviado');
  el.innerHTML = `<div class="grid cards3"><div class="card"><div class="label">Por enviar</div><div class="metric">${pend.length}</div></div><div class="card"><div class="label">Enviados</div><div class="metric">${sent.length}</div></div></div>` +
    (pend.length ? '<div class="tablewrap" style="margin-top:10px"><table class="adm"><thead><tr><th>Pedido</th><th>Cliente</th><th>Estado</th><th></th></tr></thead><tbody>' + pend.slice(0, 5).map(s => `<tr><td><b>${esc(s.order_number)}</b></td><td>${esc(s.client_name || '')}</td><td>${s.status === 'guardado' ? '<span class="pill warn">Guardado</span>' : '<span class="pill">Por enviar</span>'}</td><td class="acts"><button class="btn primary" onclick="openShip('${s.id}')">Preparar envío</button></td></tr>`).join('') + '</tbody></table></div>' : '');
}
function fillDashboardClients() {
  const s = $('dashboardClient'); if (!s) return;
  const cur = s.value;
  s.innerHTML = '<option value="">Seleccionar cliente…</option>' + [...CLIENTS].sort((a, b) => a.name.localeCompare(b.name, 'es')).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if (CLIENTS.some(c => c.id === cur)) s.value = cur;
}
function renderClientsChart() {
  const by = {}; ORDERS.filter(o => o.status !== 'canceled').forEach(o => { const k = o.client_name || 'Sin cliente'; by[k] = (by[k] || 0) + o.total; });
  const top = Object.entries(by).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 10);
  if (!top.length) { put('chClients', emptyChart); return; }
  put('chClients', '<h3 style="margin:0 0 8px">Top 10 clientes por ventas</h3><div id="chClientsTop"></div>');
  chartHBars('chClientsTop', top);
}
function renderClientOrders() {
  const box = $('clientOrders'); if (!box) return;
  const cid = $('dashboardClient') ? $('dashboardClient').value : '';
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
  put('recentOrders', last.length ? `<div class="tablewrap"><table class="adm"><thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Saldo</th></tr></thead><tbody>${last.map(o => `<tr><td>${esc(o.order_number)}</td><td>${String(o.created_at || '').slice(0, 10)}</td><td>${esc(o.client_name || '—')}</td><td>${money(o.total)}</td><td>${money(o.balance)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No hay pedidos.</div>');
}
function renderLow() {
  const low = (ANALYTICS.stockRows || []).filter(x => x.status !== 'EN STOCK');
  if (!low.length) put('chLow', emptyChart);
  else {
    const mx = Math.max(1, ...low.map(x => Math.max(0, x.available)));
    put('chLow', '<div class="hbars">' + low.slice(0, 12).map(x => `<div class="row"><span class="lbl" title="${esc(x.name)}">${esc(x.name)}</span><span class="bar"><b style="width:${(Math.max(0, x.available) / mx * 100).toFixed(1)}%;background:${x.available <= 0 ? CH_COLORS[3] : CH_COLORS[1]}"></b></span><span class="val">${Math.max(0, x.available)} u.</span></div>`).join('') + '</div>');
  }
  put('lowStock', low.length ? low.map(p => `<div class="statusbar"><span>${esc(p.name)}</span>${pillStock(p.status)} <b>${Math.max(0, p.available)}</b></div>`).join('') : '<div class="empty">No hay productos con stock bajo.</div>');
}

/* ---------- Abonos por confirmar ---------- */
async function loadReports() {
  const rows = await api('/api/orders/reports/pending');
  put('reports', rows.length ?
    '<div class="tablewrap"><table class="adm"><thead><tr><th>Bolsita</th><th>Cliente</th><th>WhatsApp</th><th>Abono</th><th>Reportado</th><th>Acciones</th></tr></thead><tbody>' +
    rows.map(r => `<tr><td><b>${esc(r.order_number)}</b></td><td>${esc(r.client_name || '')}</td><td>${esc(r.client_whatsapp || '')}</td><td><b>${money(r.amount)}</b></td><td>${new Date(r.reported_at).toLocaleString('es-CO')}</td><td class="acts"><button class="btn primary" onclick="resolveReport('${r.id}','approve')">Aprobar</button><button class="btn danger" onclick="resolveReport('${r.id}','reject')">Rechazar</button></td></tr>`).join('') +
    '</tbody></table></div>' : '<p class="note">No hay abonos pendientes por confirmar. ✔</p>');
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
  const q = ($('invSearch') ? $('invSearch').value : '').toLowerCase(), f = $('invFilter') ? $('invFilter').value : '';
  const list = PRODUCTS.filter(p => (!q || p.name.toLowerCase().includes(q) || String(p.code || '').includes(q)) && (!f || p.status === f));
  put('invTable', '<div class="tablewrap"><table class="adm"><thead><tr><th>Producto</th><th>Código</th><th>Categoría</th><th>Costo</th><th>Envío</th><th>Stock</th><th>Disponible</th><th>Estado</th><th>Precio</th><th>Margen</th><th>Fecha compra</th><th>Acciones</th></tr></thead><tbody>' +
    (list.length ? list.map(p => {
      const marg = p.price > 0 ? (((Number(p.price) - Number(p.cost) - Number(p.shipping_cost)) / Number(p.price)) * 100).toFixed(1) + '%' : '—';
      return `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.code || '—')}</td><td>${esc(p.category || '—')}</td><td>${money(p.cost)}</td><td>${money(p.shipping_cost)}</td><td>${p.stock}</td><td>${p.available}</td><td>${pillStock(p.status)}</td><td>${money(p.price)}</td><td>${marg}</td><td>${esc(p.purchase_date || '—')}</td><td class="acts"><button class="btn" onclick="openStock('${p.id}')">+ Stock</button><button class="btn" onclick="openProduct('${p.id}')">Editar</button><button class="btn danger" onclick="delProduct('${p.id}')">Eliminar</button></td></tr>`;
    }).join('') : '<tr><td colspan="12" class="empty">Sin productos.</td></tr>') + '</tbody></table></div>');
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
  put('kitsTable', KITS.length ? '<div class="tablewrap"><table class="adm"><thead><tr><th>Kit</th><th>Componentes</th><th>Precio</th><th>Disponibles</th><th>Acciones</th></tr></thead><tbody>' +
    KITS.map(k => `<tr><td><b>🎁 ${esc(k.name)}</b></td><td>${(k.components || []).map(c => c.quantity + '× ' + esc(c.product_name)).join(' · ')}</td><td>${money(k.price)}</td><td>${k.available}</td><td class="acts"><button class="btn" onclick="openKit('${k.id}')">Editar</button><button class="btn danger" onclick="delKitDirect('${k.id}')">Eliminar</button></td></tr>`).join('') +
    '</tbody></table></div>' : '<p class="note">Aún no hay kits.</p>');
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
  tr.innerHTML = `<td><select class="kcProd">${PRODUCTS.map(p => `<option value="${p.id}" ${p.id === productId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td><td style="width:110px"><input class="kcQty" type="number" min="1" value="${qty || 1}"></td><td style="width:40px"><button class="btn danger" onclick="this.closest('tr').remove()">✕</button></td>`;
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
  put('catsBox', CATS.length ? '<div class="tablewrap"><table class="adm"><thead><tr><th>Categoría</th><th>Acciones</th></tr></thead><tbody>' +
    CATS.map(c => `<tr><td><b>${esc(c.name)}</b></td><td class="acts"><button class="btn" onclick="renameCategory('${c.id}')">Renombrar</button><button class="btn danger" onclick="delCategory('${c.id}')">Eliminar</button></td></tr>`).join('') +
    '</tbody></table></div>' : '<p class="note">Sin categorías.</p>');
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
  const q = ($('cliSearch') ? $('cliSearch').value : '').toLowerCase();
  const list = CLIENTS.filter(c => !q || (c.name + ' ' + (c.whatsapp || '')).toLowerCase().includes(q));
  put('clientsTable', '<div class="tablewrap"><table class="adm"><thead><tr><th>Cliente</th><th>WhatsApp</th><th>Ciudad</th><th>Dirección</th><th>Estado</th><th>Pedidos</th><th>Total</th><th>Abonado</th><th>Saldo</th><th>Acciones</th></tr></thead><tbody>' +
    (list.length ? list.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.whatsapp || '—')}</td><td>${esc(c.city || '—')}</td><td>${esc(c.address || '—')}</td><td>${c.status === 'Activo' ? '<span class="pill ok">Activo</span>' : '<span class="pill danger">Inactivo</span>'}</td><td>${c.orders}</td><td>${money(c.total)}</td><td>${money(c.paid)}</td><td>${money(c.balance)}</td><td class="acts"><button class="btn" onclick="openClient('${c.id}')">Editar</button></td></tr>`).join('') : '<tr><td colspan="10" class="empty">Sin clientes.</td></tr>') + '</tbody></table></div>');
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
  put('ordersTable', rows.length ? '<div class="tablewrap"><table class="adm"><thead><tr><th>N.º</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th>Ítems</th><th>Total</th><th>Abonado</th><th>Saldo</th><th>Acciones</th></tr></thead><tbody>' +
    rows.map(o => `<tr><td><b>${esc(o.order_number)}</b></td><td>${esc(o.client_name || '—')}</td><td>${String(o.created_at || '').slice(0, 10)}</td><td>${pill(o.status)}</td><td>${o.items_count}</td><td>${money(o.total)}</td><td>${money(o.paid)}</td><td>${money(o.balance)}</td><td class="acts"><button class="btn primary" onclick="openOrder('${o.id}')">Abrir</button></td></tr>`).join('') +
    '</tbody></table></div>' : '<p class="note">No hay pedidos con ese filtro.</p>');
}
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
  <div class="field"><label>Fecha</label><input id="omPayDate" type="date" value="${today()}"></div>
  <div class="field"><label>&nbsp;</label><button class="btn primary" onclick="addOrderPayment('${o.id}')">Registrar abono</button></div>
</div>`;
}
function omAddRow(focus) {
  const tb = $('omRows'); if (!tb) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><select class="omProd" onkeydown="omKey(event)"><option value="">Seleccionar…</option>${optGroups()}</select></td>
  <td style="width:90px"><input class="omQty" type="number" min="1" value="1" onkeydown="omKey(event)"></td>
  <td style="width:120px"><input class="omPrice" type="number" min="0" value="0" onkeydown="omKey(event)" title="Precio (se llena al elegir; editable)"></td>
  <td class="acts"><button class="btn primary" onclick="omCommit(this.closest('tr'))">Agregar</button> <button class="btn danger" onclick="this.closest('tr').remove()">✕</button></td>`;
  tb.appendChild(tr);
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
    await api('/api/admin/orders/' + orderId + '/payments', { method: 'POST', body: { amount, method: $('pMethod').value, reference: $('pRef').value.trim(), payment_date: $('omPayDate').value || null } });
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
  put('logisPending', pend.length ? '<div class="tablewrap"><table class="adm"><thead><tr><th>Pedido</th><th>Cliente</th><th>Ciudad</th><th>Estado</th><th>Pago</th><th>Transportadora</th><th>Monto</th><th>Acciones</th></tr></thead><tbody>' +
    pend.map(s => `<tr><td><b>${esc(s.order_number)}</b></td><td>${esc(s.client_name || '')}</td><td>${esc(s.city || '—')}</td><td>${s.status === 'guardado' ? '<span class="pill warn">Guardado</span>' : '<span class="pill">Por enviar</span>'}</td><td>${s.pay_mode === 'adelantado' ? 'Adelantado' : 'Por cobrar'}</td><td>${esc(s.carrier)}${s.carrier_other ? ' (' + esc(s.carrier_other) + ')' : ''}</td><td>${money(s.amount)}</td><td class="acts"><button class="btn primary" onclick="openShip('${s.id}')">Preparar envío</button><button class="btn" onclick="openOrder('${s.order_id}')">Ver pedido</button></td></tr>`).join('') + '</tbody></table></div>'
    : '<p class="note">No hay pedidos por enviar. Los pedidos que pasan a Pagado entran aquí automáticamente.</p>');
  put('logisSent', sent.length ? '<div class="tablewrap"><table class="adm"><thead><tr><th>Pedido</th><th>Cliente</th><th>Enviado</th><th>Transportadora</th><th>Pago</th><th>Monto</th><th>Dirección de envío</th></tr></thead><tbody>' +
    sent.map(s => `<tr><td><b>${esc(s.order_number)}</b></td><td>${esc(s.client_name || '')}</td><td>${String(s.shipped_at || '').slice(0, 10)}</td><td>${esc(s.carrier)}${s.carrier_other ? ' (' + esc(s.carrier_other) + ')' : ''}</td><td>${s.pay_mode === 'adelantado' ? 'Adelantado' : 'Por cobrar'}</td><td>${money(s.amount)}</td><td>${esc(s.city || '')} — ${esc(s.address || '')}</td></tr>`).join('') + '</tbody></table></div>'
    : '<p class="note">Aún no hay envíos registrados.</p>');
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
  const set = (id, v) => { const el = $(id); if (el) el.value = v; };
  set('iEmpresa', ic.empresa || ''); set('iNit', ic.nit || ''); set('iTel', ic.telefono || '');
  set('iEmail', ic.email || ''); set('iDir', ic.direccion || ''); set('iMsg', ic.mensaje || '');
  set('iFontTitulos', ic.fontTitulos || 'Arial'); set('iFontCuerpo', ic.fontCuerpo || 'Arial');
  logoData = ic.logo || null; wmData = ic.watermark || null; wmW = ic.watermarkW || 0; wmH = ic.watermarkH || 0;
  const lp = $('iLogoPrev'); if (lp) { lp.src = logoData || ''; lp.style.display = logoData ? 'inline-block' : 'none'; }
  const wp = $('iWmPrev'); if (wp) { wp.src = wmData || ''; wp.style.display = wmData ? 'inline-block' : 'none'; }
  set('gBreb', CFG.bre_b_key || ''); set('gWa', CFG.whatsapp_number || ''); set('gTpl', CFG.whatsapp_template || '');
  set('gPrefix', CFG.order_prefix || ''); set('gStart', CFG.order_start || 1); set('gDigits', CFG.order_digits || 5);
  set('gMin', CFG.min_payment_amount || 0);
  const pc = profitConfig();
  set('gDiezmo', pc.diezmoPct); set('gOfrenda', pc.ofrendaPct);
  set('gReinv', pc.reinvEnabled ? '1' : '0'); set('gReinvPct', pc.reinvPct);
  set('uiThemeSel', localStorage.getItem('uiTheme') || 'light');
  set('uiLayoutSel', localStorage.getItem('uiLayout') || 'top');
  renderGoalsCfg(); renderDonations();
}
async function saveProfitCfg() {
  const pc = {
    diezmoPct: Math.max(0, Math.min(100, Number($('gDiezmo').value) || 0)),
    ofrendaPct: Math.max(0, Math.min(100, Number($('gOfrenda').value) || 0)),
    reinvEnabled: $('gReinv').value === '1',
    reinvPct: Math.max(0, Math.min(100, Number($('gReinvPct').value) || 0)),
  };
  try { await api('/api/admin/settings', { method: 'PUT', body: { profit_config: pc } }); CFG.profit_config = pc; toast('✔ Utilidad configurada'); renderSummary(); }
  catch (e) { toast('⚠ ' + e.message); }
}
function renderGoalsCfg() {
  put('goalsCfg', GOALS.length ? '<div class="tablewrap"><table class="adm"><thead><tr><th>Objetivo</th><th>Meta</th><th>Aportado</th><th>Activo</th><th>Acciones</th></tr></thead><tbody>' +
    GOALS.map(g => `<tr><td><b>${esc(g.name)}</b></td><td>${money(g.target)}</td><td>${money(g.contributed)}</td><td>${g.active ? '<span class="pill ok">Sí</span>' : '<span class="pill">No</span>'}</td><td class="acts"><button class="btn" onclick="toggleGoal('${g.id}',${!g.active})">${g.active ? 'Inactivar' : 'Activar'}</button><button class="btn" onclick="editGoal('${g.id}')">Editar</button><button class="btn danger" onclick="delGoal('${g.id}')">Eliminar</button></td></tr>`).join('') + '</tbody></table></div>'
    : '<p class="note">Sin objetivos aún (máximo 3).</p>');
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
  put('donList', DONATIONS.length ? '<div class="tablewrap"><table class="adm"><thead><tr><th>Fecha</th><th>Entidad</th><th>Valor</th><th>Certificado</th><th>Nota</th><th></th></tr></thead><tbody>' +
    DONATIONS.map(d => `<tr><td>${esc(d.donation_date)}</td><td><b>${esc(d.entity)}</b></td><td>${money(d.amount)}</td><td>${esc(d.certificate || '—')}</td><td>${esc(d.note || '')}</td><td class="acts"><button class="btn danger" onclick="delDonation('${d.id}')">Eliminar</button></td></tr>`).join('') + '</tbody></table></div>'
    : '<p class="note">Sin donaciones certificadas registradas.</p>');
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

/* =====================================================================
   PANDALA · BORRADO TOTAL DE LA TIENDA (ZONA DE PELIGRO)
   ===================================================================== */
function openWipeModal() {
  const txt = $('wipeConfirmText');
  if (txt) txt.value = '';
  const err = $('wipeErr');
  if (err) err.textContent = '';
  const btn = $('wipeExecuteBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Borrar todo permanentemente'; }
  openModal('wipeModal');
}
const wipeInput = $('wipeConfirmText');
if (wipeInput) {
  wipeInput.addEventListener('input', function () {
    const btn = $('wipeExecuteBtn');
    if (btn) btn.disabled = this.value.trim() !== 'Estoy seguro de hacer el borrado';
  });
}
async function executeWipe() {
  const txt = $('wipeConfirmText');
  const btn = $('wipeExecuteBtn');
  const err = $('wipeErr');
  if (!txt || txt.value.trim() !== 'Estoy seguro de hacer el borrado') return;
  btn.disabled = true;
  btn.textContent = 'Borrando... (no cierres esta pestaña)';
  err.textContent = '';
  try {
    await api('/api/admin/wipe', { method: 'POST', body: { confirmText: txt.value.trim() } });
    closeModal('wipeModal');
    toast('✔ Tienda borrada exitosamente. Recargando...');
    localStorage.removeItem('pk_seen');
    setTimeout(() => location.reload(), 1500);
  } catch (e) {
    err.textContent = e.message || 'Error al borrar';
    btn.disabled = false;
    btn.textContent = 'Borrar todo permanentemente';
  }
}

/* =====================================================================
   PANDALA KAWAI · NAVEGACIÓN RESPONSIVE (celular / tablet)
   ===================================================================== */
(function () {
  'use strict';
  var MQ = window.matchMedia('(max-width: 1024px)');
  function isMobile() { return MQ.matches; }
  var ICONS = { dash: '📊', abonos: '💰', inv: '📦', kits: '🎁', cats: '🏷️', clients: '👥', orders: '🧾', logis: '🚚', import: '📥', config: '⚙️', legal: '📜' };
  function injectCss() {
    if (document.getElementById('pkMobileNavCss')) return;
    var s = document.createElement('style');
    s.id = 'pkMobileNavCss';
    s.textContent = [
      '#pkMobileNav{display:none}',
      'body.pk-mobile #hdr{flex-wrap:wrap}',
      'body.pk-mobile #pkMobileNav{display:block;width:100%;flex:1 1 100%;order:99;margin-top:10px}',
      'body.pk-mobile nav#tabs{display:none!important}',
      'body.pk-mobile .layout-btn{display:none!important}',
      'body.pk-mobile .pk-pc-only{display:none!important}',
      '.pk-mnav-shell{position:relative;display:flex;align-items:center;background:var(--card,#fffdf8);border:1.5px solid var(--border,#e8e1d2);border-radius:14px;box-shadow:0 2px 10px rgba(60,40,90,.08);transition:border-color .18s,box-shadow .18s}',
      '.pk-mnav-shell:focus-within{border-color:var(--c1,#7c5cff);box-shadow:0 0 0 3px rgba(124,92,255,.16)}',
      '.pk-mnav-ico{position:absolute;left:14px;font-size:18px;line-height:1;pointer-events:none}',
      '#pkMobileNavSel{-webkit-appearance:none;appearance:none;width:100%;border:0;background:transparent;color:var(--ink,#241f31);font:inherit;font-weight:700;font-size:15px;padding:14px 44px;cursor:pointer;outline:none;text-overflow:ellipsis}',
      '#pkMobileNavSel option{color:#241f31;background:#fffdf8;font-weight:600}',
      '.pk-mnav-chev{position:absolute;right:14px;font-size:13px;color:var(--muted,#8a8398);pointer-events:none;transition:transform .2s}',
      '.pk-mnav-shell:focus-within .pk-mnav-chev{transform:rotate(180deg)}',
      '@media (max-width:430px){#pkMobileNavSel{font-size:14px;padding:13px 40px}.pk-mnav-ico{left:12px}.pk-mnav-chev{right:12px}}'
    ].join('\n');
    document.head.appendChild(s);
  }
  function ensureNav() {
    injectCss();
    var ls = document.getElementById('uiLayoutSel');
    if (ls) { var f = ls.closest('.field') || ls.parentElement; if (f) f.classList.add('pk-pc-only'); }
    if (document.getElementById('pkMobileNav')) return;
    var hdr = document.getElementById('hdr'); if (!hdr) return;
    var wrap = document.createElement('div');
    wrap.id = 'pkMobileNav';
    var opts = TABS.map(function (t) { return '<option value="' + t[0] + '">' + (ICONS[t[0]] || '•') + '  ' + t[1] + '</option>'; }).join('');
    opts += '<option value="config">⚙️  Configuración</option><option value="legal">📜  Legal</option>';
    wrap.innerHTML = '<div class="pk-mnav-shell"><span class="pk-mnav-ico" id="pkMnavIco">📊</span>' +
      '<select id="pkMobileNavSel" aria-label="Menú del panel">' + opts + '</select>' +
      '<span class="pk-mnav-chev">▾</span></div>';
    hdr.appendChild(wrap);
    document.getElementById('pkMobileNavSel').addEventListener('change', function () { showTab(this.value); });
    sync();
  }
  function sync() {
    var sel = document.getElementById('pkMobileNavSel'); if (!sel) return;
    if (sel.value !== currentTab) sel.value = currentTab;
    var ico = document.getElementById('pkMnavIco'); if (ico) ico.textContent = ICONS[currentTab] || '🧭';
  }
  function apply() {
    document.body.classList.toggle('pk-mobile', isMobile());
    var side = !isMobile() && (localStorage.getItem('uiLayout') || 'top') === 'side';
    document.body.classList.toggle('layout-side', side);
    sync();
  }
  var _setLayout = setLayout;
  setLayout = function (mode) { _setLayout(mode); apply(); };
  var _renderTabs = renderTabs;
  renderTabs = function () { _renderTabs(); sync(); };
  var _enterPanel = enterPanel;
  enterPanel = function () { _enterPanel(); ensureNav(); apply(); };
  if (MQ.addEventListener) MQ.addEventListener('change', function () { ensureNav(); apply(); });
  else if (MQ.addListener) MQ.addListener(function () { ensureNav(); apply(); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { ensureNav(); apply(); }, 150); });
  window.addEventListener('resize', (function () { var t; return function () { clearTimeout(t); t = setTimeout(apply, 120); }; })());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();

/* =====================================================================
   PANDALA KAWAI · PERFORMANCE PACK
   ===================================================================== */
(function () {
  'use strict';
  if (window.__pkPerf) return; window.__pkPerf = true;
  var TTL = 30000;
  var NO_CACHE = ['/api/orders/reports/pending'];
  var cache = new Map(), inflight = new Map(), gen = 0;
  var _api = api;
  var bar = document.createElement('div'); bar.id = 'pkLoadBar';
  var st = document.createElement('style');
  st.textContent = '#pkLoadBar{position:fixed;top:0;left:0;height:3px;width:0;z-index:99999;background:linear-gradient(90deg,#7c5cff,#f59e0b,#ff4d8d);box-shadow:0 0 10px rgba(124,92,255,.55);transition:width .25s ease,opacity .35s ease;opacity:0;pointer-events:none}';
  document.head.appendChild(st); document.body.appendChild(bar);
  var active = 0, prog = 0, barTimer = null, slowWarned = false;
  function barStart() {
    active++;
    if (active === 1) {
      prog = 12; bar.style.opacity = '1'; bar.style.width = prog + '%';
      barTimer = setInterval(function () { prog = Math.min(88, prog + (88 - prog) * 0.07); bar.style.width = prog + '%'; }, 280);
    }
  }
  function barEnd() {
    active = Math.max(0, active - 1);
    if (active === 0) {
      clearInterval(barTimer); bar.style.width = '100%';
      setTimeout(function () { bar.style.opacity = '0'; setTimeout(function () { bar.style.width = '0'; }, 380); }, 160);
    }
  }
  api = function (path, opts) {
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      barStart();
      return _api(path, opts).then(function (r) { gen++; cache.clear(); barEnd(); return r; })
        .catch(function (e) { barEnd(); throw e; });
    }
    var cacheable = !NO_CACHE.some(function (p) { return path.indexOf(p) === 0; });
    var k = 'GET ' + path, hit = cache.get(k), now = Date.now();
    if (cacheable && hit && now - hit.t < TTL) return Promise.resolve(hit.data);
    if (inflight.has(k)) return inflight.get(k);
    var g = gen;
    barStart();
    var slowT = setTimeout(function () {
      if (!slowWarned) { slowWarned = true; toast('⏳ El servidor está despertando (plan gratuito). La primera carga puede tardar hasta ~1 minuto.'); }
    }, 8000);
    var p = _api(path, opts).then(function (data) {
      if (cacheable && g === gen) cache.set(k, { t: Date.now(), data: data });
      inflight.delete(k); clearTimeout(slowT); barEnd(); return data;
    }).catch(function (e) { inflight.delete(k); clearTimeout(slowT); barEnd(); throw e; });
    inflight.set(k, p);
    if (cacheable && hit) { p.catch(function () {}); return Promise.resolve(hit.data); }
    return p;
  };
  var _loadConfig = loadConfig;
  loadConfig = function () {
    ['settings', 'goals', 'donations'].forEach(function (r) { api('/api/admin/' + r).catch(function () {}); });
    return _loadConfig();
  };
  var _loadDash = loadDash;
  loadDash = function () { api('/api/admin/settings').catch(function () {}); return _loadDash(); };
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src;
      s.onload = res; s.onerror = function () { rej(new Error('No se pudo cargar la librería PDF')); };
      document.head.appendChild(s);
    });
  }
  function ensurePDF() {
    if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && typeof window.jspdf.jsPDF.API.autoTable === 'function') return Promise.resolve();
    return loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
      .then(function () { return loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'); });
  }
  var _generateInvoice = generateInvoice;
  generateInvoice = function (id) {
    toast('📄 Preparando factura…');
    return ensurePDF().then(function () { return _generateInvoice(id); }).catch(function (e) { toast('⚠ ' + e.message); });
  };
  function ping() { try { fetch('/health', { cache: 'no-store' }).catch(function () {}); } catch (e) {} }
  ping();
  setInterval(ping, 4 * 60 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) ping(); });
})();

/* =====================================================================
   PANDALA KAWAI · DATA RESILIENCE PACK + DIAGNÓSTICO
   ===================================================================== */
(function () {
  'use strict';
  if (window.__pkDataFix) return; window.__pkDataFix = true;
  var DIAG = {};
  var TIMEOUT = 25000;
  var RETRIES = 2;
  var renderTimer = null;
  function injectCss() {
    if (document.getElementById('pkDataFixCss')) return;
    var s = document.createElement('style'); s.id = 'pkDataFixCss';
    s.textContent = [
      '#pkDiagFab{position:fixed;right:16px;bottom:16px;z-index:9400;display:none;align-items:center;gap:8px;padding:11px 16px;border:0;border-radius:999px;cursor:pointer;font:inherit;font-weight:800;font-size:13px;color:#fff;background:linear-gradient(135deg,#7c5cff,#f59e0b);box-shadow:0 8px 24px rgba(60,40,120,.35);transition:transform .15s}',
      '#pkDiagFab:hover{transform:translateY(-2px)}',
      '#pkDiagFab.pk-bad{background:linear-gradient(135deg,#ef4444,#f59e0b);animation:pkPulse 1.6s infinite}',
      '#pkDiagFab .pk-dot{width:9px;height:9px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px #22c55e}',
      '#pkDiagFab.pk-bad .pk-dot{background:#fff;box-shadow:0 0 8px #fff}',
      '@keyframes pkPulse{0%,100%{box-shadow:0 8px 24px rgba(239,68,68,.35)}50%{box-shadow:0 8px 32px rgba(239,68,68,.65)}}',
      '#pkDiagPanel{position:fixed;top:0;right:0;height:100vh;width:min(460px,94vw);z-index:9500;display:none;flex-direction:column;background:var(--card,#fffdf8);color:var(--ink,#241f31);border-left:1.5px solid var(--border,#e8e1d2);box-shadow:-12px 0 40px rgba(40,20,80,.25)}',
      '#pkDiagPanel.open{display:flex}',
      '.pk-diag-head{padding:16px;border-bottom:1px solid var(--border,#e8e1d2);background:linear-gradient(135deg,rgba(124,92,255,.12),rgba(245,158,11,.12))}',
      '.pk-diag-head h3{margin:0 0 4px;font-size:16px}',
      '.pk-diag-head p{margin:0;font-size:12px;color:var(--muted,#8a8398)}',
      '.pk-diag-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}',
      '.pk-diag-actions button{padding:8px 12px;border-radius:10px;border:1px solid var(--border,#e8e1d2);background:var(--card,#fff);color:var(--ink,#241f31);font:inherit;font-size:12px;font-weight:700;cursor:pointer}',
      '.pk-diag-actions button:hover{border-color:#7c5cff;color:#7c5cff}',
      '#pkDiagList{flex:1;overflow:auto;padding:12px;scrollbar-width:thin;scrollbar-color:#7c5cff rgba(124,92,255,.12)}',
      '#pkDiagList::-webkit-scrollbar{width:9px}',
      '#pkDiagList::-webkit-scrollbar-track{background:rgba(124,92,255,.10);border-radius:9px}',
      '#pkDiagList::-webkit-scrollbar-thumb{background:linear-gradient(#7c5cff,#f59e0b);border-radius:9px}',
      '.pk-diag-row{border:1px solid var(--border,#e8e1d2);border-radius:12px;padding:11px 12px;margin-bottom:9px;background:rgba(124,92,255,.04)}',
      '.pk-diag-row.pk-fail{border-color:rgba(239,68,68,.5);background:rgba(239,68,68,.06)}',
      '.pk-diag-path{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;word-break:break-all;margin-bottom:6px}',
      '.pk-diag-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--muted,#8a8398)}',
      '.pk-diag-pill{padding:2px 8px;border-radius:999px;font-weight:800;font-size:10.5px;color:#fff}',
      '.pk-diag-pill.ok{background:#22c55e}.pk-diag-pill.error{background:#ef4444}.pk-diag-pill.timeout{background:#f59e0b}.pk-diag-pill.retry{background:#3b82f6}',
      '.pk-diag-msg{margin-top:6px;font-size:11px;color:#ef4444;word-break:break-word}',
      '.pk-diag-row button{margin-top:8px;padding:5px 10px;border-radius:8px;border:1px solid var(--border,#e8e1d2);background:transparent;color:var(--ink);font:inherit;font-size:11px;font-weight:700;cursor:pointer}',
      '.pk-diag-row button:hover{border-color:#7c5cff;color:#7c5cff}',
      '.pk-banner{margin:10px 0;padding:11px 13px;border-radius:12px;border:1.5px solid rgba(245,158,11,.55);background:rgba(245,158,11,.10);color:var(--ink,#241f31);font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
      '.pk-banner .btn{padding:6px 11px;font-size:12px}',
      '.pk-diag-empty{padding:24px;text-align:center;color:var(--muted,#8a8398);font-size:13px}'
    ].join('\n');
    document.head.appendChild(s);
  }
  function ensureUi() {
    injectCss();
    if (!document.getElementById('pkDiagFab')) {
      var fab = document.createElement('button');
      fab.id = 'pkDiagFab'; fab.type = 'button';
      fab.innerHTML = '<span class="pk-dot"></span><span id="pkDiagFabText">Diagnóstico</span>';
      fab.addEventListener('click', function () { togglePanel(true); });
      document.body.appendChild(fab);
    }
    if (!document.getElementById('pkDiagPanel')) {
      var p = document.createElement('div'); p.id = 'pkDiagPanel';
      p.innerHTML =
        '<div class="pk-diag-head"><h3>🩺 Diagnóstico de datos</h3><p>Estado de cada ruta consultada por el panel.</p>' +
        '<div class="pk-diag-actions"><button id="pkDiagRetryAll">↻ Reintentar todo</button><button id="pkDiagCopy">⧉ Copiar diagnóstico</button><button id="pkDiagClose">✕ Cerrar</button></div></div>' +
        '<div id="pkDiagList"></div>';
      document.body.appendChild(p);
      document.getElementById('pkDiagClose').addEventListener('click', function () { togglePanel(false); });
      document.getElementById('pkDiagRetryAll').addEventListener('click', function () { loadTab(currentTab); });
      document.getElementById('pkDiagCopy').addEventListener('click', copyDiag);
      document.getElementById('pkDiagList').addEventListener('click', function (e) {
        var b = e.target.closest('button[data-path]'); if (!b) return;
        retryPath(b.getAttribute('data-path'));
      });
    }
  }
  function togglePanel(open) {
    ensureUi();
    var p = document.getElementById('pkDiagPanel');
    p.classList.toggle('open', open);
    if (open) renderPanel();
  }
  window.pkOpenDiag = function () { togglePanel(true); };
  window.pkCloseDiag = function () { togglePanel(false); };
  function fails() { return Object.keys(DIAG).filter(function (k) { return DIAG[k].state === 'error' || DIAG[k].state === 'timeout'; }); }
  function updateFab() {
    ensureUi();
    var fab = document.getElementById('pkDiagFab'); if (!fab) return;
    var n = fails().length;
    fab.style.display = 'flex';
    fab.classList.toggle('pk-bad', n > 0);
    document.getElementById('pkDiagFabText').textContent = n ? ('⚠ ' + n + ' ruta(s) con fallo') : '🩺 Datos OK';
    var panel = document.getElementById('pkDiagPanel');
    if (panel && panel.classList.contains('open')) renderPanel();
  }
  function record(path, state, ms, message, attempts, count) {
    DIAG[path] = { state: state, ms: ms, message: message || '', attempts: attempts || 1, count: count, at: new Date() };
    updateFab();
  }
  function renderPanel() {
    var list = document.getElementById('pkDiagList'); if (!list) return;
    var keys = Object.keys(DIAG).sort(function (a, b) {
      var fa = DIAG[a].state !== 'ok', fb = DIAG[b].state !== 'ok';
      return fa === fb ? a.localeCompare(b) : (fa ? -1 : 1);
    });
    if (!keys.length) { list.innerHTML = '<div class="pk-diag-empty">Aún no hay peticiones registradas.</div>'; return; }
    var labels = { ok: 'OK', error: 'ERROR', timeout: 'TIMEOUT', retry: 'REINTENTANDO' };
    list.innerHTML = keys.map(function (k) {
      var d = DIAG[k];
      var meta = d.ms + ' ms · intento ' + d.attempts + (typeof d.count === 'number' ? ' · ' + d.count + ' registros' : '') + ' · ' + d.at.toLocaleTimeString('es-CO');
      return '<div class="pk-diag-row' + (d.state !== 'ok' ? ' pk-fail' : '') + '">' +
        '<div class="pk-diag-path">' + esc(k) + '</div>' +
        '<div class="pk-diag-meta"><span class="pk-diag-pill ' + d.state + '">' + (labels[d.state] || d.state) + '</span><span>' + meta + '</span></div>' +
        (d.message ? '<div class="pk-diag-msg">' + esc(d.message) + '</div>' : '') +
        '<button data-path="' + esc(k) + '">↻ Reintentar esta ruta</button></div>';
    }).join('');
  }
  function copyDiag() {
    var lines = ['Diagnóstico Pandala Kawaii · ' + new Date().toLocaleString('es-CO')];
    Object.keys(DIAG).sort().forEach(function (k) {
      var d = DIAG[k];
      lines.push('[' + d.state.toUpperCase() + '] ' + k + ' · ' + d.ms + 'ms · intento ' + d.attempts + (typeof d.count === 'number' ? ' · ' + d.count + ' registros' : '') + (d.message ? ' · ' + d.message : ''));
    });
    var txt = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { toast('✔ Diagnóstico copiado'); });
    else { var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('✔ Diagnóstico copiado'); }
  }
  function retryPath(path) {
    toast('↻ Reintentando ' + path);
    api(path).then(function () { toast('✔ Ruta responde OK'); loadTab(currentTab); })
      .catch(function (e) { toast('⚠ ' + e.message); });
  }
  window.pkRetryPath = retryPath;
  var _apiBase = api;
  api = function (path, opts) {
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase();
    if (method !== 'GET') return _apiBase(path, opts);
    var attempt = 0;
    function run() {
      attempt++;
      var ctrl = ('AbortController' in window) ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT) : null;
      var t0 = performance.now();
      var o = Object.assign({}, opts, ctrl ? { signal: ctrl.signal } : {});
      return _apiBase(path, o).then(function (data) {
        if (timer) clearTimeout(timer);
        record(path, 'ok', Math.round(performance.now() - t0), '', attempt, Array.isArray(data) ? data.length : undefined);
        return data;
      }).catch(function (err) {
        if (timer) clearTimeout(timer);
        var msg = (err && err.message) || String(err);
        var aborted = err && (err.name === 'AbortError' || /abort/i.test(msg));
        var permanent = /401|404|400|Sesi[oó]n/i.test(msg);
        if (!permanent && attempt <= RETRIES) {
          record(path, 'retry', Math.round(performance.now() - t0), msg, attempt);
          return new Promise(function (r) { setTimeout(r, 700 * attempt); }).then(run);
        }
        record(path, aborted ? 'timeout' : 'error', Math.round(performance.now() - t0), msg, attempt);
        throw err;
      });
    }
    return run();
  };
  function normAnalytics(a) {
    a = a || {};
    return {
      salesLines: Array.isArray(a.salesLines) ? a.salesLines : [],
      paysMonth: Array.isArray(a.paysMonth) ? a.paysMonth : [],
      stockRows: Array.isArray(a.stockRows) ? a.stockRows : [],
      inventory: Object.assign({ totalCosto: 0, totalEnvio: 0, over90: 0, over90Pct: 0 }, a.inventory || {})
    };
  }
  function safeRender() {
    [renderSummary, renderResumenCharts, renderUtilidad, renderProfitBox, renderGoalsBox,
      renderInventoryValue, renderLogisDash, fillDashboardClients, renderClientOrders, renderRecent, renderLow]
      .forEach(function (fn) { try { fn(); } catch (e) { console.warn('Render parcial:', e); } });
  }
  function scheduleRender() { if (!renderTimer) renderTimer = setTimeout(function () { renderTimer = null; safeRender(); }, 90); }
  function banner(view, html) {
    var v = document.getElementById('view-' + view); if (!v) return;
    var b = document.getElementById('pkBanner-' + view);
    if (!html) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('div'); b.id = 'pkBanner-' + view; b.className = 'pk-banner';
      var anchor = v.querySelector('.toolbar') || v.querySelector('.subtitle') || v.querySelector('h1');
      if (anchor) anchor.insertAdjacentElement('afterend', b); else v.insertBefore(b, v.firstChild);
    }
    b.innerHTML = html;
  }
  function failBanner(view, fails) {
    banner(view, fails.length
      ? '⚠ No se pudo cargar: <b>' + fails.map(esc).join(', ') + '</b>. Se muestra lo que sí llegó. <button class="btn" onclick="pkOpenDiag()">Ver diagnóstico</button> <button class="btn" onclick="loadTab(currentTab)">↻ Reintentar</button>'
      : null);
  }
  loadDash = async function () {
    var fails = [], dashOk = false;
    ANALYTICS = normAnalytics(ANALYTICS);
    if (!Array.isArray(GOALS)) GOALS = []; if (!Array.isArray(DONATIONS)) DONATIONS = [];
    if (!Array.isArray(LOGIS)) LOGIS = []; if (!Array.isArray(CLIENTS)) CLIENTS = []; if (!Array.isArray(ORDERS)) ORDERS = [];
    ['mVentas', 'mAbonos', 'mSaldo', 'mAbiertos', 'mStock'].forEach(function (id) { var el = $(id); if (el) el.textContent = '…'; });
    function job(path, apply) {
      return api(path).then(function (d) { try { apply(d); } catch (e) { console.warn(e); } scheduleRender(); })
        .catch(function () { fails.push(path.replace('/api/admin/', '')); scheduleRender(); });
    }
    await Promise.all([
      job('/api/admin/dashboard', function (d) {
        dashOk = true; var set = function (id, v) { var el = $(id); if (el) el.textContent = v; };
        set('mVentas', money(d.ventas)); set('mAbonos', money(d.abonos)); set('mSaldo', money(d.saldo));
        set('mAbiertos', d.abiertos); set('mStock', d.stockBajo);
      }),
      job('/api/admin/analytics', function (a) { ANALYTICS = normAnalytics(a); }),
      job('/api/admin/goals', function (g) { GOALS = Array.isArray(g) ? g : []; }),
      job('/api/admin/donations', function (d) { DONATIONS = Array.isArray(d) ? d : []; }),
      job('/api/admin/logistics', function (l) { LOGIS = Array.isArray(l) ? l : []; }),
      job('/api/admin/clients', function (c) { CLIENTS = Array.isArray(c) ? c : []; }),
      job('/api/admin/orders', function (o) { ORDERS = Array.isArray(o) ? o : []; }),
      job('/api/admin/settings', function (s) { CFG = s; }),
      job('/api/admin/products', function (p) { PRODUCTS = Array.isArray(p) ? p : []; }),
      job('/api/admin/kits', function (k) { KITS = Array.isArray(k) ? k : []; }),
      job('/api/admin/categories', function (c) { CATS = Array.isArray(c) ? c : []; })
    ]);
    if (!dashOk) ['mVentas', 'mAbonos', 'mSaldo', 'mAbiertos', 'mStock'].forEach(function (id) { var el = $(id); if (el) el.textContent = '—'; });
    safeRender();
    failBanner('dash', fails);
  };
  fetchCaches = async function () {
    var r = await Promise.all([
      api('/api/admin/products').then(function (p) { PRODUCTS = Array.isArray(p) ? p : []; return true; }).catch(function () { return false; }),
      api('/api/admin/kits').then(function (k) { KITS = Array.isArray(k) ? k : []; return true; }).catch(function () { return false; }),
      api('/api/admin/categories').then(function (c) { CATS = Array.isArray(c) ? c : []; return true; }).catch(function () { return false; })
    ]);
    return { products: r[0], kits: r[1], categories: r[2] };
  };
  loadInventory = async function () {
    var r = await fetchCaches(); renderInventory();
    var f = []; if (!r.products) f.push('products'); if (!r.kits) f.push('kits'); if (!r.categories) f.push('categories');
    failBanner('inv', f);
  };
  loadKits = async function () {
    var r = await fetchCaches(); renderKits();
    failBanner('kits', !r.kits ? ['kits'] : (!r.products ? ['products'] : []));
  };
  loadConfig = async function () {
    var f = [];
    await Promise.all([
      api('/api/admin/settings').then(function (s) { CFG = s; }).catch(function () { f.push('settings'); }),
      api('/api/admin/goals').then(function (g) { GOALS = Array.isArray(g) ? g : []; }).catch(function () { f.push('goals'); }),
      api('/api/admin/donations').then(function (d) { DONATIONS = Array.isArray(d) ? d : []; }).catch(function () { f.push('donations'); })
    ]);
    if (CFG) {
      var ic = CFG.invoice_config || {};
      var set = function (id, v) { var el = $(id); if (el) el.value = v; };
      set('iEmpresa', ic.empresa || ''); set('iNit', ic.nit || ''); set('iTel', ic.telefono || '');
      set('iEmail', ic.email || ''); set('iDir', ic.direccion || ''); set('iMsg', ic.mensaje || '');
      set('iFontTitulos', ic.fontTitulos || 'Arial'); set('iFontCuerpo', ic.fontCuerpo || 'Arial');
      logoData = ic.logo || null; wmData = ic.watermark || null; wmW = ic.watermarkW || 0; wmH = ic.watermarkH || 0;
      var lp = $('iLogoPrev'); if (lp) { lp.src = logoData || ''; lp.style.display = logoData ? 'inline-block' : 'none'; }
      var wp = $('iWmPrev'); if (wp) { wp.src = wmData || ''; wp.style.display = wmData ? 'inline-block' : 'none'; }
      set('gBreb', CFG.bre_b_key || ''); set('gWa', CFG.whatsapp_number || ''); set('gTpl', CFG.whatsapp_template || '');
      set('gPrefix', CFG.order_prefix || ''); set('gStart', CFG.order_start || 1); set('gDigits', CFG.order_digits || 5);
      set('gMin', CFG.min_payment_amount || 0);
      var pc = profitConfig();
      set('gDiezmo', pc.diezmoPct); set('gOfrenda', pc.ofrendaPct);
      set('gReinv', pc.reinvEnabled ? '1' : '0'); set('gReinvPct', pc.reinvPct);
      set('uiThemeSel', localStorage.getItem('uiTheme') || 'light');
      set('uiLayoutSel', localStorage.getItem('uiLayout') || 'top');
    }
    try { renderGoalsCfg(); } catch (e) {} try { renderDonations(); } catch (e) {}
    failBanner('config', f);
  };
  [['clients', 'loadClients'], ['orders', 'loadOrders'], ['logis', 'loadLogistics'], ['abonos', 'loadReports'], ['cats', 'loadCats']].forEach(function (pair) {
    var view = pair[0], name = pair[1], orig = window[name];
    if (typeof orig !== 'function') return;
    var wrapped = function () {
      return orig().then(function () { banner(view, null); }).catch(function (e) {
        banner(view, '⚠ ' + esc(e.message) + ' <button class="btn" onclick="pkOpenDiag()">Diagnóstico</button> <button class="btn" onclick="loadTab(currentTab)">↻ Reintentar</button>');
      });
    };
    window[name] = wrapped;
    if (typeof LOADERS !== 'undefined' && LOADERS[view]) LOADERS[view] = wrapped;
  });
  if (typeof LOADERS !== 'undefined') {
    LOADERS.dash = loadDash; LOADERS.inv = loadInventory; LOADERS.kits = loadKits; LOADERS.config = loadConfig;
  }
  ensureUi();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureUi);
})();

/* =====================================================================
   PANDALA · ADMIN EXTRA (recuperación, import en config, notificación abonos)
   ===================================================================== */
(function () {
  'use strict';
  if (window.__pkAdminExtra) return; window.__pkAdminExtra = true;
  var st = document.createElement('style');
  st.textContent = [
    '.pk-link{display:inline-block;margin-top:10px;color:#7c5cff;font-weight:700;font-size:13px;cursor:pointer;text-decoration:underline}',
    '#pkAbonoBubble{position:fixed;left:16px;bottom:16px;z-index:9600;max-width:320px;display:none;gap:10px;align-items:flex-start;background:#241f31;color:#ffffff;border:2px solid #f59e0b;border-radius:14px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.4);font-size:13px}',
    '[data-theme="dark"] #pkAbonoBubble{background:#fff8e7;color:#241f31;border-color:#7c5cff}',
    '#pkAbonoBubble b{color:#f59e0b}[data-theme="dark"] #pkAbonoBubble b{color:#7c5cff}',
    '#pkAbonoBubble .pk-b-actions{display:flex;gap:8px;margin-top:8px}',
    '#pkAbonoBubble button{border:0;border-radius:8px;padding:6px 10px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}',
    '#pkAbonoBubble .pk-see{background:#f59e0b;color:#241f31}[data-theme="dark"] #pkAbonoBubble .pk-see{background:#7c5cff;color:#fff}',
    '#pkAbonoBubble .pk-x{background:transparent;color:inherit;border:1px solid currentColor}',
    '.pk-modal-back{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:9700}',
    '.pk-modal-back.open{display:flex}',
    '.pk-modal{background:var(--card,#fff);color:var(--ink,#241f31);border-radius:16px;padding:20px;width:min(420px,92vw);display:grid;gap:10px}',
    '.pk-modal input{padding:10px;border:1px solid var(--border,#ccc);border-radius:10px;font:inherit;background:var(--card,#fff);color:var(--ink,#241f31)}',
    '.pk-modal .pk-err{color:#ef4444;font-size:12px;min-height:14px}'
  ].join('\n');
  document.head.appendChild(st);
  function modal(id, title, fields, btnText, onSubmit) {
    var back = document.createElement('div'); back.className = 'pk-modal-back'; back.id = id;
    back.innerHTML = '<div class="pk-modal"><h3 style="margin:0">' + title + '</h3>' +
      fields.map(function (f) { return '<input id="' + f.id + '" type="' + (f.type || 'text') + '" placeholder="' + f.ph + '">'; }).join('') +
      '<div class="pk-err" id="' + id + 'Err"></div><button class="btn primary" id="' + id + 'Go">' + btnText + '</button>' +
      '<button class="btn" id="' + id + 'Close">Cerrar</button></div>';
    document.body.appendChild(back);
    $(id + 'Close').onclick = function () { back.classList.remove('open'); };
    $(id + 'Go').onclick = function () { onSubmit(back); };
    return back;
  }
  var fp = modal('pkForgotPwd', 'Recuperar contraseña', [{ id: 'pkFpEmail', type: 'email', ph: 'Tu correo de administrador' }], 'Enviar contraseña temporal',
    function (back) {
      api('/api/auth/admin/forgot-password', { method: 'POST', body: { email: $('pkFpEmail').value.trim() } })
        .then(function (d) { toast('✔ ' + d.message); back.classList.remove('open'); })
        .catch(function (e) { $('pkForgotPwdErr').textContent = e.message; });
    });
  var loginForm = document.querySelector('#view-login form');
  if (loginForm) loginForm.insertAdjacentHTML('beforeend', '<span class="pk-link" id="pkForgotLink">¿Olvidaste tu contraseña?</span>');
  $('pkForgotLink').onclick = function () { fp.classList.add('open'); };
  var cp = modal('pkChangePwd', 'Crea una nueva contraseña', [{ id: 'pkCpNew', type: 'password', ph: 'Nueva contraseña (mín. 6)' }], 'Guardar contraseña',
    function (back) {
      api('/api/auth/admin/change-password', { method: 'POST', body: { new_password: $('pkCpNew').value } })
        .then(function () { toast('✔ Contraseña actualizada'); back.classList.remove('open'); })
        .catch(function (e) { $('pkChangePwdErr').textContent = e.message; });
    });
  function moveImport() {
    var impPanel = document.querySelector('#view-import .panel');
    var cfg = $('view-config');
    if (impPanel && cfg && !cfg.contains(impPanel)) {
      var h = document.createElement('h2'); h.textContent = 'Importar datos actuales (JSON)'; h.style.marginTop = '18px';
      cfg.appendChild(h); cfg.appendChild(impPanel);
    }
    var iv = $('view-import'); if (iv) iv.style.display = 'none';
    for (var i = TABS.length - 1; i >= 0; i--) if (TABS[i][0] === 'import') TABS.splice(i, 1);
    renderTabs();
  }
  var bubble = document.createElement('div'); bubble.id = 'pkAbonoBubble';
  bubble.innerHTML = '<div style="flex:1"><b>💰 Nuevo abono reportado</b><div id="pkAbonoTxt" style="margin-top:4px"></div>' +
    '<div class="pk-b-actions"><button class="pk-see" id="pkAbonoSee">Ver abonos</button><button class="pk-x" id="pkAbonoX">✕</button></div></div>';
  document.body.appendChild(bubble);
  $('pkAbonoSee').onclick = function () { bubble.style.display = 'none'; showTab('abonos'); };
  $('pkAbonoX').onclick = function () { bubble.style.display = 'none'; };
  var seen = {}; try { seen = JSON.parse(localStorage.getItem('pkSeenReports') || '{}'); } catch (e) {}
  function checkReports() {
    if (!token || !user || user.role !== 'admin') return;
    api('/api/orders/reports/pending').then(function (rows) {
      var nuevo = null;
      rows.forEach(function (r) { if (!seen[r.id]) { seen[r.id] = 1; nuevo = r; } });
      localStorage.setItem('pkSeenReports', JSON.stringify(seen));
      if (nuevo) {
        $('pkAbonoTxt').textContent = (nuevo.client_name || 'Cliente') + ' · ' + money(nuevo.amount) + ' · bolsita ' + (nuevo.order_number || '');
        bubble.style.display = 'flex';
      }
    }).catch(function () {});
  }
  setInterval(checkReports, 20000);
  var _enter = enterPanel;
  enterPanel = function () { _enter(); moveImport(); checkReports(); };
  if (document.readyState !== 'loading' && user && user.role === 'admin') { moveImport(); checkReports(); }
})();
