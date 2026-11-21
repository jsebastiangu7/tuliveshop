/* Billeteras digitales: logos y selector (lo usan Configuración del admin y el modal de pago del cliente).
   Los logos se leen de /img/wallets/<id>.png. Si el archivo no existe se muestra una insignia con el nombre. */
(function () {
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); };
  var cache = null;

  /** Imagen del logo; si falla, se reemplaza por una insignia con el nombre (sin inventar logos). */
  function walletLogo(id, name, size) {
    size = size || 44;
    return '<span class="wlogo" style="width:' + size + 'px;height:' + size + 'px">' +
      '<img src="/img/wallets/' + esc(id) + '.png?v=1" alt="' + esc(name) + '" loading="lazy" ' +
      'onerror="this.parentNode.classList.add(\'nologo\');this.parentNode.setAttribute(\'data-n\',this.alt.slice(0,2));this.remove()"></span>';
  }

  async function loadCatalog() {
    if (cache) return cache;
    var r = await fetch('/api/products/wallet-catalog');
    if (!r.ok) throw new Error('No se pudo cargar el listado de billeteras');
    cache = await r.json();
    return cache;
  }

  /** Placeholder y etiqueta del campo según el tipo de billetera */
  function fieldInfo(w) {
    if (!w) return { label: 'Número o correo', ph: '' };
    if (w.kind === 'email') return { label: 'Correo de ' + w.name, ph: 'tucorreo@ejemplo.com' };
    if (w.kind === 'phone') return { label: 'Número de celular de ' + w.name, ph: 'Ej: 300 123 4567' };
    return { label: 'Número, correo o llave de ' + w.name, ph: 'Celular, correo o llave' };
  }

  /** Tarjeta para mostrar la billetera de la tienda (admin y cliente) */
  function walletCard(w, opts) {
    opts = opts || {};
    if (!w) return '';
    return '<div class="wcard">' + walletLogo(w.provider, w.name, opts.size || 52) +
      '<div class="wtxt"><div class="wname">' + esc(w.name) + '</div><div class="wval">' + esc(w.value) + '</div></div></div>';
  }

  window.Wallets = { logo: walletLogo, catalog: loadCatalog, fieldInfo: fieldInfo, card: walletCard };
})();
