import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { productAvailable, kitAvailable, lockProducts, kitProductIds, getOrderTotals, money, ensureShipmentFor } from '../services/inventory.js';
import { emitPortfolio } from '../realtime.js';

const router = Router();

/** Bolsitas en borrador vencidas (12 h) → expired (stock liberado automáticamente) */
async function expireStaleOrders(clientId: string) {
  await pool.query(
    `UPDATE orders SET status = 'expired'
     WHERE client_id = $1 AND status = 'draft' AND expires_at IS NOT NULL AND expires_at < NOW()`,
    [clientId]);
}

export async function nextOrderNumber(portfolioId: string): Promise<string> {
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
        `SELECT oi.id, oi.quantity, oi.price, oi.confirmed, p.name AS product_name, k.name AS kit_name
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         LEFT JOIN kits k ON k.id = oi.kit_id
         WHERE oi.order_id = $1 ORDER BY oi.added_at`, [o.id]);
      const { rows: [pend] } = await pool.query(
        `SELECT amount::float AS amount FROM payment_reports WHERE order_id = $1 AND status = 'pending' ORDER BY reported_at DESC LIMIT 1`, [o.id]);
      result.push({ ...o, items, pending_amount: pend ? pend.amount : null, ...(await getOrderTotals(o.id)) });
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

// Agregar producto/kit (valida stock disponible en tiempo real).
// Todo ocurre en UNA transacción con las filas de producto bloqueadas: dos clientes que piden
// la última unidad al mismo tiempo se atienden en fila y el segundo recibe "Stock insuficiente".
router.post('/:id/items', authenticate, requireRole('client'), async (req: AuthRequest, res) => {
  const { product_id, kit_id } = req.body;
  const qty = Math.min(1000, Math.max(1, Math.floor(Number(req.body.quantity) || 1)));
  if (!product_id && !kit_id) return res.status(400).json({ error: 'Indica un producto o kit' });

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const { rows: [order] } = await db.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!order || order.client_id !== req.user!.id) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Bolsita no encontrada' });
    }
    if (!['draft', 'pending_confirm', 'apartada'].includes(order.status)) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'Esta bolsita ya no puede modificarse' });
    }

    // 1) El producto/kit debe ser de la MISMA tienda que la bolsita (evita comprar de otra tienda por id)
    const own = product_id
      ? await db.query(`SELECT 1 FROM products WHERE id = $1 AND portfolio_id = $2`, [product_id, order.portfolio_id])
      : await db.query(`SELECT 1 FROM kits WHERE id = $1 AND portfolio_id = $2`, [kit_id, order.portfolio_id]);
    if (!own.rows.length) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    // 2) Bloquear los productos implicados (el producto, o todos los componentes del kit)
    const ids = product_id ? [product_id] : await kitProductIds(kit_id, db);
    await lockProducts(db, ids);

    // 3) Con el candado puesto, recién ahora se mide el stock disponible
    let price = 0;
    if (product_id) {
      const avail = await productAvailable(product_id, db);
      if (avail < qty) {
        await db.query('ROLLBACK');
        return res.status(409).json({ error: `Stock insuficiente. Disponibles: ${avail}` });
      }
      const { rows: [p] } = await db.query(`SELECT price FROM products WHERE id = $1`, [product_id]);
      price = Number(p.price);
    } else {
      const avail = await kitAvailable(kit_id, db);
      if (avail < qty) {
        await db.query('ROLLBACK');
        return res.status(409).json({ error: `Stock insuficiente del kit. Disponibles: ${avail}` });
      }
      const { rows: [k] } = await db.query(`SELECT price FROM kits WHERE id = $1`, [kit_id]);
      price = Number(k.price);
    }

    // 4) Reservar (insertar) antes de soltar el candado
    // Después del primer abono (pendiente o apartada) el producto nuevo queda SIN CONFIRMAR: el cliente puede quitarlo o confirmarlo.
    await db.query(
      `INSERT INTO order_items (order_id, product_id, kit_id, quantity, price, confirmed) VALUES ($1,$2,$3,$4,$5,$6)`,
      [order.id, product_id || null, kit_id || null, qty, price, order.status === 'draft']);
    if (order.status === 'draft')
      await db.query(`UPDATE orders SET expires_at = NOW() + INTERVAL '12 hours', updated_at = NOW() WHERE id = $1`, [order.id]);

    await db.query('COMMIT');
    res.json({ ok: true, ...(await getOrderTotals(order.id)) });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch { /* ya cerrada */ }
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    db.release();
  }
});

// Quitar producto: SOLO en borrador (separadas/pagadas solo el admin)
router.delete('/:id/items/:itemId', authenticate, requireRole('client'), async (req: AuthRequest, res) => {
  try {
    const { rows: [order] } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [req.params.id]);
    if (!order || order.client_id !== req.user!.id) return res.status(404).json({ error: 'Bolsita no encontrada' });
    if (order.status === 'draft') {
      await pool.query(`DELETE FROM order_items WHERE id = $1 AND order_id = $2`, [req.params.itemId, order.id]);
    } else if (['pending_confirm', 'apartada'].includes(order.status)) {
      // Solo se pueden quitar los productos nuevos aún sin confirmar
      const r = await pool.query(
        `DELETE FROM order_items WHERE id = $1 AND order_id = $2 AND confirmed = FALSE`, [req.params.itemId, order.id]);
      if (!r.rowCount) return res.status(403).json({ error: 'Este producto ya está confirmado. Solo el administrador puede quitarlo.' });
    } else {
      return res.status(403).json({ error: 'Solo el administrador puede quitar productos de una bolsita pagada' });
    }
    res.json({ ok: true, ...(await getOrderTotals(order.id)) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

// Confirmar productos agregados después del primer abono: quedan bloqueados como los anteriores
router.post('/:id/items/confirm', authenticate, requireRole('client'), async (req: AuthRequest, res) => {
  try {
    const { rows: [order] } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [req.params.id]);
    if (!order || order.client_id !== req.user!.id) return res.status(404).json({ error: 'Bolsita no encontrada' });
    if (!['pending_confirm', 'apartada'].includes(order.status))
      return res.status(400).json({ error: 'Esta bolsita no tiene productos por confirmar' });
    const ids = Array.isArray(req.body.item_ids) ? req.body.item_ids.map(String) : [];
    if (!ids.length) return res.status(400).json({ error: 'Selecciona al menos un producto' });
    const r = await pool.query(
      `UPDATE order_items SET confirmed = TRUE WHERE order_id = $1 AND confirmed = FALSE AND id::text = ANY($2::text[])`,
      [order.id, ids]);
    res.json({ ok: true, confirmed: r.rowCount, ...(await getOrderTotals(order.id)) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});


// Enlace wa.me hacia el WhatsApp de la tienda
function waLink(pf: any, message: string) {
  // wa.me exige indicativo de país: un celular colombiano de 10 dígitos (3xx…) se completa con 57
  let waNum = String(pf.whatsapp_number || '').replace(/\D/g, '');
  if (waNum.length === 10 && waNum.startsWith('3')) waNum = '57' + waNum;
  return waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent(message)}` : '';
}
const fillTpl = (tpl: string, order: any, totals: any, amount = 0) => tpl
  .replace(/\{ORDER_NUMBER\}/g, order.order_number)
  .replace(/\{TOTAL\}/g, money(totals.total))
  .replace(/\{AMOUNT\}/g, money(amount));

// Mensaje + enlace con la plantilla de reporte de pago (Configuración → Plantilla de WhatsApp)
function buildWhatsapp(pf: any, order: any, totals: any, amount: number) {
  const tpl = String(pf.whatsapp_template || '').trim() ||
    'Hola, te reporto el pago de {AMOUNT} de mi bolsita {ORDER_NUMBER} (total {TOTAL}). Adjunto el comprobante.';
  const message = fillTpl(tpl, order, totals, amount);
  return { message, whatsapp_link: waLink(pf, message) };
}

const DEFAULT_TPL: Record<string, string> = {
  shipping: 'Hola. Por favor, procedamos con el envío del pedido {ORDER_NUMBER}.',
  help: 'Hola. Necesito ayuda con el pedido {ORDER_NUMBER}',
};

// Solicitar envío / pedir ayuda: arma el chat de WhatsApp con la plantilla de la tienda.
// El envío solo se habilita cuando la bolsita está totalmente pagada (se valida aquí, no solo en pantalla).
router.get('/:id/wa/:kind', authenticate, requireRole('client'), async (req: AuthRequest, res) => {
  try {
    const kind = String(req.params.kind);
    if (!['shipping', 'help'].includes(kind)) return res.status(400).json({ error: 'Tipo inválido' });
    const { rows: [order] } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [req.params.id]);
    if (!order || order.client_id !== req.user!.id) return res.status(404).json({ error: 'Bolsita no encontrada' });
    const totals = await getOrderTotals(order.id);
    if (kind === 'shipping') {
      if (['canceled', 'expired'].includes(order.status)) return res.status(400).json({ error: 'Esta bolsita está cerrada' });
      if (['shipped', 'delivered'].includes(order.status)) return res.status(400).json({ error: 'Esta bolsita ya fue enviada' });
      if (!(totals.total > 0) || totals.balance > 0)
        return res.status(403).json({ error: 'Podrás solicitar el envío cuando la bolsita esté totalmente pagada' });
    }
    const { rows: [pf] } = await pool.query(`SELECT * FROM portfolios WHERE id = $1`, [order.portfolio_id]);
    const { rows: [st] } = await pool.query(
      `SELECT value FROM settings WHERE portfolio_id = $1 AND key = $2`, [order.portfolio_id, kind === 'shipping' ? 'shipping_template' : 'help_template']);
    const tpl = String(st?.value || '').trim() || DEFAULT_TPL[kind]!;
    const message = fillTpl(tpl, order, totals);
    const whatsapp_link = waLink(pf, message);
    if (!whatsapp_link) return res.status(400).json({ error: 'La tienda aún no configuró su WhatsApp' });
    res.json({ ok: true, whatsapp_link, message });
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

    // No se abona sobre productos sin decidir: el saldo debe ser el definitivo
    const { rows: [unc] } = await pool.query(
      `SELECT 1 FROM order_items WHERE order_id = $1 AND confirmed = FALSE LIMIT 1`, [order.id]);
    if (unc) return res.status(409).json({ error: 'Tienes productos nuevos sin confirmar. Confírmalos o quítalos antes de abonar.' });

    const totals = await getOrderTotals(order.id);
    if (totals.total <= 0) return res.status(400).json({ error: 'La bolsita no tiene productos' });

    const { rows: [cfg] } = await pool.query(
      `SELECT value FROM settings WHERE portfolio_id = $1 AND key = 'min_payment_amount'`, [order.portfolio_id]);
    const minBase = Number(cfg?.value || 10000);
    const minPay = Math.min(totals.balance, minBase); // si el saldo es < 10.000, paga el total
    if (amount < minPay) return res.status(400).json({ error: `El abono mínimo es ${money(minPay)}` });
    if (amount > totals.balance) return res.status(400).json({ error: 'El abono supera el saldo pendiente' });

    // Un solo reporte pendiente por bolsita: evita duplicados (doble clic / reintentos) que el admin aprobaría dos veces
    const { rows: [dup] } = await pool.query(
      `SELECT 1 FROM payment_reports WHERE order_id = $1 AND status = 'pending' LIMIT 1`, [order.id]);
    if (dup) return res.status(409).json({ error: 'Ya tienes un pago en revisión para esta bolsita. Espera la respuesta de la tienda.' });

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
    const { message, whatsapp_link } = buildWhatsapp(pf, order, totals, amount);

    res.json({ ok: true, bre_b_key: pf.bre_b_key, whatsapp_link, message, ...totals });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});


// Reenviar: devuelve el enlace de WhatsApp del reporte pendiente (el cliente cerró el chat sin enviar el soporte)
router.get('/:id/report-link', authenticate, requireRole('client'), async (req: AuthRequest, res) => {
  try {
    const { rows: [order] } = await pool.query(`SELECT * FROM orders WHERE id = $1`, [req.params.id]);
    if (!order || order.client_id !== req.user!.id) return res.status(404).json({ error: 'Bolsita no encontrada' });
    const { rows: [rep] } = await pool.query(
      `SELECT amount::float AS amount FROM payment_reports WHERE order_id = $1 AND status = 'pending' ORDER BY reported_at DESC LIMIT 1`, [order.id]);
    if (!rep) return res.status(404).json({ error: 'No tienes un pago en revisión en esta bolsita' });
    const totals = await getOrderTotals(order.id);
    const { rows: [pf] } = await pool.query(`SELECT * FROM portfolios WHERE id = $1`, [order.portfolio_id]);
    const { message, whatsapp_link } = buildWhatsapp(pf, order, totals, rep.amount);
    res.json({ ok: true, amount: rep.amount, bre_b_key: pf.bre_b_key, whatsapp_link, message, ...totals });
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
      await pool.query(
        `UPDATE payment_reports SET status = 'rejected', resolved_at = NOW() WHERE id = $1::uuid`,
        [report.id]);
      // Si la bolsita ya tiene abonos aprobados, sigue Apartada (sin vencimiento); si no, vuelve a borrador con 12 h
      const tRej = await getOrderTotals(report.order_id);
      if (tRej.paid > 0) {
        newStatus = 'apartada';
        await pool.query(
          `UPDATE orders SET status = 'apartada', expires_at = NULL, updated_at = NOW() WHERE id = $1::uuid`,
          [report.order_id]);
      } else {
        newStatus = 'draft';
        await pool.query(`UPDATE order_items SET confirmed = TRUE WHERE order_id = $1::uuid`, [report.order_id]);
        await pool.query(
          `UPDATE orders SET status = 'draft', expires_at = NOW() + INTERVAL '12 hours', updated_at = NOW() WHERE id = $1::uuid`,
          [report.order_id]);
      }
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