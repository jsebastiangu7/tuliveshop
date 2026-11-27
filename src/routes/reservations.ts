// Copiar a: src/routes/reservations.ts
import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { emitPortfolio } from '../realtime.js';
import { pushToPortfolio, pushToUsers } from '../services/push.js';

const router = Router();

/** Cliente: pide reservar algo que se agotó. Avisa en tiempo real al panel del administrador. */
router.post('/', authenticate, requireRole('client'), async (req: AuthRequest, res) => {
  try {
    const { product_id, kit_id } = req.body || {};
    const qty = Math.min(1000, Math.max(1, Math.floor(Number(req.body?.quantity) || 1)));
    if (!product_id && !kit_id) return res.status(400).json({ error: 'Indica un producto o kit' });

    const portfolioId = req.user!.portfolio_id;
    const own = product_id
      ? await pool.query(`SELECT name FROM products WHERE id = $1::uuid AND portfolio_id = $2::uuid`, [product_id, portfolioId])
      : await pool.query(`SELECT name FROM kits WHERE id = $1::uuid AND portfolio_id = $2::uuid`, [kit_id, portfolioId]);
    if (!own.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });

    // Evita spam: una sola solicitud pendiente por cliente y producto/kit
    const { rows: [dup] } = await pool.query(
      `SELECT id FROM reservations WHERE client_id = $1::uuid AND status = 'pending'
         AND product_id IS NOT DISTINCT FROM $2::uuid AND kit_id IS NOT DISTINCT FROM $3::uuid`,
      [req.user!.id, product_id || null, kit_id || null]);
    if (dup) return res.status(409).json({ error: 'Ya enviaste una solicitud de reserva para este producto' });

    const { rows: [r] } = await pool.query(
      `INSERT INTO reservations (portfolio_id, client_id, product_id, kit_id, quantity)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5) RETURNING id`,
      [portfolioId, req.user!.id, product_id || null, kit_id || null, qty]);

    emitPortfolio(portfolioId, 'reservation-request', { id: r.id, item: own.rows[0].name, quantity: qty });
    void pushToPortfolio(portfolioId, 'admin', {
      title: '🔖 Solicitud de reserva',
      body: `${own.rows[0].name} × ${qty}`,
      data: { type: 'reservation_request' },
    });
    res.json({ ok: true, id: r.id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/** Administrador: solicitudes pendientes de su tienda. */
router.get('/pending', authenticate, requireRole('admin', 'super_admin'), async (req: AuthRequest, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.quantity, r.created_at,
              COALESCE(p.name, k.name) AS item_name,
              u.name AS client_name, u.whatsapp AS client_whatsapp
       FROM reservations r
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN kits k ON k.id = r.kit_id
       LEFT JOIN users u ON u.id = r.client_id
       WHERE r.portfolio_id = $1::uuid AND r.status = 'pending'
       ORDER BY r.created_at`,
      [req.user!.portfolio_id]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/** Administrador: acepta (queda en cola hasta nueva disponibilidad) o rechaza. */
router.post('/:id/resolve', authenticate, requireRole('admin', 'super_admin'), async (req: AuthRequest, res) => {
  const { decision } = req.body || {}; // 'accept' | 'reject'
  if (!['accept', 'reject'].includes(decision)) return res.status(400).json({ error: 'Decisión inválida' });
  try {
    const { rows: [done] } = await pool.query(
      `UPDATE reservations SET status = $3, resolved_at = NOW()
       WHERE id = $1::uuid AND portfolio_id = $2::uuid AND status = 'pending'
       RETURNING client_id, product_id, kit_id`,
      [req.params.id, req.user!.portfolio_id, decision === 'accept' ? 'queued' : 'rejected']);
    if (!done) return res.status(404).json({ error: 'Solicitud no encontrada o ya resuelta' });
    pool.query(`SELECT COALESCE((SELECT name FROM products WHERE id = $1::uuid), (SELECT name FROM kits WHERE id = $2::uuid)) AS name`,
      [done.product_id, done.kit_id])
      .then(({ rows: [it] }) => pushToUsers([done.client_id], decision === 'accept'
        ? { title: '🔖 Reserva aceptada', body: `${it?.name || 'Tu producto'}: quedaste en la cola. Te avisamos cuando haya disponibilidad.`, data: { type: 'reservation_resolved', decision } }
        : { title: 'Reserva no disponible', body: `${it?.name || 'Tu producto'}: la tienda no pudo reservarlo.`, data: { type: 'reservation_resolved', decision } }))
      .catch(() => { /* el push es opcional */ });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

export default router;
