/* Tu Live Shop · Motor de diseño
   El administrador elige 5 colores por modo (fondo, superficie, primario, peligro, éxito);
   el resto se deriva aquí. Valores iniciales = Opción A.
   Uso: TLSTheme.apply(theme) · TLSTheme.check(mode, colors) · TLSTheme.DEFAULTS */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TLSTheme = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    light: { bg: '#F6F7F9', surface: '#FFFFFF', primary: '#2563EB', danger: '#DC2626', success: '#16A34A' },
    dark:  { bg: '#0B1220', surface: '#111A2B', primary: '#3B82F6', danger: '#F87171', success: '#34D399' }
  };
  var WARN = { light: '#D97706', dark: '#FBBF24' };
  var KEYS = ['bg', 'surface', 'primary', 'danger', 'success'];
  var HEX = /^#[0-9a-f]{6}$/i;
  var LS = 'tlsThemeCache:';

  function norm(h) { return String(h || '').trim().toUpperCase(); }
  function rgb(h) { h = norm(h); return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function hex(a) {
    return '#' + a.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join('').toUpperCase();
  }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return hex([0, 1, 2].map(function (i) { return x[i] * (1 - t) + y[i] * t; })); }
  function lum(h) {
    var c = rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
  function rgba(h, a) { var c = rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function dist(a, b) { var x = rgb(a), y = rgb(b); return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2)); }

  function full(mode, c) {
    var d = DEFAULTS[mode === 'dark' ? 'dark' : 'light'], o = {};
    KEYS.forEach(function (k) { o[k] = HEX.test((c || {})[k] || '') ? norm(c[k]) : d[k]; });
    return o;
  }
  function onColor(bg) { return contrast('#FFFFFF', bg) >= contrast('#0B1220', bg) ? '#FFFFFF' : '#0B1220'; }
  function pickText(bg, surface) {
    var best = '#111827', bs = -1;
    ['#111827', '#F1F5F9'].forEach(function (t) {
      var s = Math.min(contrast(t, bg), contrast(t, surface));
      if (s > bs) { bs = s; best = t; }
    });
    return best;
  }

  /* Deriva todas las variables a partir de los 5 colores */
  function derive(mode, colors) {
    var c = full(mode, colors), dark = mode === 'dark';
    var text = pickText(c.bg, c.surface);
    var muted = mix(text, c.bg, 0.40);
    for (var i = 0; i < 8 && Math.min(contrast(muted, c.bg), contrast(muted, c.surface)) < 4.5; i++) muted = mix(muted, text, 0.35);
    var v = {
      '--bg': c.bg, '--bg-gradient': 'none',
      '--surface': c.surface,
      '--surface-hover': mix(c.surface, text, 0.06),
      '--border': mix(c.surface, text, 0.11),
      '--thead-bg': mix(c.surface, text, 0.05),
      '--text': text, '--text-muted': muted, '--muted': muted,
      '--brand': c.primary, '--brand-solid': c.primary,
      '--brand-hover': mix(c.primary, dark ? '#FFFFFF' : '#000000', 0.12),
      '--brand-glow': rgba(c.primary, 0.30),
      '--ok': c.success, '--danger': c.danger, '--warn': WARN[dark ? 'dark' : 'light'],
      '--on-brand': onColor(c.primary), '--on-danger': onColor(c.danger), '--on-ok': onColor(c.success),
      '--btn-bg': rgba(text, 0.07), '--btn-bg-hover': rgba(text, 0.12), '--btn-border': rgba(text, 0.14),
      '--shadow': dark ? '0 1px 2px rgba(0,0,0,.35)' : '0 1px 2px rgba(15,23,42,.08)'
    };
    /* Cristal líquido: reflejos, bordes y fondo con manchas de color derivadas de la paleta */
    var warn = WARN[dark ? 'dark' : 'light'];
    var a = dark ? 0.34 : 0.30;
    v['--g-hi'] = dark ? 'rgba(255,255,255,.15)' : 'rgba(255,255,255,.72)';
    v['--g-lo'] = dark ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.16)';
    v['--g-edge'] = dark ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.60)';
    v['--g-shadow'] = dark ? '0 10px 40px rgba(0,0,0,.40)' : '0 10px 36px ' + rgba(c.primary, 0.14);
    v['--g-fill'] = dark ? '50%' : '62%';
    v['--g-blur'] = '24px';
    v['--glass-bg'] =
      'radial-gradient(60vmax 50vmax at 8% 0%,' + rgba(c.primary, a) + ',transparent 62%),' +
      'radial-gradient(55vmax 45vmax at 95% 8%,' + rgba(warn, a * 0.85) + ',transparent 60%),' +
      'radial-gradient(60vmax 50vmax at 85% 100%,' + rgba(mix(c.primary, c.success, 0.5), a) + ',transparent 62%),' +
      'radial-gradient(50vmax 45vmax at 0% 95%,' + rgba(mix(c.primary, c.danger, 0.5), a * 0.8) + ',transparent 60%),' + c.bg;
    v['--brand-light'] = mix(c.primary, '#FFFFFF', 0.12);
    return v;
  }

  /* Alertas de contraste: {level:'error'|'warn', msg} */
  function check(mode, colors) {
    var c = full(mode, colors), v = derive(mode, c), out = [];
    var t = v['--text'], r1 = contrast(t, c.bg), r2 = contrast(t, c.surface);
    if (r1 < 4.5 || r2 < 4.5) {
      var opp = (lum(c.bg) > 0.4) !== (lum(c.surface) > 0.4);
      out.push({ level: 'error', msg: opp
        ? 'El fondo y la superficie son de tonos opuestos (uno claro y otro oscuro): ningún color de texto se lee bien sobre ambos.'
        : 'El texto se leería mal (contraste ' + Math.min(r1, r2).toFixed(2) + ':1, mínimo 4.5:1). Aleja el fondo/superficie del tono medio.' });
    }
    [['primary', 'primario', '--on-brand'], ['danger', 'peligro', '--on-danger'], ['success', 'éxito', '--on-ok']].forEach(function (b) {
      var r = contrast(v[b[2]], c[b[0]]);
      if (r < 4.5) out.push({ level: 'error', msg: 'El texto de los botones "' + b[1] + '" no se lee (contraste ' + r.toFixed(2) + ':1, mínimo 4.5:1). Usa un tono más claro u oscuro.' });
      var rb = Math.min(contrast(c[b[0]], c.bg), contrast(c[b[0]], c.surface));
      if (rb < 3) out.push({ level: 'warn', msg: 'El botón "' + b[1] + '" casi se confunde con el fondo (contraste ' + rb.toFixed(1) + ':1, recomendado 3:1).' });
    });
    if (contrast(c.bg, c.surface) < 1.03) out.push({ level: 'warn', msg: 'Fondo y superficie son casi idénticos: las tarjetas no se distinguirán (solo las separará el borde).' });
    if (dist(c.primary, c.danger) < 80) out.push({ level: 'warn', msg: 'Primario y peligro son muy parecidos: el usuario podría confundir "guardar" con "eliminar".' });
    return out;
  }

  function sanitize(theme) {
    if (!theme || typeof theme !== 'object') return null;
    var o = { v: 1 }, any = false;
    if (theme.style === 'flat' || theme.style === 'glass') o.style = theme.style;
    ['light', 'dark'].forEach(function (m) {
      if (!theme[m] || typeof theme[m] !== 'object') return;
      var s = {}, ok = true;
      KEYS.forEach(function (k) { if (HEX.test(theme[m][k] || '')) s[k] = norm(theme[m][k]); else ok = false; });
      if (ok) { o[m] = s; any = true; }
    });
    return any ? o : null;
  }

  function block(sel, vars) {
    return sel + '{' + Object.keys(vars).map(function (k) { return k + ':' + vars[k]; }).join(';') + '}';
  }
  function buildCss(theme) {
    var t = sanitize(theme) || {};
    return block('html[data-theme="light"]', derive('light', t.light)) + '\n' + block('html[data-theme="dark"]', derive('dark', t.dark));
  }

  function styleEl() {
    var el = document.getElementById('tls-theme-vars');
    if (!el) { el = document.createElement('style'); el.id = 'tls-theme-vars'; (document.head || document.documentElement).appendChild(el); }
    return el;
  }
  function setStyle(st) { try { document.documentElement.setAttribute('data-style', st === 'flat' ? 'flat' : 'glass'); } catch (e) {} }
  function apply(theme) { styleEl().textContent = buildCss(theme); var t = sanitize(theme); setStyle(t && t.style); }
  function reset() { var el = document.getElementById('tls-theme-vars'); if (el) el.remove(); setStyle('glass'); }
  function cacheGet(slug) { try { return sanitize(JSON.parse(localStorage.getItem(LS + slug))); } catch (e) { return null; } }
  function cacheSet(slug, theme) {
    try { if (theme) localStorage.setItem(LS + slug, JSON.stringify(theme)); else localStorage.removeItem(LS + slug); } catch (e) {}
  }

  return { DEFAULTS: DEFAULTS, KEYS: KEYS, derive: derive, check: check, sanitize: sanitize, buildCss: buildCss,
    apply: apply, reset: reset, contrast: contrast, cacheGet: cacheGet, cacheSet: cacheSet, full: full };
});
