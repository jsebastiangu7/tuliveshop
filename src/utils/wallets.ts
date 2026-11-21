/**
 * Billeteras digitales por país (Latinoamérica). Solo billeteras / pagos por celular o correo.
 * Esta lista es la fuente de verdad: el servidor solo acepta países y billeteras de aquí.
 * `kind`: phone = número de celular · email = correo · any = celular, correo o llave (Bre-B, Pix…)
 * El logo de cada billetera se busca en /img/wallets/<id>.png (si no existe se muestra una insignia con el nombre).
 */
export type WalletKind = 'phone' | 'email' | 'any';
export interface Wallet { id: string; name: string; kind: WalletKind }
export interface Country { code: string; name: string; flag: string; wallets: string[] }

export const WALLETS: Record<string, Wallet> = {
  'bre-b':       { id: 'bre-b',       name: 'Bre-B',          kind: 'any' },
  'nequi':       { id: 'nequi',       name: 'Nequi',          kind: 'phone' },
  'daviplata':   { id: 'daviplata',   name: 'Daviplata',      kind: 'phone' },
  'mercadopago': { id: 'mercadopago', name: 'Mercado Pago',   kind: 'any' },
  'dimo':        { id: 'dimo',        name: 'DiMo',           kind: 'phone' },
  'yape':        { id: 'yape',        name: 'Yape',           kind: 'phone' },
  'plin':        { id: 'plin',        name: 'Plin',           kind: 'phone' },
  'deuna':       { id: 'deuna',       name: 'DeUna',          kind: 'phone' },
  'payphone':    { id: 'payphone',    name: 'PayPhone',       kind: 'phone' },
  'mach':        { id: 'mach',        name: 'MACH',           kind: 'any' },
  'tenpo':       { id: 'tenpo',       name: 'Tenpo',          kind: 'any' },
  'uala':        { id: 'uala',        name: 'Ualá',           kind: 'any' },
  'naranjax':    { id: 'naranjax',    name: 'Naranja X',      kind: 'any' },
  'pix':         { id: 'pix',         name: 'Pix',            kind: 'any' },
  'picpay':      { id: 'picpay',      name: 'PicPay',         kind: 'any' },
  'tigomoney':   { id: 'tigomoney',   name: 'Tigo Money',     kind: 'phone' },
  'yappy':       { id: 'yappy',       name: 'Yappy',          kind: 'phone' },
  'sinpe':       { id: 'sinpe',       name: 'SINPE Móvil',    kind: 'phone' },
  'prex':        { id: 'prex',        name: 'Prex',           kind: 'any' },
  'midinero':    { id: 'midinero',    name: 'MiDinero',       kind: 'phone' },
  'zinli':       { id: 'zinli',       name: 'Zinli',          kind: 'any' },
  'pagomovil':   { id: 'pagomovil',   name: 'Pago Móvil',     kind: 'phone' },
  'paypal':      { id: 'paypal',      name: 'PayPal',         kind: 'email' },
};

/** PayPal se ofrece en todos los países. */
export const GLOBAL_WALLETS = ['paypal'];

export const COUNTRIES: Country[] = [
  { code: 'CO', flag: '🇨🇴', name: 'Colombia',           wallets: ['bre-b', 'nequi', 'daviplata'] },
  { code: 'MX', flag: '🇲🇽', name: 'México',             wallets: ['mercadopago', 'dimo'] },
  { code: 'PE', flag: '🇵🇪', name: 'Perú',               wallets: ['yape', 'plin'] },
  { code: 'EC', flag: '🇪🇨', name: 'Ecuador',            wallets: ['deuna', 'payphone'] },
  { code: 'CL', flag: '🇨🇱', name: 'Chile',              wallets: ['mercadopago', 'mach', 'tenpo'] },
  { code: 'AR', flag: '🇦🇷', name: 'Argentina',          wallets: ['mercadopago', 'uala', 'naranjax'] },
  { code: 'BR', flag: '🇧🇷', name: 'Brasil',             wallets: ['pix', 'picpay', 'mercadopago'] },
  { code: 'UY', flag: '🇺🇾', name: 'Uruguay',            wallets: ['mercadopago', 'prex', 'midinero'] },
  { code: 'BO', flag: '🇧🇴', name: 'Bolivia',            wallets: ['tigomoney'] },
  { code: 'PY', flag: '🇵🇾', name: 'Paraguay',           wallets: ['tigomoney'] },
  { code: 'VE', flag: '🇻🇪', name: 'Venezuela',          wallets: ['pagomovil', 'zinli'] },
  { code: 'PA', flag: '🇵🇦', name: 'Panamá',             wallets: ['yappy', 'zinli'] },
  { code: 'CR', flag: '🇨🇷', name: 'Costa Rica',         wallets: ['sinpe'] },
  { code: 'GT', flag: '🇬🇹', name: 'Guatemala',          wallets: ['tigomoney'] },
  { code: 'HN', flag: '🇭🇳', name: 'Honduras',           wallets: ['tigomoney'] },
  { code: 'SV', flag: '🇸🇻', name: 'El Salvador',        wallets: ['tigomoney'] },
  { code: 'DO', flag: '🇩🇴', name: 'República Dominicana', wallets: ['zinli'] },
  { code: 'XX', flag: '🌎', name: 'Otro país / Internacional', wallets: ['zinli'] },
];

/** Catálogo listo para el navegador: cada país con sus billeteras (incluida PayPal). */
export function catalog() {
  return {
    countries: COUNTRIES.map(c => ({
      code: c.code, name: c.name, flag: c.flag,
      wallets: [...c.wallets, ...GLOBAL_WALLETS.filter(g => !c.wallets.includes(g))].map(id => WALLETS[id]!),
    })),
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Valida {country, provider, value}. */
export function cleanWallet(w: any):
  { ok: true; wallet: { country: string; provider: string; value: string } } | { ok: false; error: string } {
  const country = String(w?.country || '').toUpperCase();
  const provider = String(w?.provider || '');
  const value = String(w?.value || '').trim().replace(/\s+/g, ' ');
  const c = COUNTRIES.find(x => x.code === country);
  if (!c) return { ok: false, error: 'País no válido' };
  const allowed = [...c.wallets, ...GLOBAL_WALLETS];
  if (!allowed.includes(provider) || !WALLETS[provider]) return { ok: false, error: 'Billetera no disponible para ese país' };
  const kind = WALLETS[provider]!.kind;
  if (!value) return { ok: false, error: 'Escribe el número o correo de la billetera' };
  if (value.length > 60) return { ok: false, error: 'El dato es demasiado largo' };
  const digits = value.replace(/\D/g, '');
  const isMail = EMAIL.test(value);
  if (kind === 'email' && !isMail) return { ok: false, error: 'Escribe un correo válido' };
  if (kind === 'phone' && !(/^[+\d\s()-]+$/.test(value) && digits.length >= 7 && digits.length <= 15))
    return { ok: false, error: 'Escribe un número de celular válido (7 a 15 dígitos)' };
  if (kind === 'any' && !isMail && !/^[\w.+@\-\s()]{3,60}$/.test(value)) return { ok: false, error: 'Escribe un número, correo o llave válido' };
  return { ok: true, wallet: { country, provider, value } };
}

/** Billetera efectiva: el setting guarda {country, provider}; el dato (número/correo) vive en portfolios.bre_b_key.
 *  Si la tienda es antigua (sin setting) se asume Bre-B en Colombia. */
export function effectiveWallet(raw: string | undefined, legacyKey: string | null | undefined) {
  let w: any = null;
  try { w = raw ? JSON.parse(raw) : null; } catch { /* ignorar */ }
  const value = String(legacyKey || '').trim();
  const base = w && WALLETS[w.provider] ? w : (value ? { country: 'CO', provider: 'bre-b' } : null);
  if (!base || !value) return null;
  const def = WALLETS[base.provider]!;
  return { country: base.country, provider: def.id, name: def.name, kind: def.kind, value };
}
