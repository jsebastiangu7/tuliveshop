import { pool } from './db.js';

/** Cambios de esquema idempotentes: se ejecutan al arrancar y no tocan datos existentes. */
export async function ensureSchema() {
  // Documento de identidad del administrador de cada tienda (se guarda en la base: el disco de Render es efímero)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_documents (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL,
      portfolio_id UUID,
      file_name   TEXT NOT NULL,
      mime_type   TEXT NOT NULL,
      size_bytes  INTEGER NOT NULL,
      data        BYTEA NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS admin_documents_user_idx ON admin_documents (user_id)`);
  // Constancia de la autorización del titular (Ley 1581 de 2012): fecha y versión de la política aceptada
  await pool.query(`ALTER TABLE admin_documents ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE admin_documents ADD COLUMN IF NOT EXISTS consent_version TEXT`);
  // Foto del producto (URL en media.tuliveshop.com)
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT`);
  // Productos agregados DESPUÉS del primer abono: confirmed=false hasta que el cliente los confirme (mientras tanto puede quitarlos).
  // Las filas existentes quedan confirmed=true (bloqueadas como hoy).
  await pool.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS confirmed BOOLEAN NOT NULL DEFAULT TRUE`);
  // Tienda oculta para los clientes (la maneja el superadministrador)
  await pool.query(`ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE`);
  // Reservas de productos agotados (cola de solicitudes de los clientes)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      portfolio_id UUID NOT NULL,
      client_id    UUID NOT NULL,
      product_id   UUID,
      kit_id       UUID,
      quantity     INTEGER NOT NULL DEFAULT 1,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at  TIMESTAMPTZ
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS reservations_portfolio_idx ON reservations (portfolio_id, status)`);

  // Notificaciones push: un token de celular por usuario (un cliente con varias tiendas tiene un usuario por tienda)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_tokens (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID NOT NULL,
      portfolio_id UUID,
      role         TEXT NOT NULL,
      token        TEXT NOT NULL,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, token)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS device_tokens_portfolio_idx ON device_tokens (portfolio_id, role)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS device_tokens_token_idx ON device_tokens (token)`);
  // Último "Anunciar Live" de la tienda (límite de 1 cada 10 minutos)
  await pool.query(`ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS last_live_push_at TIMESTAMPTZ`);
}
