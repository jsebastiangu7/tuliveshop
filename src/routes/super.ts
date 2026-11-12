import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';

const router = Router();

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
  try {
    const { name, slug, bre_b_key, whatsapp_number, order_prefix } = req.body;
    const cleanSlug = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!String(name || '').trim()) return res.status(400).json({ error: 'El nombre de la tienda es obligatorio' });
    if (!/^[a-z0-9-]{3,30}$/.test(cleanSlug)) return res.status(400).json({ error: 'El enlace debe tener 3-30 caracteres (a-z, 0-9, guiones)' });
    const { rows: [dup] } = await pool.query(`SELECT id FROM portfolios WHERE slug = $1`, [cleanSlug]);
    if (dup) return res.status(400).json({ error: 'Ese enlace ya está en uso por otra tienda' });
    const { rows: [pf] } = await pool.query(
      `INSERT INTO portfolios (name, slug, bre_b_key, whatsapp_number, order_prefix)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [String(name).trim(), cleanSlug,
       String(bre_b_key || '').trim() || '3058173611',
       String(whatsapp_number || '').trim() || '+573058173611',
       String(order_prefix || 'BOL').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'BOL']);
    for (const [key, value] of [['inventory_reserve_hours', '12'], ['payment_confirm_hours', '48'], ['min_payment_amount', '10000']]) {
      await pool.query(
        `INSERT INTO settings (portfolio_id, key, value) VALUES ($1, $2, $3)
         ON CONFLICT (portfolio_id, key) DO UPDATE SET value = EXCLUDED.value`,
        [pf.id, key, value]);
    }
    res.json(pf);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
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

/* ── Administradores de cada tienda ── */
router.get('/portfolios/:id/admins', async (req: AuthRequest, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, status, created_at FROM users
       WHERE portfolio_id = $1 AND role = 'admin' ORDER BY name`, [req.params.id]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.post('/portfolios/:id/admins', async (req: AuthRequest, res) => {
  try {
    const { name, email, password } = req.body;
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
    res.json(u);
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

export default router;