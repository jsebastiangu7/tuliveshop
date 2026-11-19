/* ===== Tu Live Shop · Super Administrador (multi-tienda) ===== */
let token = localStorage.getItem('token') || '';
let user = JSON.parse(localStorage.getItem('user') || 'null');
let PORTFOLIOS = [];
let curPf = null;
const DOCS = {}; // documento elegido por campo: { name, type, data(base64) }
const MAX_DOC = 5 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

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
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3500); }
function closeModal(id) { $(id).classList.remove('open'); }
function openModal(id) { $(id).classList.add('open'); }

/* ---------- Tema ---------- */
function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  $('themeBtn').textContent = next === 'dark' ? '🌙' : '☀️';
}

/* ---------- Sesión ---------- */
function init() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  $('themeBtn').textContent = saved === 'dark' ? '🌙' : '☀️';
  if (user && token && user.role === 'super_admin') enter();
  else if (user && token) location.href = '/admin.html'; // los administradores de tienda viven en su panel
  else showLogin();
}
function showLogin() {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-login').classList.add('active');
  $('hdr').classList.add('hidden');
}
function enter() {
  $('hdr').classList.remove('hidden');
  $('who').textContent = '👑 ' + (user.name || 'Super Admin');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-main').classList.add('active');
  loadPortfolios();
}
async function login(ev) {
  ev.preventDefault(); $('aErr').textContent = '';
  try {
    const d = await api('/api/auth/admin/login', { method: 'POST', body: { email: $('aEmail').value.trim(), password: $('aPass').value } });
    if (d.user.role !== 'super_admin') { $('aErr').textContent = 'Esta pantalla es solo para el super administrador. Los administradores de tienda entran por /admin.html'; return; }
    token = d.token; user = d.user;
    localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user));
    enter();
  } catch (e) { $('aErr').textContent = e.message; }
}
function logout() {
  fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
  token = ''; user = null;
  localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('portfolio');
  showLogin();
}

/* ---------- Documento de identidad ---------- */
function readDoc(file) {
  return new Promise((ok, ko) => {
    if (!file) return ok(null);
    const okType = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.type);
    if (!okType) return ko(new Error('El documento debe ser PDF, JPG o PNG'));
    if (file.size > MAX_DOC) return ko(new Error('El documento supera los 5 MB'));
    const r = new FileReader();
    r.onload = () => ok({ name: file.name, type: file.type, data: String(r.result).split(',')[1] || '' });
    r.onerror = () => ko(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(file);
  });
}
async function pickDoc(input, labelId) {
  const f = input.files && input.files[0];
  try {
    DOCS[input.id] = await readDoc(f);
    const pe = $('pfErr'); if (pe) pe.textContent = '';
    $(labelId).textContent = f ? f.name : 'Ningún archivo seleccionado';
  } catch (e) {
    DOCS[input.id] = null; input.value = ''; $(labelId).textContent = 'Ningún archivo seleccionado'; toast('⚠ ' + e.message);
  }
}
// El documento está protegido: se descarga con la sesión del super administrador y se abre en una pestaña nueva
async function viewDoc(adminId) {
  const w = window.open('', '_blank');
  try {
    const res = await fetch('/api/super/admins/' + adminId + '/document', { headers: { Authorization: 'Bearer ' + token }, credentials: 'include' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'No se pudo abrir el documento'); }
    const url = URL.createObjectURL(await res.blob());
    if (w) w.location.href = url; else location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { if (w) w.close(); toast('⚠ ' + e.message); }
}
function replaceDoc(adminId) {
  const inp = $('docReplace');
  inp.value = '';
  inp.onchange = async () => {
    try {
      const doc = await readDoc(inp.files[0]); if (!doc) return;
      await api('/api/super/admins/' + adminId + '/document', { method: 'PUT', body: { id_document: doc } });
      toast('✔ Documento guardado'); renderAdmins();
    } catch (e) { toast('⚠ ' + e.message); }
  };
  inp.click();
}

/* ---------- Tiendas ---------- */
async function loadPortfolios() {
  try {
    PORTFOLIOS = await api('/api/super/portfolios');
    $('pfTable').innerHTML = PORTFOLIOS.length ?
      '<div class="tablewrap"><table><thead><tr><th>Tienda</th><th>Enlace público</th><th>Bre-B</th><th>WhatsApp</th><th>Num.</th><th>Admins</th><th>Clientes</th><th>Productos</th><th>Pedidos</th><th></th></tr></thead><tbody>' +
      PORTFOLIOS.map(p => `<tr><td><b>${esc(p.name)}</b></td><td><a href="/?t=${esc(p.slug)}" target="_blank" rel="noopener" style="color:var(--brand)">/?t=${esc(p.slug)}</a></td><td>${esc(p.bre_b_key || '—')}</td><td>${esc(p.whatsapp_number || '—')}</td><td>${esc(p.order_prefix || '')}</td><td>${p.admins}</td><td>${p.clients}</td><td>${p.products}</td><td>${p.orders}</td>
        <td><div class="acts"><button class="btn btn-ghost btn-sm" onclick="openAdmins('${p.id}')">Administradores</button><button class="btn btn-ghost btn-sm" onclick="openPortfolio('${p.id}')">Editar</button></div></td></tr>`).join('') +
      '</tbody></table></div>' :
      '<p class="empty">Aún no hay tiendas. Crea la primera con «+ Nueva tienda».</p>';
  } catch (e) { toast('⚠ ' + e.message); }
}

const slugify = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
function suggestSlug() {
  const s = $('pfSlug');
  if (s.disabled || s.dataset.touched) return;
  s.value = slugify($('pfName').value);
  updateLink();
}
function updateLink() {
  const slug = $('pfSlug').value.trim();
  $('pfLink').textContent = slug ? 'Enlace público: ' + location.origin + '/?t=' + slug : '';
}

function openPortfolio(id) {
  const p = id ? PORTFOLIOS.find(x => x.id === id) : null;
  $('pfTitle').textContent = p ? 'Editar tienda' : 'Nueva tienda';
  $('pfId').value = p ? p.id : '';
  $('pfName').value = p ? p.name : '';
  $('pfSlug').value = p ? p.slug : '';
  $('pfSlug').disabled = !!p; // el enlace no se cambia para no romper links existentes
  delete $('pfSlug').dataset.touched;
  $('pfBreb').value = p ? (p.bre_b_key || '') : '';
  $('pfWa').value = p ? (p.whatsapp_number || '') : '';
  $('pfPrefix').value = p ? (p.order_prefix || '') : '';
  $('pfAdminBox').classList.toggle('hidden', !!p); // el administrador se crea junto con la tienda nueva
  ['paName', 'paEmail', 'paPass'].forEach(i => { $(i).value = ''; });
  $('paDoc').value = ''; DOCS.paDoc = null; $('paDocName').textContent = 'Ningún archivo seleccionado';
  $('pfErr').textContent = '';
  $('pfSave').textContent = p ? 'Guardar cambios' : 'Crear tienda';
  updateLink();
  $('pfSlug').oninput = function () { this.dataset.touched = 1; updateLink(); };
  openModal('pfModal');
}

async function savePortfolio() {
  const id = $('pfId').value;
  $('pfErr').textContent = '';
  const body = {
    name: $('pfName').value.trim(), slug: $('pfSlug').value.trim(),
    bre_b_key: $('pfBreb').value.trim(), whatsapp_number: $('pfWa').value.trim(),
    order_prefix: $('pfPrefix').value.trim(),
  };
  if (!body.name) return ($('pfErr').textContent = 'Escribe el nombre de la tienda');
  if (!id) {
    if (!body.slug) return ($('pfErr').textContent = 'Escribe el enlace público de la tienda');
    if (!body.bre_b_key) return ($('pfErr').textContent = 'Escribe la llave Bre-B de la tienda');
    if (!body.whatsapp_number) return ($('pfErr').textContent = 'Escribe el WhatsApp de la tienda');
    const admin = { name: $('paName').value.trim(), email: $('paEmail').value.trim(), password: $('paPass').value, id_document: DOCS.paDoc || null };
    if (!admin.name || !admin.email) return ($('pfErr').textContent = 'Escribe el nombre y el correo del administrador');
    if (admin.password.length < 8) return ($('pfErr').textContent = 'La contraseña del administrador debe tener mínimo 8 caracteres');
    if (!admin.id_document) return ($('pfErr').textContent = 'Sube el documento de identidad del administrador');
    body.admin = admin;
  }
  const btn = $('pfSave'); btn.disabled = true;
  try {
    if (id) await api('/api/super/portfolios/' + id, { method: 'PUT', body });
    else await api('/api/super/portfolios', { method: 'POST', body });
    closeModal('pfModal'); toast(id ? '✔ Tienda actualizada' : '✔ Tienda y administrador creados'); loadPortfolios();
  } catch (e) { $('pfErr').textContent = e.message; }
  finally { btn.disabled = false; }
}

/* ---------- Administradores por tienda ---------- */
async function openAdmins(pfId) {
  curPf = PORTFOLIOS.find(x => x.id === pfId); if (!curPf) return;
  $('adTitle').textContent = 'Administradores — ' + curPf.name;
  ['adName', 'adEmail', 'adPass'].forEach(i => { $(i).value = ''; });
  $('adDoc').value = ''; DOCS.adDoc = null; $('adDocName').textContent = 'Ningún archivo seleccionado';
  await renderAdmins();
  openModal('adModal');
}
async function renderAdmins() {
  try {
    const rows = await api('/api/super/portfolios/' + curPf.id + '/admins');
    $('adList').innerHTML = rows.length ?
      '<div class="tablewrap"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Estado</th><th>Documento</th><th></th></tr></thead><tbody>' +
      rows.map(a => `<tr><td><b>${esc(a.name)}</b></td><td>${esc(a.email)}</td>
        <td>${a.status === 'Activo' ? '<span class="pill ok">Activo</span>' : '<span class="pill danger">Inactivo</span>'}</td>
        <td>${a.has_document ? `<button class="btn btn-ghost btn-sm" onclick="viewDoc('${a.id}')">Ver</button> ` : '<span class="pill warn">Sin documento</span> '}<button class="btn btn-ghost btn-sm" onclick="replaceDoc('${a.id}')">${a.has_document ? 'Reemplazar' : 'Subir'}</button></td>
        <td><div class="acts"><button class="btn btn-ghost btn-sm" onclick="resetAdminPass('${a.id}')">Restablecer contraseña</button><button class="btn btn-sm ${a.status === 'Activo' ? 'btn-danger' : 'btn-primary'}" onclick="toggleAdmin('${a.id}','${a.status === 'Activo' ? 'Inactivo' : 'Activo'}')">${a.status === 'Activo' ? 'Inactivar' : 'Activar'}</button></div></td></tr>`).join('') +
      '</tbody></table></div>' :
      '<p class="empty" style="padding:16px">Esta tienda aún no tiene administradores.</p>';
  } catch (e) { toast('⚠ ' + e.message); }
}
async function createAdmin() {
  if (!curPf) return;
  try {
    await api('/api/super/portfolios/' + curPf.id + '/admins', { method: 'POST', body: { name: $('adName').value.trim(), email: $('adEmail').value.trim(), password: $('adPass').value, id_document: DOCS.adDoc || null } });
    ['adName', 'adEmail', 'adPass'].forEach(i => { $(i).value = ''; });
    $('adDoc').value = ''; DOCS.adDoc = null; $('adDocName').textContent = 'Ningún archivo seleccionado';
    toast('✔ Administrador creado'); renderAdmins(); loadPortfolios();
  } catch (e) { toast('⚠ ' + e.message); }
}
async function toggleAdmin(id, status) {
  try { await api('/api/super/admins/' + id, { method: 'PUT', body: { status } }); toast('✔ Estado actualizado'); renderAdmins(); }
  catch (e) { toast('⚠ ' + e.message); }
}
async function resetAdminPass(id) {
  const pass = prompt('Nueva contraseña para este administrador (mínimo 8 caracteres):');
  if (!pass) return;
  try { await api('/api/super/admins/' + id, { method: 'PUT', body: { password: pass } }); toast('✔ Contraseña restablecida'); }
  catch (e) { toast('⚠ ' + e.message); }
}

document.addEventListener('DOMContentLoaded', init);
