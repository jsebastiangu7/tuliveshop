import { pool } from './db.js';
import bcrypt from 'bcryptjs';

async function seed() {
  console.log('🌱 Sembrando datos iniciales...');

  // 1) Portafolio: Pandala Kawaii (enlace tuliveshop)
  const { rows: [pf] } = await pool.query(
    `INSERT INTO portfolios (name, slug, bre_b_key, whatsapp_number, order_prefix, order_digits, order_start)
     VALUES ('Pandala Kawaii', 'tuliveshop', '3058173611', '+573058173611', 'BOL', 5, 1)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  console.log('✅ Portafolio Pandala Kawaii (tuliveshop):', pf.id);

  // 2) Super administrador
  const superHash = await bcrypt.hash('SuperAdm123*', 10);
  await pool.query(
    `INSERT INTO users (role, email, password_hash, name, status)
     VALUES ('super_admin', $1, $2, 'Super Administrador', 'Activo')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    ['jsebastiangu7@gmail.com', superHash],
  );
  console.log('✅ Super Admin: jsebastiangu7@gmail.com');

  // 3) Administradora Mar
  const adminHash = await bcrypt.hash('Admin123*', 10);
  await pool.query(
    `INSERT INTO users (portfolio_id, role, email, password_hash, whatsapp, name, status)
     VALUES ($1, 'admin', $2, $3, $4, 'Mar', 'Activo')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, portfolio_id = EXCLUDED.portfolio_id`,
    [pf.id, 'pandalakwaii@gmail.com', adminHash, '573058173611'],
  );
  console.log('✅ Admin Mar: pandalakwaii@gmail.com');

  // 4) Configuración del portafolio
  for (const [key, value] of [
    ['inventory_reserve_hours', '12'],
    ['payment_confirm_hours', '48'],
    ['min_payment_amount', '10000'],
  ]) {
    await pool.query(
      `INSERT INTO settings (portfolio_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (portfolio_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [pf.id, key, value],
    );
  }
  console.log('✅ Configuración: reserva 12 h · confirmación 48 h · abono mínimo $10.000');

  await pool.end();
  console.log('🎉 Semilla completada. Ya puedes iniciar sesión.');
}

seed().catch((e) => { console.error('❌ Error en la semilla:', e); process.exit(1); });