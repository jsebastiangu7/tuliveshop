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
}
