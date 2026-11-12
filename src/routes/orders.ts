import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { productAvailable, kitAvailable, getOrderTotals, money, ensureShipmentFor } from '../services/inventory.js';
import { emitPortfolio } from '../realtime.js';

const router = Router();

/** Bolsitas en borrador vencidas (12 h) → expired (stock liberado automáticamente) */
async function expireStaleOrders(clientId: string) {
  await pool.query(
    `UPDATE orders SET status = 'expired'
     WHERE client_id = $1 AND status = 'draft' AND expires_at IS NOT NULL AND expires_at < NOW()`,
    [clientId]);
}

async function nextOrderNumber(portfolioId: string): Promise<string> {
  const { rows: [pf] } = await pool.query(
    `SELECT order_prefix, order_digits, order_start FROM portfolios WHERE id = $1`, [portfolioId]);
  const { rows: [mx] } = await pool.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM '([0-9]+)$') AS INTEGER)), 0) AS m
     FROM orders WHERE portfolio_id = $1`, [portfolioId]);
  const num = Math.max(Number(mx.m) + 1, pf.order_start);
  return `${pf.order_prefix}-${String(num).padStart(pf.order_digits, '0')}`;
}

// ── Cliente: sus bolsitas ─────────────────────────────
router.get('/mine', authenticate, requireRole('client'), async (req: AuthRequest, res) => {
  try {
    await expireStaleOrders(req.user!.id);
    const { rows: orders } = await pool.query(
      `SELECT id, order_number, status, notes, expires_at, created_at
       FROM orders WHERE client_id = $1 AND status <> 'canceled' ORDER BY created_at DESC`,
      [req.user!.id]);
    const result = [];
    for (const o of orders) {
      const { rows: items } = await pool.query(
        `SELECT oi.id, oi.quantity, oi.price, p.name AS product_name, k.name AS kit_name
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         LEFT JOIN kits k ON k.id = oi.kit_id
         WHERE oi.order_id = $1 ORDER BY oi.added_at`, [o.id]);
      result.push({ ...o, items, ...(await getOrderTotals(o.id)) });
    }
    res.json(result);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

// Bolsita actual del cliente: reutiliza la activa con pago pendiente; crea nueva solo si todo está pagado
router.post('/', authenticate, requireRole('client'), async (req: AuthRequest, res) => {
  try {
    await expireStaleOrders(req.user!.id);
    const { rows: [current] } = await pool.query(
      `SELECT * FROM orders
       WHERE client_id = $1 AND status IN ('draft','pending_confirm','apartada')
       ORDER BY created_at ASC
       LIMIT 1`,
      [req.user!.id]);
    if (current) return res.json(current);

    const order_number = await nextOrderNumber(req.user!.portfolio_id!);
    const { rows: [order] } = await pool.query(
      `INSERT INTO orders (portfolio_id, client_id, order_number, status, expires_at)
       VALUES ($1, $2, $3, 'draft', NOW() + INTERVAL '12 hours') RETURNING *`,
      [req.user!.portfolio_id, req.user!.id, order_number]);
    res.json(order);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

// Agregar producto/kit (valida stock disponible en tiempo real)
router.post('/:id/items', authenticate, requireRole('client'), async (req: AuthRequest, res) => {
  try {
    const { product_id, kit_id } = req.body;
    const qty = Math.max(1, Math.floor(Number(req.body.quantity) || 1));
    if (!product_id && !kit_id) return res.status(400).json({ error: 'Indica un producto o kit' });

    const { rows: [order] } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [req.params.id]);
    if (!order || order.client_id !== req.user!.id) return res.status(404).json({ error: 'Bolsita no encontrada' });
    if (!['draft', 'pending_confirm', 'apartada'].includes(order.status))
      return res.status(400).json({ error: 'Esta bolsita ya no puede modificarse' });

    let price = 0;
    if (product_id) {
      const avail = await productAvailable(product_id);
      if (avail < qty) return res.status(409).json({ error: `Stock insuficiente. Disponibles: ${avail}` });
      const { rows: [p] } = await pool.query(`SELECT price FROM products WHERE id = $1`, [product_id]);
      price = Number(p.price);
    } else {
      const avail = await kitAvailable(kit_id);
      if (avail < qty) return res.status(409).json({ error: `Stock insuficiente del kit. Disponibles: ${avail}` });
      const { rows: [k] } = await pool.query(`SELECT price FROM kits WHERE id = $1`, [kit_id]);
      price = Number(k.price);
    }

    await pool.query(
      `INSERT INTO order_items (order_id, product_id, kit_id, quantity, price) VALUES ($1,$2,$3,$4,$5)`,
      [order.id, product_id || null, kit_id || null, qty, price]);
    if (order.status === 'draft')
      await pool.query(`UPDATE orders SET expires_at = NOW() + INTERVAL '12 hours', updated_at = NOW() WHERE id = $1`, [order.id]);

    res.json({ ok: true, ...(await getOrderTotals(order.id)) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

// Quitar producto: SOLO en borrador (separadas/pagadas solo el admin)
router.delete('/:id/items/:itemId', authenticate, requireRole('client'), async (req: AuthRequest, res) => {
  try {
    const { rows: [order] } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [req.params.id]);
    if (!order || order.client_id !== req.user!.id) return res.status(404).json({ error: 'Bolsita no encontrada' });
    if (order.status !== 'draft')
      return res.status(403).json({ error: 'Solo el administrador puede quitar productos de una bolsita separada o pagada' });
    await pool.query(`DELETE FROM order_items WHERE id = $1 AND order_id = $2`, [req.params.itemId, order.id]);
    res.json({ ok: true, ...(await getOrderTotals(order.id)) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

// SEPARAR / ABONAR: reporta el abono por Bre-b y notifica al panel en tiempo real
router.post('/:id/separar', authenticate, requireRole('client'), async (req: AuthRequest, res) => {
  try {
    const amount = Number(req.body.amount) || 0;
    const { rows: [order] } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [req.params.id]);
    if (!order || order.client_id !== req.user!.id) return res.status(404).json({ error: 'Bolsita no encontrada' });
    if (!['draft', 'pending_confirm', 'apartada'].includes(order.status))
      return res.status(400).json({ error: 'Esta bolsita no admite abonos' });

    const totals = await getOrderTotals(order.id);
    if (totals.total <= 0) return res.status(400).json({ error: 'La bolsita no tiene productos' });

    const { rows: [cfg] } = await pool.query(
      `SELECT value FROM settings WHERE portfolio_id = $1 AND key = 'min_payment_amount'`, [order.portfolio_id]);
    const minBase = Number(cfg?.value || 10000);
    const minPay = Math.min(totals.balance, minBase); // si el saldo es < 10.000, paga el total
    if (amount < minPay) return res.status(400).json({ error: `El abono mínimo es ${money(minPay)}` });
    if (amount > totals.balance) return res.status(400).json({ error: 'El abono supera el saldo pendiente' });

    await pool.query(
      `INSERT INTO payment_reports (portfolio_id, order_id, amount, status) VALUES ($1,$2,$3,'pending')`,
      [order.portfolio_id, order.id, amount]);
    await pool.query(
      `UPDATE orders SET status = 'pending_confirm', expires_at = NOW() + INTERVAL '48 hours', updated_at = NOW() WHERE id = $1`,
      [order.id]);

    emitPortfolio(order.portfolio_id, 'payment-reported', {
      portfolioId: order.portfolio_id,
      orderNumber: order.order_number,
      amount,
      clientId: order.client_id,
    });

    const { rows: [pf] } = await pool.query(`SELECT * FROM portfolios WHERE id = $1`, [order.portfolio_id]);
    const message = (pf.whatsapp_template || '')
      .replace('{ORDER_NUMBER}', order.order_number)
      .replace('{TOTAL}', money(totals.total))
      .replace('{AMOUNT}', money(amount));
    const whatsapp_link = `https://wa.me/${String(pf.whatsapp_number).replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;

    res.json({ ok: true, bre_b_key: pf.bre_b_key, whatsapp_link, message, ...totals });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

// ── Cliente: datos de SU factura en PDF (estado actual) ───────────────
router.get('/:id/invoice', authenticate, requireRole('client'), async (req: AuthRequest, res) => {
  try {
    const { rows: [o] } = await pool.query(
      `SELECT * FROM orders WHERE id = $1 AND client_id = $2`, [req.params.id, req.user!.id]);
    if (!o) return res.status(404).json({ error: 'Bolsita no encontrada' });
    const { rows: items } = await pool.query(
      `SELECT oi.quantity, oi.price::float AS price, oi.added_at, p.name AS product_name, k.name AS kit_name
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN kits k ON k.id = oi.kit_id
       WHERE oi.order_id = $1 ORDER BY oi.added_at`, [o.id]);
    const { rows: payments } = await pool.query(
      `SELECT payment_date, method, reference, note, amount::float AS amount
       FROM payments WHERE order_id = $1 ORDER BY payment_date, created_at`, [o.id]);
    const { rows: [cl] } = await pool.query(
      `SELECT name, whatsapp, city, address FROM users WHERE id = $1`, [o.client_id]);
    const { rows: [st] } = await pool.query(
      `SELECT value FROM settings WHERE portfolio_id = $1 AND key = 'invoice_config'`, [o.portfolio_id]);
    const config = st && st.value ? JSON.parse(st.value) : {};
    res.json({ order: o, items, payments, client: cl || {}, config, ...(await getOrderTotals(o.id)) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

// ── Admin: abonos por confirmar ───────────────────────
router.get('/reports/pending', authenticate, requireRole('admin', 'super_admin'), async (req: AuthRequest, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pr.*, o.order_number, u.name AS client_name, u.whatsapp AS client_whatsapp
       FROM payment_reports pr
       JOIN orders o ON o.id = pr.order_id
       LEFT JOIN users u ON u.id = o.client_id
       WHERE pr.portfolio_id = $1 AND pr.status = 'pending'
       ORDER BY pr.reported_at DESC`,
      [req.user!.portfolio_id]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.post('/reports/:id/resolve', authenticate, requireRole('admin', 'super_admin'), async (req: AuthRequest, res) => {
  const { decision } = req.body || {}; // 'approve' | 'reject'
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Decisión inválida' });
  try {
    const { rows: [report] } = await pool.query(
      `SELECT * FROM payment_reports WHERE id = $1::uuid AND portfolio_id = $2::uuid`,
      [req.params.id, req.user!.portfolio_id]);
    if (!report || report.status !== 'pending')
      return res.status(404).json({ error: 'Reporte no encontrado o ya resuelto' });

    let newStatus = '';
    if (decision === 'approve') {
      await pool.query(
        `UPDATE payment_reports SET status = 'approved', resolved_at = NOW() WHERE id = $1::uuid`,
        [report.id]);
      await pool.query(
        `INSERT INTO payments (portfolio_id, order_id, amount, method, reference, payment_date)
         VALUES ($1::uuid, $2::uuid, $3::numeric, 'Bre-b', $4, CURRENT_DATE)`,
        [report.portfolio_id, report.order_id, String(report.amount), `Reporte ${String(report.id).slice(0, 8)}`]);
      const totals = await getOrderTotals(report.order_id);
      newStatus = totals.balance <= 0 ? 'paid' : 'apartada';
      await pool.query(
        `UPDATE orders SET status = $1, expires_at = NULL, updated_at = NOW() WHERE id = $2::uuid`,
        [newStatus, report.order_id]);
      if (newStatus === 'paid') await ensureShipmentFor(report.order_id, report.portfolio_id);
    } else {
      newStatus = 'draft';
      await pool.query(
        `UPDATE payment_reports SET status = 'rejected', resolved_at = NOW() WHERE id = $1::uuid`,
        [report.id]);
      await pool.query(
        `UPDATE orders SET status = 'draft', expires_at = NOW() + INTERVAL '12 hours', updated_at = NOW() WHERE id = $1::uuid`,
        [report.order_id]);
    }

    const { rows: [ord] } = await pool.query(
      `SELECT client_id, order_number FROM orders WHERE id = $1`, [report.order_id]);
    emitPortfolio(report.portfolio_id, 'report-resolved', {
      portfolioId: report.portfolio_id,
      clientId: ord?.client_id || null,
      orderNumber: ord?.order_number || '',
      decision,
      newStatus,
    });

    const totals = await getOrderTotals(report.order_id);
    return res.json({ ok: true, new_status: newStatus, ...totals });
  } catch (e: any) {
    console.error('ERROR en /reports/:id/resolve →', e);
    return res.status(500).json({ error: 'Error al confirmar el abono: ' + (e && e.message ? e.message : 'desconocido') });
  }
});

export default router;