/* Lector de códigos de barras con la cámara.
   - Usa BarcodeDetector (Chrome/Android/Edge). Si el navegador no lo trae (iPhone/Safari, Firefox), carga ZXing local.
   - Los lectores USB/Bluetooth funcionan solos: escriben el código en el campo enfocado y envían Enter.
   Scanner.open({ title, continuous, onCode(code) -> string|void })  ·  onCode puede devolver un texto para mostrar. */
(function () {
  var FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code'];
  var st = null;

  function css() {
    if (document.getElementById('scnCss')) return;
    var s = document.createElement('style'); s.id = 'scnCss';
    s.textContent = '#scnBack{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.82);display:none;align-items:center;justify-content:center;padding:12px}' +
      '#scnBack.open{display:flex}#scnBox{width:100%;max-width:460px;background:var(--surface,#fff);color:var(--text,#111);border-radius:18px;padding:14px;box-shadow:0 20px 60px rgba(0,0,0,.5)}' +
      '#scnBox h3{margin:0 0 8px;font-size:1.05rem}#scnVideoWrap{position:relative;background:#000;border-radius:12px;overflow:hidden;aspect-ratio:4/3}' +
      '#scnVideo{width:100%;height:100%;object-fit:cover}#scnLine{position:absolute;left:8%;right:8%;top:50%;height:2px;background:#ef4444;box-shadow:0 0 8px #ef4444}' +
      '#scnMsg{min-height:20px;margin:8px 0;font-size:.9rem;font-weight:600}#scnRow{display:flex;gap:8px}#scnRow input{flex:1;min-width:0;padding:10px;border-radius:10px;border:1px solid var(--border,#ccc);background:var(--bg,#fff);color:inherit;font:inherit}' +
      '#scnRow button,#scnClose{padding:10px 14px;border-radius:10px;border:1px solid var(--border,#ccc);background:var(--brand,#1d4ed8);color:#fff;font:inherit;font-weight:700;cursor:pointer}#scnClose{background:transparent;color:inherit;width:100%;margin-top:8px}';
    document.head.appendChild(s);
  }
  function build() {
    if (document.getElementById('scnBack')) return;
    css();
    var d = document.createElement('div'); d.id = 'scnBack';
    d.innerHTML = '<div id="scnBox" role="dialog" aria-modal="true"><h3 id="scnTitle">Escanear código</h3>' +
      '<div id="scnVideoWrap"><video id="scnVideo" playsinline muted></video><div id="scnLine"></div></div>' +
      '<div id="scnMsg" aria-live="polite"></div>' +
      '<div id="scnRow"><input id="scnManual" placeholder="O escribe el código y Enter" inputmode="text" autocomplete="off"><button id="scnOk" type="button">OK</button></div>' +
      '<button id="scnClose" type="button">Cerrar</button></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) { if (e.target === d) close(); });
    document.getElementById('scnClose').onclick = close;
    document.getElementById('scnOk').onclick = manual;
    document.getElementById('scnManual').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); manual(); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st) close(); });
  }
  function msg(t, ok) { var m = document.getElementById('scnMsg'); if (m) { m.textContent = t || ''; m.style.color = ok === false ? 'var(--danger,#dc2626)' : ok ? 'var(--ok,#16a34a)' : 'inherit'; } }
  function manual() {
    var i = document.getElementById('scnManual'), v = i.value.trim(); if (!v) return;
    i.value = ''; handle(v, true);
  }
  function handle(code, force) {
    if (!st) return;
    var now = Date.now();
    // El mismo código solo cuenta de nuevo cuando se retiró de la cámara (≥1,2 s sin verlo): evita sumar de más si se queda enfrente
    var sameStillInView = !force && code === st.last && now - st.lastAt < 1200;
    st.lastAt = now;
    if (sameStillInView) return;
    st.last = code;
    if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) {}
    var cb = st.opts.onCode, res;
    try { res = cb && cb(code); } catch (e) { res = '⚠ ' + e.message; }
    Promise.resolve(res).then(function (t) {
      if (typeof t === 'string' && t) msg(t, !/^⚠/.test(t)); else msg('✔ ' + code, true);
      if (!st.opts.continuous) setTimeout(close, 350);
    });
  }
  function loadZxing() {
    return new Promise(function (ok, bad) {
      if (window.ZXing) return ok();
      var s = document.createElement('script'); s.src = '/vendor/zxing.min.js?v=1'; s.onload = ok; s.onerror = function () { bad(new Error('No se pudo cargar el lector')); };
      document.head.appendChild(s);
    });
  }
  async function start() {
    var video = document.getElementById('scnVideo');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg('Este navegador no permite usar la cámara. Escribe el código abajo.', false); return; }
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    } catch (e) { msg('No se pudo abrir la cámara (' + (e.name === 'NotAllowedError' ? 'permiso denegado' : e.message) + '). Escribe el código abajo.', false); return; }
    video.srcObject = st.stream; await video.play().catch(function () {});
    if ('BarcodeDetector' in window) {
      var det;
      try { var sup = await BarcodeDetector.getSupportedFormats(); det = new BarcodeDetector({ formats: FORMATS.filter(function (f) { return sup.indexOf(f) >= 0; }) }); } catch (e) { det = new BarcodeDetector(); }
      st.timer = setInterval(async function () {
        if (!st || video.readyState < 2) return;
        try { var r = await det.detect(video); if (r && r[0] && r[0].rawValue) handle(r[0].rawValue); } catch (e) {}
      }, 250);
      msg('Apunta la cámara al código de barras');
    } else {
      msg('Cargando lector…');
      try {
        await loadZxing();
        var Z = window.ZXing, hints = new Map();
        hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE]);
        st.reader = new Z.BrowserMultiFormatReader(hints, 300);
        st.reader.decodeFromStream(st.stream, video, function (res) { if (res && st) handle(res.getText()); });
        msg('Apunta la cámara al código de barras');
      } catch (e) { msg('⚠ ' + e.message + '. Escribe el código abajo.', false); }
    }
  }
  function open(opts) {
    build(); close();
    st = { opts: opts || {}, last: '', lastAt: 0 };
    document.getElementById('scnTitle').textContent = (opts && opts.title) || 'Escanear código';
    document.getElementById('scnBack').classList.add('open');
    msg(''); start();
    setTimeout(function () { var i = document.getElementById('scnManual'); if (i && matchMedia('(pointer:fine)').matches) i.focus(); }, 100);
  }
  function close() {
    var b = document.getElementById('scnBack'); if (b) b.classList.remove('open');
    if (!st) return;
    if (st.timer) clearInterval(st.timer);
    try { st.reader && st.reader.reset(); } catch (e) {}
    try { st.stream && st.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    var v = document.getElementById('scnVideo'); if (v) v.srcObject = null;
    st = null;
  }
  window.Scanner = { open: open, close: close };
})();
