/* ===== Pandala Kawaii · Super Administrador (multi-tienda) ===== */
let token = localStorage.getItem('token') || '';
let user = JSON.parse(localStorage.getItem('user') || 'null');
let PORTFOLIOS = [];
let curPf = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

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
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 3000); }
function closeModal(id) { $(id).classList.remove('open'); }
function openModal(id) { $(id).classList.add('open'); }

/* ---------- Sesión ---------- */
function init() {
  if (user && token && user.role === 'super_admin') enter();
  else if (user && token) location.href = '/admin.html'; // admins de tienda viven en su panel
  else showLogin();
}
function showLogin() {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-login').classList.add('active');
  $('hdr').classList.add('hidden');
}
function enter() {
  $('hdr').classList.remove('hidden');
  $('who').textContent = '👑 ' + user.name;
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
  token = ''; user = null;
  localStorage.removeItem('token'); localStorage.removeItem('user'); localStorage.removeItem('portfolio');
  showLogin();
}

/* ---------- Tiendas ---------- */
async function loadPortfolios() {
  try {
    PORTFOLIOS = await api('/api/super/portfolios');
    $('pfTable').innerHTML = PORTFOLIOS.length ?
      '<div class="tablewrap"><table class="adm"><thead><tr><th>Tienda</th><th>Enlace público</th><th>Bre-b</th><th>WhatsApp</th><th>Num.</th><th>Admins</th><th>Clientes</th><th>Productos</th><th>Pedidos</th><th>Acciones</th></tr></thead><tbody>' +
      PORTFOLIOS.map(p => `<tr><td><b>${esc(p.name)}</b></td><td><a href="/?t=${esc(p.slug)}" target="_blank" rel="noopener">/?t=${esc(p.slug)}</a></td><td>${esc(p.bre_b_key || '—')}</td><td>${esc(p.whatsapp_number || '—')}</td><td>${esc(p.order_prefix || '')}</td><td>${p.admins}</td><td>${p.clients}</td><td>${p.products}</td><td>${p.orders}</td>
        <td class="acts"><button class="btn" onclick="openAdmins('${p.id}')">Administradores</button><button class="btn" onclick="openPortfolio('${p.id}')">Editar</button></td></tr>`).join('') +
      '</tbody></table></div>' :
      '<p class="note">Aún no hay tiendas. Crea la primera con "+ Nueva tienda".</p>';
  } catch (e) { toast('⚠ ' + e.message); }
}

function openPortfolio(id) {
  const p = id ? PORTFOLIOS.find(x => x.id === id) : null;
  $('pfTitle').textContent = p ? 'Editar tienda' : 'Nueva tienda';
  $('pfId').value = p ? p.id : '';
  $('pfName').value = p ? p.name : '';
  $('pfSlug').value = p ? p.slug : '';
  $('pfSlug').disabled = !!p; // el enlace no se cambia para no romper links existentes
  $('pfBreb').value = p ? (p.bre_b_key || '') : '';
  $('pfWa').value = p ? (p.whatsapp_number || '') : '';
  $('pfPrefix').value = p ? (p.order_prefix || '') : '';
  $('pfLink').textContent = p
    ? 'Enlace público de la tienda: ' + location.origin + '/?t=' + p.slug
    : 'El enlace público será: ' + location.origin + '/?t=<slug>';
  openModal('pfModal');
}

async function savePortfolio() {
  const id = $('pfId').value;
  const body = {
    name: $('pfName').value.trim(), slug: $('pfSlug').value.trim(),
    bre_b_key: $('pfBreb').value.trim(), whatsapp_number: $('pfWa').value.trim(),
    order_prefix: $('pfPrefix').value.trim(),
  };
  try {
    if (id) await api('/api/super/portfolios/' + id, { method: 'PUT', body });
    else await api('/api/super/portfolios', { method: 'POST', body });
    closeModal('pfModal'); toast('✔ Tienda guardada'); loadPortfolios();
  } catch (e) { toast('⚠ ' + e.message); }
}

/* ---------- Administradores por tienda ---------- */
async function openAdmins(pfId) {
  curPf = PORTFOLIOS.find(x => x.id === pfId); if (!curPf) return;
  $('adTitle').textContent = 'Administradores — ' + curPf.name;
  $('adName').value = ''; $('adEmail').value = ''; $('adPass').value = '';
  await renderAdmins();
  openModal('adModal');
}
async function renderAdmins() {
  try {
    const rows = await api('/api/super/portfolios/' + curPf.id + '/admins');
    $('adList').innerHTML = rows.length ?
      '<div class="tablewrap"><table class="adm"><thead><tr><th>Nombre</th><th>Correo</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>' +
      rows.map(a => `<tr><td><b>${esc(a.name)}</b></td><td>${esc(a.email)}</td><td>${a.status === 'Activo' ? '<span class="pill ok">Activo</span>' : '<span class="pill danger">Inactivo</span>'}</td>
        <td class="acts"><button class="btn" onclick="resetAdminPass('${a.id}')">Restablecer contraseña</button><button class="btn ${a.status === 'Activo' ? 'danger' : ''}" onclick="toggleAdmin('${a.id}','${a.status === 'Activo' ? 'Inactivo' : 'Activo'}')">${a.status === 'Activo' ? 'Inactivar' : 'Activar'}</button></td></tr>`).join('') +
      '</tbody></table></div>' :
      '<p class="note">Esta tienda aún no tiene administradores.</p>';
  } catch (e) { toast('⚠ ' + e.message); }
}
async function createAdmin() {
  if (!curPf) return;
  try {
    await api('/api/super/portfolios/' + curPf.id + '/admins', { method: 'POST', body: { name: $('adName').value.trim(), email: $('adEmail').value.trim(), password: $('adPass').value } });
    $('adName').value = ''; $('adEmail').value = ''; $('adPass').value = '';
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