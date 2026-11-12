/* ===== Notificaciones en tiempo real del panel administrador ===== */
(function () {
  // El super administrador vive en /super.html
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    if (u && u.role === 'super_admin') { location.href = '/super.html'; return; }
  } catch (e) { }

  let socket = null;

  function portfolio() {
    try { return JSON.parse(localStorage.getItem('portfolio') || 'null'); } catch (e) { return null; }
  }

  async function refreshPending() {
    if (!localStorage.getItem('token')) return;
    try {
      const rows = await api('/api/orders/reports/pending');
      let badge = document.getElementById('pendBadge');
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'pendBadge';
        badge.className = 'pill warn';
        badge.style.marginRight = '8px';
        const who = document.getElementById('who');
        if (who) who.parentNode.insertBefore(badge, who);
      }
      badge.textContent = rows.length ? '🔔 ' + rows.length + ' por confirmar' : '';
      badge.style.display = rows.length ? 'inline-block' : 'none';
      if (typeof currentTab !== 'undefined' && currentTab === 'abonos') loadReports();
    } catch (e) { /* sin sesión o sin red: se reintenta en el siguiente evento */ }
  }

  function start() {
    if (!window.io) { setTimeout(start, 400); return; }
    if (socket) return;
    socket = io();
    const pf = portfolio();
    socket.on('connect', () => { if (pf && pf.id) socket.emit('join-portfolio', pf.id); });
    socket.on('payment-reported', (p) => {
      const me = portfolio();
      if (me && p.portfolioId && p.portfolioId !== me.id) return;
      if (typeof toast === 'function') toast('🔔 Nuevo abono por confirmar: ' + p.orderNumber + ' — ' + money(p.amount));
      refreshPending();
    });
    socket.on('report-resolved', () => refreshPending());
    socket.on('stock-updated', () => {
      if (typeof currentTab !== 'undefined' && ['inv', 'dash', 'orders', 'kits'].includes(currentTab)) loadTab(currentTab);
    });
  }

  // Carga el cliente de Socket.IO y arranca
  const sc = document.createElement('script');
  sc.src = '/socket.io/socket.io.js';
  sc.onload = start;
  document.head.appendChild(sc);

  // Refresco del contador: al cargar y cada 60 s (respaldo por si se cae el socket)
  document.addEventListener('DOMContentLoaded', () => setTimeout(refreshPending, 900));
  setInterval(refreshPending, 60000);
})();