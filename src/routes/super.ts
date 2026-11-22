import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { wipeStoreMedia } from '../utils/media.js';

const router = Router();

const DOC_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_DOC = 5 * 1024 * 1024; // 5 MB
const DATA_POLICY_VERSION = '2026-11-20'; // versión de la Política de Tratamiento de Datos Personales aceptada

/** Valida y decodifica el documento recibido como { name, type, data(base64) } */
function parseDoc(doc: any) {
  if (!doc) return null;
  if (doc.consent !== true) throw new Error('Confirma que el titular autorizó el tratamiento de su documento de identidad');
  const type = String(doc.type || '').toLowerCase();
  if (!DOC_TYPES[type]) throw new Error('El documento debe ser PDF, JPG o PNG');
  const b64 = String(doc.data || '').replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new Error('El documento está vacío');
  if (buf.length > MAX_DOC) throw new Error('El documento supera los 5 MB');
  const name = String(doc.name || 'documento').replace(/[^\w.\- ]/g, '_').slice(0, 120);
  return { name, type, buf };
}

async function saveDoc(db: any, userId: string, portfolioId: string, d: { name: string; type: string; buf: Buffer }) {
  await db.query(`DELETE FROM admin_documents WHERE user_id = $1`, [userId]); // un documento vigente por administrador
  await db.query(
    `INSERT INTO admin_documents (user_id, portfolio_id, file_name, mime_type, size_bytes, data, consent_at, consent_version) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)`,
    [userId, portfolioId, d.name, d.type, d.buf.length, d.buf, DATA_POLICY_VERSION]);
}

// Todo lo de este archivo es exclusivo del Super administrador
router.use(authenticate, requireRole('super_admin'));

/* ── Tiendas (portafolios) ── */
router.get('/portfolios', async (_req: AuthRequest, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.slug, p.bre_b_key, p.whatsapp_number, p.order_prefix, p.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.portfolio_id = p.id AND u.role = 'admin')::int AS admins,
        (SELECT COUNT(*) FROM users u WHERE u.portfolio_id = p.id AND u.role = 'client')::int AS clients,
        (SELECT COUNT(*) FROM products pr WHERE pr.portfolio_id = p.id)::int AS products,
        (SELECT COUNT(*) FROM orders o WHERE o.portfolio_id = p.id)::int AS orders
       FROM portfolios p ORDER BY p.created_at`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.post('/portfolios', async (req: AuthRequest, res) => {
  const { name, slug, bre_b_key, whatsapp_number, order_prefix, admin } = req.body;
  const cleanSlug = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!String(name || '').trim()) return res.status(400).json({ error: 'El nombre de la tienda es obligatorio' });
  // Sin valores por defecto: antes una tienda nueva cobraba en el Bre-b/WhatsApp de otra tienda
  if (!String(bre_b_key || '').trim()) return res.status(400).json({ error: 'La llave Bre-b de la tienda es obligatoria' });
  if (!String(whatsapp_number || '').trim()) return res.status(400).json({ error: 'El WhatsApp de la tienda es obligatorio' });
  if (!/^[a-z0-9-]{3,30}$/.test(cleanSlug)) return res.status(400).json({ error: 'El enlace debe tener 3-30 caracteres (a-z, 0-9, guiones)' });

  // Administrador de la tienda (opcional aquí; el formulario lo exige junto con su documento)
  let adm: any = null, doc: any = null;
  try {
    if (admin && (admin.name || admin.email || admin.password)) {
      const aname = String(admin.name || '').trim(), mail = String(admin.email || '').toLowerCase().trim();
      if (!aname || !/^\S+@\S+\.\S+$/.test(mail)) throw new Error('Indica el nombre y un correo válido del administrador');
      if (String(admin.password || '').length < 8) throw new Error('La contraseña del administrador debe tener mínimo 8 caracteres');
      adm = { name: aname, mail, password: String(admin.password) };
      doc = parseDoc(admin.id_document);
    }
  } catch (e: any) { return res.status(400).json({ error: e.message }); }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: [dup] } = await db.query(`SELECT id FROM portfolios WHERE slug = $1`, [cleanSlug]);
    if (dup) { await db.query('ROLLBACK'); return res.status(400).json({ error: 'Ese enlace ya está en uso por otra tienda' }); }
    if (adm) {
      const { rows: [d2] } = await db.query(`SELECT id FROM users WHERE email = $1`, [adm.mail]);
      if (d2) { await db.query('ROLLBACK'); return res.status(400).json({ error: 'Ese correo ya está registrado' }); }
    }
    const { rows: [pf] } = await db.query(
      `INSERT INTO portfolios (name, slug, bre_b_key, whatsapp_number, order_prefix)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [String(name).trim(), cleanSlug, String(bre_b_key).trim(), String(whatsapp_number).trim(),
       String(order_prefix || 'BOL').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'BOL']);
    for (const [key, value] of [['inventory_reserve_hours', '12'], ['payment_confirm_hours', '48'], ['min_payment_amount', '10000']]) {
      await db.query(
        `INSERT INTO settings (portfolio_id, key, value) VALUES ($1, $2, $3)
         ON CONFLICT (portfolio_id, key) DO UPDATE SET value = EXCLUDED.value`,
        [pf.id, key, value]);
    }
    let adminOut: any = null;
    if (adm) {
      const hash = await bcrypt.hash(adm.password, 10);
      const { rows: [u] } = await db.query(
        `INSERT INTO users (portfolio_id, role, email, password_hash, name, status)
         VALUES ($1, 'admin', $2, $3, $4, 'Activo') RETURNING id, name, email, status`,
        [pf.id, adm.mail, hash, adm.name]);
      if (doc) await saveDoc(db, u.id, pf.id, doc);
      adminOut = { ...u, has_document: !!doc };
    }
    await db.query('COMMIT');
    res.json({ ...pf, admin: adminOut });
  } catch (e: any) {
    try { await db.query('ROLLBACK'); } catch { /* ya cerrada */ }
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear la tienda: ' + e.message });
  } finally { db.release(); }
});

router.put('/portfolios/:id', async (req: AuthRequest, res) => {
  try {
    const { name, bre_b_key, whatsapp_number, order_prefix, whatsapp_template } = req.body;
    const { rows: [pf] } = await pool.query(
      `UPDATE portfolios SET
         name = COALESCE(NULLIF($2, ''), name),
         bre_b_key = COALESCE(NULLIF($3, ''), bre_b_key),
         whatsapp_number = COALESCE(NULLIF($4, ''), whatsapp_number),
         order_prefix = COALESCE(NULLIF($5, ''), order_prefix),
         whatsapp_template = COALESCE($6, whatsapp_template)
       WHERE id = $1 RETURNING *`,
      [req.params.id, String(name || '').trim(), String(bre_b_key || '').trim(), String(whatsapp_number || '').trim(),
       String(order_prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
       whatsapp_template !== undefined ? String(whatsapp_template) : null]);
    if (!pf) return res.status(404).json({ error: 'Portafolio no encontrado' });
    res.json(pf);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ── Eliminar una tienda y TODA su información (irreversible) ── */
router.delete('/portfolios/:id', async (req: AuthRequest, res) => {
  const id = String(req.params.id || '');
  if (String(req.body?.confirmText ?? '') !== 'Borrar tienda') return res.status(400).json({ error: 'Texto de confirmación incorrecto' });
  const db = await pool.connect();
  try {
    const { rows: [pf] } = await db.query(`SELECT id, name FROM portfolios WHERE id = $1`, [id]);
    if (!pf) return res.status(404).json({ error: 'Tienda no encontrada' });
    const { rows: [sa] } = await db.query(`SELECT 1 FROM users WHERE portfolio_id = $1 AND role = 'super_admin' LIMIT 1`, [id]);
    if (sa) return res.status(400).json({ error: 'Esta tienda contiene una cuenta de superadministrador y no se puede eliminar' });
    await db.query('BEGIN');
    const del = async (sql: string) => (await db.query(sql, [id])).rowCount ?? 0;
    await del(`DELETE FROM shipments WHERE portfolio_id=$1`);
    await del(`DELETE FROM payments WHERE portfolio_id=$1`);
    await del(`DELETE FROM payment_reports WHERE portfolio_id=$1`);
    await del(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE portfolio_id=$1)`);
    const orders = await del(`DELETE FROM orders WHERE portfolio_id=$1`);
    await del(`DELETE FROM kit_components WHERE kit_id IN (SELECT id FROM kits WHERE portfolio_id=$1)`);
    await del(`DELETE FROM kits WHERE portfolio_id=$1`);
    const products = await del(`DELETE FROM products WHERE portfolio_id=$1`);
    await del(`DELETE FROM categories WHERE portfolio_id=$1`);
    await del(`DELETE FROM goal_payments WHERE portfolio_id=$1`);
    await del(`DELETE FROM goals WHERE portfolio_id=$1`);
    await del(`DELETE FROM donations WHERE portfolio_id=$1`);
    await del(`DELETE FROM settings WHERE portfolio_id=$1`);
    await del(`DELETE FROM admin_documents WHERE portfolio_id=$1 OR user_id IN (SELECT id FROM users WHERE portfolio_id=$1)`);
    const users = await del(`DELETE FROM users WHERE portfolio_id=$1`);
    await del(`DELETE FROM portfolios WHERE id=$1`);
    await db.query('COMMIT');
    const media = await wipeStoreMedia(id);
    console.log(`Tienda eliminada por super_admin: ${pf.name} (${id})`);
    res.json({ ok: true, name: pf.name, deleted: { users, products, orders }, photos_removed: media });
  } catch (e: any) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('ERROR borrar tienda:', e);
    res.status(500).json({ error: 'No se pudo eliminar la tienda (no se borró nada): ' + (e.message || 'error') });
  } finally { db.release(); }
});

/* ── Administradores de cada tienda ── */
router.get('/portfolios/:id/admins', async (req: AuthRequest, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.status, u.created_at,
              EXISTS (SELECT 1 FROM admin_documents d WHERE d.user_id = u.id) AS has_document
       FROM users u WHERE u.portfolio_id = $1 AND u.role = 'admin' ORDER BY u.name`, [req.params.id]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.post('/portfolios/:id/admins', async (req: AuthRequest, res) => {
  try {
    const { name, email, password, id_document } = req.body;
    let doc: any = null;
    try { doc = parseDoc(id_document); } catch (e: any) { return res.status(400).json({ error: e.message }); }
    if (!String(name || '').trim() || !String(email || '').trim() || String(password || '').length < 8)
      return res.status(400).json({ error: 'Nombre, correo y contraseña (mínimo 8 caracteres) son obligatorios' });
    const { rows: [pf] } = await pool.query(`SELECT id FROM portfolios WHERE id = $1`, [req.params.id]);
    if (!pf) return res.status(404).json({ error: 'Portafolio no encontrado' });
    const mail = String(email).toLowerCase().trim();
    const { rows: [dup] } = await pool.query(`SELECT id FROM users WHERE email = $1`, [mail]);
    if (dup) return res.status(400).json({ error: 'Ese correo ya está registrado' });
    const hash = await bcrypt.hash(String(password), 10);
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (portfolio_id, role, email, password_hash, name, status)
       VALUES ($1, 'admin', $2, $3, $4, 'Activo') RETURNING id, name, email, status`,
      [pf.id, mail, hash, String(name).trim()]);
    if (doc) await saveDoc(pool, u.id, pf.id, doc);
    res.json({ ...u, has_document: !!doc });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

// Activar / inactivar, renombrar o restablecer contraseña de un administrador
router.put('/admins/:id', async (req: AuthRequest, res) => {
  try {
    const { status, password, name } = req.body;
    if (status !== undefined && !['Activo', 'Inactivo'].includes(status))
      return res.status(400).json({ error: 'Estado inválido' });
    if (password !== undefined && String(password).length < 8)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    const hash = password !== undefined ? await bcrypt.hash(String(password), 10) : null;
    const { rows: [u] } = await pool.query(
      `UPDATE users SET
         name = COALESCE(NULLIF($2, ''), name),
         status = COALESCE($3, status),
         password_hash = COALESCE($4, password_hash)
       WHERE id = $1 AND role = 'admin' RETURNING id, name, email, status`,
      [req.params.id, name !== undefined ? String(name).trim() : null, status !== undefined ? status : null, hash]);
    if (!u) return res.status(404).json({ error: 'Administrador no encontrado' });
    res.json(u);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ── Documento de identidad del administrador (solo super administrador) ── */
router.put('/admins/:id/document', async (req: AuthRequest, res) => {
  try {
    const doc = parseDoc(req.body.id_document || req.body);
    if (!doc) return res.status(400).json({ error: 'Adjunta el documento' });
    const { rows: [u] } = await pool.query(`SELECT id, portfolio_id FROM users WHERE id = $1 AND role = 'admin'`, [req.params.id]);
    if (!u) return res.status(404).json({ error: 'Administrador no encontrado' });
    await saveDoc(pool, u.id, u.portfolio_id, doc);
    res.json({ ok: true });
  } catch (e: any) {
    const bad = /documento|PDF|MB|autoriz/.test(String(e.message));
    if (!bad) console.error(e);
    res.status(bad ? 400 : 500).json({ error: bad ? e.message : 'Error del servidor' });
  }
});

/** Supresión del documento (derecho de supresión / revocación de la autorización) */
router.delete('/admins/:id/document', async (req: AuthRequest, res) => {
  try {
    const r = await pool.query(`DELETE FROM admin_documents WHERE user_id = $1`, [req.params.id]);
    res.json({ ok: true, deleted: r.rowCount });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.get('/admins/:id/document', async (req: AuthRequest, res) => {
  try {
    const { rows: [d] } = await pool.query(
      `SELECT file_name, mime_type, data FROM admin_documents WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.params.id]);
    if (!d) return res.status(404).json({ error: 'Este administrador no tiene documento cargado' });
    res.setHeader('Content-Type', d.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${String(d.file_name).replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(d.data);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

export default router;
