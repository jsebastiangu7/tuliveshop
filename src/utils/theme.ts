const THEME_KEYS = ['bg', 'surface', 'primary', 'danger', 'success'];
const HEX6 = /^#[0-9a-f]{6}$/i;
/** Valida el tema: solo colores #RRGGBB (evita inyección de CSS). Devuelve null si no hay ningún modo válido. */
export function cleanTheme(t: any): any {
  if (!t || typeof t !== 'object') return null;
  const out: any = { v: 1 };
  let any = false;
  for (const m of ['light', 'dark']) {
    const src = t[m];
    if (!src || typeof src !== 'object') continue;
    if (!THEME_KEYS.every(k => typeof src[k] === 'string' && HEX6.test(src[k]))) return null;
    out[m] = {}; THEME_KEYS.forEach(k => { out[m][k] = String(src[k]).toUpperCase(); });
    any = true;
  }
  return any ? out : null;
}

/** Emoji permitido para el botón «Mis bolsitas» ('' = sin emoji). Sin configurar = 🛍️ */
export const BAGS_ICONS = ['', '🛍️', '🎁', '📦', '🛒', '🧺'];
export function bagsIcon(raw?: string | null): string { return raw === undefined || raw === null ? '🛍️' : (BAGS_ICONS.includes(raw) ? raw : '🛍️'); }
