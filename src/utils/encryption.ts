import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Cifrado AES-256-CBC (compatible con los datos ya guardados).
 *
 * IMPORTANTE: WhatsApp y correo de los clientes se guardan en TEXTO PLANO porque son la llave de
 * login y de búsqueda (login, "olvidé mi PIN", importación). Este módulo queda para datos que
 * realmente necesiten cifrado y para LEER registros antiguos cifrados (ver src/migrate-decrypt.ts).
 */
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const LEGACY_FALLBACK = 'fallback_key_32_characters_long!!'; // solo para descifrar datos viejos

/** Clave para CIFRAR: obligatoria, sin valor por defecto */
function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('Falta ENCRYPTION_KEY: defínela en las variables de entorno (Render).');
  return scryptSync(secret, 'salt', 32);
}

/** Claves candidatas para DESCIFRAR: la actual y, si no hay, la antigua (con aviso) */
function decryptKeys(): Buffer[] {
  const keys: Buffer[] = [];
  if (process.env.ENCRYPTION_KEY) keys.push(scryptSync(process.env.ENCRYPTION_KEY, 'salt', 32));
  keys.push(scryptSync(LEGACY_FALLBACK, 'salt', 32));
  return keys;
}

export function encrypt(text: string): string {
  if (!text) return '';
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/** ¿Parece un valor cifrado por este módulo? (iv de 32 hex : datos hex) */
export function looksEncrypted(v: string): boolean {
  return /^[0-9a-f]{32}:[0-9a-f]+$/i.test(String(v || ''));
}

/**
 * Descifra. Si el valor NO está cifrado (texto plano) lo devuelve tal cual, así el panel
 * muestra bien tanto clientes importados como los que el registro guardó cifrados.
 * Si está cifrado y ninguna clave sirve, devuelve '' (no rompe la pantalla).
 */
export function decrypt(value: string): string {
  if (!value) return '';
  if (!looksEncrypted(value)) return value;
  const [ivHex, encrypted] = value.split(':') as [string, string];
  for (const key of decryptKeys()) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
      let out = decipher.update(encrypted, 'hex', 'utf8');
      out += decipher.final('utf8');
      return out;
    } catch { /* probar la siguiente clave */ }
  }
  return '';
}
