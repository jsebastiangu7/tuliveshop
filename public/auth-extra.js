/* ===== PANDALA · CLIENT AUTH EXTRA (email, recuperar PIN, cambio obligatorio) ===== */
(function () {
  'use strict';
  if (window.__pkClientExtra) return; window.__pkClientExtra = true;
  var st = document.createElement('style');
  st.textContent = '.pk-link{display:inline-block;margin-top:8px;color:#7c5cff;font-weight:700;font-size:13px;cursor:pointer;text-decoration:underline}' +
    '.pk-back{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:9800}' +
    '.pk-back.open{display:flex}.pk-card{background:#fff;color:#241f31;border-radius:16px;padding:20px;width:min(400px,92vw);display:grid;gap:10px}' +
    '.pk-card input{padding:10px;border:1px solid #ddd;border-radius:10px;font:inherit}.pk-card .e{color:#ef4444;font-size:12px;min-height:14px}';
  document.head.appendChild(st);
  function card(id, title, fields, btn, fn) {
    var b = document.createElement('div'); b.className = 'pk-back'; b.id = id;
    b.innerHTML = '<div class="pk-card"><h3 style="margin:0">' + title + '</h3>' +
      fields.map(function (f) { return '<input id="' + f.id + '" type="' + (f.type || 'text') + '" placeholder="' + f.ph + '" inputmode="' + (f.mode || 'text') + '">'; }).join('') +
      '<div class="e" id="' + id + 'E"></div><button id="' + id + 'G" style="padding:10px;border:0;border-radius:10px;background:#7c5cff;color:#fff;font-weight:800;cursor:pointer">' + btn + '</button></div>';
    document.body.appendChild(b);
    b.querySelector('#' + id + 'G').onclick = function () { fn(b); };
    return b;
  }
  var tok = function () { return localStorage.getItem('token') || ''; };

  /* Cambio obligatorio de PIN */
  var ch = card('pkChPin', 'Crea tu nuevo PIN', [{ id: 'pkChNew', type: 'password', ph: 'Nuevo PIN (mín. 4 dígitos)', mode: 'numeric' }], 'Guardar PIN', function (b) {
    fetch('/api/auth/client/change-pin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok() }, body: JSON.stringify({ new_pin: b.querySelector('#pkChNew').value }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error); return d; }); })
      .then(function () { sessionStorage.removeItem('pkMustPin'); b.classList.remove('open'); location.reload(); })
      .catch(function (e) { b.querySelector('#pkChPinE').textContent = e.message; });
  });

  /* Recuperar PIN */
  var fp = card('pkFpPin', 'Recuperar PIN', [{ id: 'pkFpWa', ph: 'Tu WhatsApp', mode: 'numeric' }, { id: 'pkFpEm', type: 'email', ph: 'Tu correo registrado' }], 'Enviar PIN temporal', function (b) {
    var slug = (JSON.parse(localStorage.getItem('portfolio') || '{}').slug) || location.pathname.split('/').pop();
    fetch('/api/auth/client/forgot-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ whatsapp: b.querySelector('#pkFpWa').value, email: b.querySelector('#pkFpEm').value, portfolio_slug: slug }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { b.querySelector('#pkFpPinE').textContent = d.message || 'Listo'; })
      .catch(function (e) { b.querySelector('#pkFpPinE').textContent = e.message; });
  });

  /* Interceptar login/register para email + cambio obligatorio */
  var _fetch = window.fetch;
  window.fetch = function (url, opts) {
    opts = opts || {};
    var u = String(url);
    if (u.indexOf('/api/auth/client/register') >= 0 && opts.body) {
      try { var b = JSON.parse(opts.body); var em = document.getElementById('pkRegEmail'); if (em && em.value) b.email = em.value; opts.body = JSON.stringify(b); } catch (e) {}
    }
    var p = _fetch(url, opts);
    if (u.indexOf('/api/auth/client/login') >= 0) {
      p.then(function (r) { return r.clone().json(); }).then(function (d) {
        if (d && d.must_change_pin) { sessionStorage.setItem('pkMustPin', '1'); setTimeout(function () { ch.classList.add('open'); }, 300); }
      }).catch(function () {});
    }
    return p;
  };

  /* Inyectar email en registro y link de recuperar en login */
  function inject() {
    document.querySelectorAll('form').forEach(function (f) {
      var hasPin = f.querySelector('input[type="password"],input[inputmode="numeric"]');
      if (!hasPin) return;
      var isReg = /crear|registr/i.test(f.textContent) || f.querySelector('input[name="name"],#rName,#regName');
      if (isReg && !f.querySelector('#pkRegEmail')) {
        var em = document.createElement('input'); em.id = 'pkRegEmail'; em.type = 'email'; em.placeholder = 'Correo (para recuperar tu PIN)';
        hasPin.parentNode.insertBefore(em, hasPin.nextSibling);
      }
      if (!isReg && !f.querySelector('.pk-link')) {
        var l = document.createElement('span'); l.className = 'pk-link'; l.textContent = '¿Olvidaste tu PIN?';
        l.onclick = function () { fp.classList.add('open'); };
        f.appendChild(l);
      }
    });
    if (sessionStorage.getItem('pkMustPin') === '1') ch.classList.add('open');
  }
  new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject); else inject();
})();
