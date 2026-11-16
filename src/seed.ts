import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';

/**
 * Semilla inicial. YA NO lleva contraseñas ni correos escritos en el código (el repo es público).
 *
 * Variables de entorno (ponlas al ejecutar, no las subas a Git):
 *   SEED_SUPER_EMAIL       correo del super administrador          (obligatoria)
 *   SEED_ADMIN_EMAIL       correo de la administradora de la tienda (obligatoria)
 *   SEED_SUPER_PASSWORD    si no la pones, se genera una aleatoria y se muestra UNA vez
 *   SEED_ADMIN_PASSWORD    ídem
 *   SEED_STORE_NAME / SEED_STORE_SLUG / SEED_BREB_KEY / SEED_WHATSAPP  datos de la tienda
 *
 * Ejemplo:
 *   SEED_SUPER_EMAIL=tu@correo.com SEED_ADMIN_EMAIL=admin@correo.com \
 *   SEED_BREB_KEY=300xxxxxxx SEED_WHATSAPP=+57300xxxxxxx npm run seed
 *
 * Seguro de repetir: NO pisa contraseñas de usuarios que ya existen.
 */
const need = (k: string) => {
  const v = (process.env[k] || '').trim();
  if (!v) { console.error(`❌ Falta la variable ${k}`); process.exit(1); }
  return v;
};
const password = (envName: string): { value: string; generated: boolean } => {
  const v = (process.env[envName] || '').trim();
  return v ? { value: v, generated: false } : { value: randomBytes(9).toString('base64url') + '7*', generated: true };
};

async function seed() {
  console.log('🌱 Sembrando datos iniciales...');
  const superEmail = need('SEED_SUPER_EMAIL').toLowerCase();
  const adminEmail = need('SEED_ADMIN_EMAIL').toLowerCase();
  const brebKey = need('SEED_BREB_KEY');
  const whatsapp = need('SEED_WHATSAPP');
  const storeName = (process.env.SEED_STORE_NAME || 'Pandala Kawaii').trim();
  const storeSlug = (process.env.SEED_STORE_SLUG || 'tuliveshop').trim().toLowerCase();

  // 1) Tienda
  const { rows: [pf] } = await pool.query(
    `INSERT INTO portfolios (name, slug, bre_b_key, whatsapp_number, order_prefix, order_digits, order_start)
     VALUES ($1, $2, $3, $4, 'BOL', 5, 1)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [storeName, storeSlug, brebKey, whatsapp]);
  console.log(`✅ Tienda ${storeName} (${storeSlug}):`, pf.id);

  // 2) Super administrador (no se pisa su contraseña si ya existe)
  const sp = password('SEED_SUPER_PASSWORD');
  const { rowCount: superNew } = await pool.query(
    `INSERT INTO users (role, email, password_hash, name, status, must_change_password)
     VALUES ('super_admin', $1, $2, 'Super Administrador', 'Activo', TRUE)
     ON CONFLICT (email) DO NOTHING`,
    [superEmail, await bcrypt.hash(sp.value, 10)]);
  console.log(superNew ? `✅ Super Admin creado: ${superEmail}` : `ℹ️  Super Admin ya existía (contraseña intacta): ${superEmail}`);

  // 3) Administradora de la tienda
  const ap = password('SEED_ADMIN_PASSWORD');
  const { rowCount: adminNew } = await pool.query(
    `INSERT INTO users (portfolio_id, role, email, password_hash, whatsapp, name, status, must_change_password)
     VALUES ($1, 'admin', $2, $3, $4, 'Administradora', 'Activo', TRUE)
     ON CONFLICT (email) DO NOTHING`,
    [pf.id, adminEmail, await bcrypt.hash(ap.value, 10), whatsapp.replace(/\D/g, '')]);
  console.log(adminNew ? `✅ Admin creada: ${adminEmail}` : `ℹ️  Admin ya existía (contraseña intacta): ${adminEmail}`);

  // 4) Configuración de la tienda
  for (const [key, value] of [['inventory_reserve_hours', '12'], ['payment_confirm_hours', '48'], ['min_payment_amount', '10000']]) {
    await pool.query(
      `INSERT INTO settings (portfolio_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (portfolio_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [pf.id, key, value]);
  }

  // Contraseñas generadas: se muestran UNA vez. Guárdalas en tu gestor y cámbialas al entrar.
  if (superNew && sp.generated) console.log(`🔑 Contraseña del super admin (guárdala ahora): ${sp.value}`);
  if (adminNew && ap.generated) console.log(`🔑 Contraseña de la admin (guárdala ahora): ${ap.value}`);
  await pool.end();
  console.log('🎉 Semilla completada.');
}

seed().catch((e) => { console.error('❌ Error en la semilla:', e); process.exit(1); });
