import crypto from 'node:crypto';

/**
 * Fotos de producto: viven en SiteGround (media.tuliveshop.com), no en Render ni en la base de datos.
 * Render solo entrega un permiso firmado y de corta duración; el navegador sube la foto directo a SiteGround.
 *   MEDIA_UPLOAD_URL  p. ej. https://media.tuliveshop.com/upload.php
 *   MEDIA_BASE_URL    p. ej. https://media.tuliveshop.com
 *   MEDIA_SECRET      el mismo secreto que está en upload.php
 */
export const mediaBase = () => (process.env.MEDIA_BASE_URL || '').replace(/\/+$/, '');
export const mediaConfigured = () => !!(process.env.MEDIA_UPLOAD_URL && mediaBase() && process.env.MEDIA_SECRET);

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Permiso para UNA tienda y UNA acción (subir fotos o borrarlas todas), válido 10 minutos. */
export function signMediaToken(portfolioId: string, action: 'upload' | 'wipe' = 'upload'): string {
  const payload = b64url(JSON.stringify({ p: portfolioId, a: action, e: Math.floor(Date.now() / 1000) + 600 }));
  const sig = crypto.createHmac('sha256', process.env.MEDIA_SECRET || '').update(payload).digest('hex');
  return `${payload}.${sig}`;
}

/** Solo se aceptan direcciones de la propia carpeta de fotos (evita guardar enlaces externos). */
export function cleanImageUrl(v: unknown): { ok: true; url: string | null } | { ok: false; error: string } {
  const s = String(v ?? '').trim();
  if (!s) return { ok: true, url: null };
  const base = mediaBase();
  if (!base || !s.startsWith(base + '/products/') || s.length > 300 || /[\s"'<>]/.test(s))
    return { ok: false, error: 'Dirección de foto no válida' };
  return { ok: true, url: s };
}

/** Borra en SiteGround la carpeta de fotos de una tienda eliminada. Mejor esfuerzo: nunca hace fallar el borrado. */
export async function wipeStoreMedia(portfolioId: string): Promise<boolean> {
  if (!mediaConfigured()) return false;
  try {
    const fd = new FormData();
    fd.append('action', 'wipe');
    fd.append('token', signMediaToken(portfolioId, 'wipe'));
    const r = await fetch(process.env.MEDIA_UPLOAD_URL as string, { method: 'POST', body: fd, signal: AbortSignal.timeout(10000) });
    return r.ok;
  } catch (e) { console.error('wipeStoreMedia:', e); return false; }
}
