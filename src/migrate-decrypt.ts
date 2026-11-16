/**
 * Migración ÚNICA: devuelve a texto plano el WhatsApp y el correo que el registro guardó cifrados,
 * para que el login y "olvidé mi PIN" los encuentren.
 *
 *   1) Haz un respaldo de la base de datos.
 *   2) Con ENCRYPTION_KEY puesta (la misma que usaba el servidor):  npx tsx src/migrate-decrypt.ts
 *   3) Es seguro repetirla: solo toca valores que parecen cifrados.
 */
import { pool } from './db.js';
import { decrypt, looksEncrypted } from './utils/encryption.js';

async function main() {
  const { rows } = await pool.query(`SELECT id, whatsapp, email FROM users WHERE role = 'client'`);
  let fixed = 0, failed = 0;
  for (const u of rows) {
    const wEnc = looksEncrypted(u.whatsapp), eEnc = looksEncrypted(u.email);
    if (!wEnc && !eEnc) continue;
    const wa = wEnc ? decrypt(u.whatsapp) : u.whatsapp;
    const em = eEnc ? decrypt(u.email) : u.email;
    if ((wEnc && !wa) || (eEnc && !em)) { failed++; console.warn('⚠️  No se pudo descifrar el usuario', u.id); continue; }
    try {
      await pool.query(`UPDATE users SET whatsapp = $2, email = $3 WHERE id = $1`, [u.id, wa, em]);
      fixed++;
    } catch (e: any) {
      failed++; console.warn('⚠️  Conflicto al actualizar', u.id, e.message); // p. ej. ya existe otro cliente con ese WhatsApp
    }
  }
  console.log(`✅ Recuperados: ${fixed} · ⚠️ con problema: ${failed}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
