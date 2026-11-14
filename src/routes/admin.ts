import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { productAvailable, kitAvailable, getOrderTotals, ensureShipmentFor } from '../services/inventory.js';
import { emitAll } from '../realtime.js';
import { decrypt } from '../utils/encryption.js';

const router = Router();

// Todas las rutas de este archivo exigen sesión de administrador
router.use(authenticate, requireRole('admin', 'super_admin'));

const pfOf = (req: AuthRequest) => req.user!.portfolio_id as string;
const stockStatus = (available: number, minStock: number) =>
  available <= 0 ? 'AGOTADO' : available <= Math.max(2, Number(minStock) || 0) ? 'REPOSICIÓN' : 'EN STOCK';

// Disponible de TODOS los productos del portafolio en 3 consultas (sin N+1).
// Misma fórmula que /analytics: stock - reservas directas - reservas por kits.
async function availabilityMap(pf: string): Promise<Map<string, number>> {
  const { rows: prods } = await pool.query(
    `SELECT id, stock::int AS stock FROM products WHERE portfolio_id=$1`, [pf]);
  const { rows: resD } = await pool.query(
    `SELECT oi.product_id AS pid, SUM(oi.quantity)::int AS q
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.portfolio_id=$1 AND o.status NOT IN ('canceled','expired') AND oi.product_id IS NOT NULL
     GROUP BY 1`, [pf]);
  const { rows: resK } = await pool.query(
    `SELECT kc.product_id AS pid, SUM(oi.quantity * kc.quantity)::int AS q
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     JOIN kit_components kc ON kc.kit_id = oi.kit_id
     WHERE o.portfolio_id=$1 AND o.status NOT IN ('canceled','expired')
     GROUP BY 1`, [pf]);
  const rd = new Map(resD.map(r => [r.pid, Number(r.q)]));
  const rk = new Map(resK.map(r => [r.pid, Number(r.q)]));
  const m = new Map<string, number>();
  for (const p of prods) m.set(p.id, Math.max(0, p.stock - (rd.get(p.id) || 0) - (rk.get(p.id) || 0)));
  return m;
}

/* ─────────────── Dashboard básico ─────────────── */
router.get('/dashboard', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { rows: [v] } = await pool.query(
      `SELECT COALESCE(SUM(t.total),0) AS ventas FROM (
         SELECT SUM(oi.price*oi.quantity) AS total FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         WHERE o.portfolio_id=$1 AND o.status <> 'canceled' GROUP BY o.id) t`, [pf]);
    const { rows: [p] } = await pool.query(
      `SELECT COALESCE(SUM(pa.amount),0) AS abonos FROM payments pa
       JOIN orders o ON o.id = pa.order_id
       WHERE o.portfolio_id=$1 AND o.status <> 'canceled'`, [pf]);
    const ventas = Number(v.ventas), abonos = Number(p.abonos);
    const { rows: [ab] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM orders WHERE portfolio_id=$1 AND status IN ('draft','pending_confirm','apartada','shipped')`, [pf]);
    const { rows: [rep] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM payment_reports WHERE portfolio_id=$1 AND status='pending'`, [pf]);

    // Stock bajo SIN N+1: un solo mapa de disponibles
    const avail = await availabilityMap(pf);
    const { rows: prods } = await pool.query(`SELECT id, min_stock FROM products WHERE portfolio_id=$1`, [pf]);
    let low = 0;
    for (const pr of prods) if ((avail.get(pr.id) ?? 0) <= Math.max(2, Number(pr.min_stock) || 0)) low++;

    const { rows: [lg] } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('por_enviar','guardado'))::int AS por_enviar,
              COUNT(*) FILTER (WHERE status = 'enviado')::int AS enviados
       FROM shipments WHERE portfolio_id=$1`, [pf]);
    res.json({ ventas, abonos, saldo: Math.max(0, ventas - abonos), abiertos: ab.n, pendientes: rep.n, stockBajo: low, logistica: lg });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ─────────────── Analítica completa (gráficas del dashboard) ─────────────── */
router.get('/analytics', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);

    // Líneas de venta con costo unitario (kits expandidos a sus componentes)
    const { rows: items } = await pool.query(
      `SELECT oi.price, oi.quantity, COALESCE(oi.added_at, o.created_at) AS fecha,
              p.name AS product_name, p.cost AS p_cost, p.shipping_cost AS p_ship, k.name AS kit_name
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN kits k ON k.id = oi.kit_id
       WHERE o.portfolio_id = $1 AND o.status <> 'canceled'`, [pf]);
    const { rows: comps } = await pool.query(
      `SELECT k.name AS kit_name, kc.quantity::float AS cq, p.cost::float AS c, p.shipping_cost::float AS s
       FROM kit_components kc JOIN kits k ON k.id = kc.kit_id JOIN products p ON p.id = kc.product_id
       WHERE k.portfolio_id = $1`, [pf]);
    const kitCost = new Map<string, { c: number; s: number }>();
    comps.forEach(c => {
      const o = kitCost.get(c.kit_name) || { c: 0, s: 0 };
      o.c += c.cq * c.c; o.s += c.cq * c.s; kitCost.set(c.kit_name, o);
    });
    const salesLines = items.map(it => {
      const qty = Number(it.quantity);
      let cost = 0, ship = 0;
      if (it.product_name != null) { cost = Number(it.p_cost || 0); ship = Number(it.p_ship || 0); }
      else if (it.kit_name) { const kc = kitCost.get(it.kit_name); if (kc) { cost = kc.c; ship = kc.s; } }
      return {
        fecha: new Date(it.fecha).toISOString().slice(0, 10),
        producto: it.product_name || it.kit_name,
        qty, venta: Number(it.price) * qty,
        costo: cost * qty, envio: ship * qty,
      };
    });

    // Abonos por mes
    const { rows: paysMonth } = await pool.query(
      `SELECT to_char(pa.payment_date, 'YYYY-MM') AS month, SUM(pa.amount)::float AS amount
       FROM payments pa JOIN orders o ON o.id = pa.order_id
       WHERE o.portfolio_id = $1 GROUP BY 1 ORDER BY 1`, [pf]);

    // Inventario: valor, envío y antigüedad (consumo = todo pedido no cancelado ni vencido)
    const { rows: prods } = await pool.query(
      `SELECT id, name, cost::float AS cost, shipping_cost::float AS ship, stock::int AS stock,
              min_stock::int AS min_stock, purchase_date FROM products WHERE portfolio_id = $1`, [pf]);
    const { rows: resD } = await pool.query(
      `SELECT oi.product_id AS pid, SUM(oi.quantity)::int AS q
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.portfolio_id = $1 AND o.status NOT IN ('canceled','expired') AND oi.product_id IS NOT NULL
       GROUP BY 1`, [pf]);
    const { rows: resK } = await pool.query(
      `SELECT kc.product_id AS pid, SUM(oi.quantity * kc.quantity)::int AS q
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       JOIN kit_components kc ON kc.kit_id = oi.kit_id
       WHERE o.portfolio_id = $1 AND o.status NOT IN ('canceled','expired')
       GROUP BY 1`, [pf]);
    const rd = new Map(resD.map(r => [r.pid, Number(r.q)]));
    const rk = new Map(resK.map(r => [r.pid, Number(r.q)]));
    let totalCosto = 0, totalEnvio = 0, over90 = 0;
    const lowStock = [];
    const stockRows = [];
    for (const p of prods) {
      const avail = Math.max(0, p.stock - (rd.get(p.id) || 0) - (rk.get(p.id) || 0));
      totalCosto += p.cost * avail; totalEnvio += p.ship * avail;
      const days = p.purchase_date ? Math.floor((Date.now() - new Date(p.purchase_date + 'T00:00:00').getTime()) / 86400000) : null;
      if (days !== null && days > 90) over90 += p.cost * avail;
      const status = stockStatus(avail, p.min_stock);
      if (status !== 'EN STOCK') lowStock.push({ name: p.name, available: avail, status });
      stockRows.push({ id: p.id, name: p.name, available: avail, status, cost: p.cost, ship: p.ship, days });
    }

    // Últimos pedidos
    const { rows: recent } = await pool.query(
      `SELECT o.id, o.order_number, o.status, o.created_at, u.name AS client_name
       FROM orders o LEFT JOIN users u ON u.id = o.client_id
       WHERE o.portfolio_id = $1 ORDER BY o.created_at DESC LIMIT 10`, [pf]);
    const recentOrders = [];
    for (const o of recent) recentOrders.push({ ...o, ...(await getOrderTotals(o.id)) });

    // Logística
    const { rows: [lg] } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('por_enviar','guardado'))::int AS por_enviar,
              COUNT(*) FILTER (WHERE status = 'enviado')::int AS enviados
       FROM shipments WHERE portfolio_id = $1`, [pf]);

    res.json({
      salesLines, paysMonth,
      inventory: { totalCosto, totalEnvio, over90, over90Pct: totalCosto > 0 ? (over90 / totalCosto) * 100 : 0 },
      lowStock, stockRows, recentOrders, logistica: lg,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ─────────────── Productos ─────────────── */
router.get('/products', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { rows } = await pool.query(
      `SELECT p.*, c.name AS category FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.portfolio_id=$1 ORDER BY p.name`, [pf]);
    const avail = await availabilityMap(pf);
    res.json(rows.map(p => {
      const available = avail.get(p.id) ?? 0;
      return { ...p, available, status: stockStatus(available, p.min_stock) };
    }));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.post('/products', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { name, code, category_id, cost, shipping_cost, price, stock, min_stock, purchase_date } = req.body;
    if (!String(name || '').trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { rows: [dup] } = await pool.query(
      `SELECT id FROM products WHERE portfolio_id=$1 AND LOWER(name)=LOWER($2)`, [pf, String(name).trim()]);
    if (dup) return res.status(400).json({ error: 'Ya existe un producto con ese nombre' });
    if (code) {
      const { rows: [dc] } = await pool.query(`SELECT id FROM products WHERE portfolio_id=$1 AND code=$2`, [pf, String(code).trim()]);
      if (dc) return res.status(400).json({ error: 'Ese código ya pertenece a otro producto' });
    }
    const { rows: [p] } = await pool.query(
      `INSERT INTO products (portfolio_id, category_id, name, code, cost, shipping_cost, price, stock, min_stock, purchase_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [pf, category_id || null, String(name).trim(), code ? String(code).trim() : null,
       Number(cost) || 0, Number(shipping_cost) || 0, Number(price) || 0,
       Math.max(0, Math.floor(Number(stock) || 0)), Math.max(0, Math.floor(Number(min_stock) || 0)), purchase_date || null]);
    res.json(p);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

const PRODUCT_FIELDS = ['name', 'code', 'category_id', 'cost', 'shipping_cost', 'price', 'stock', 'min_stock', 'purchase_date'];

router.put('/products/:id', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const filtered = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => PRODUCT_FIELDS.includes(k))
    );
    const { name, code, category_id, cost, shipping_cost, price, stock, min_stock, purchase_date } = filtered as any;
    if (code) {
      const { rows: [dc] } = await pool.query(
        `SELECT id FROM products WHERE portfolio_id=$1 AND code=$2 AND id <> $3`, [pf, String(code).trim(), req.params.id]);
      if (dc) return res.status(400).json({ error: 'Ese código ya pertenece a otro producto' });
    }
    const { rows: [p] } = await pool.query(
      `UPDATE products SET name=$3, code=$4, category_id=$5, cost=$6, shipping_cost=$7, price=$8, stock=$9, min_stock=$10, purchase_date=$11
       WHERE id=$1 AND portfolio_id=$2 RETURNING *`,
      [req.params.id, pf, String(name || '').trim(), code ? String(code).trim() : null, category_id || null,
       Number(cost) || 0, Number(shipping_cost) || 0, Number(price) || 0,
       Math.max(0, Math.floor(Number(stock) || 0)), Math.max(0, Math.floor(Number(min_stock) || 0)), purchase_date || null]);
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(p);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.post('/products/:id/stock', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const qty = Math.floor(Number(req.body.qty) || 0);
    const fecha = req.body.fecha || null;
    const { rows: [p] } = await pool.query(
      `UPDATE products SET stock = stock + $3, purchase_date = COALESCE($4, purchase_date)
       WHERE id=$1 AND portfolio_id=$2 RETURNING *`, [req.params.id, pf, qty, fecha]);
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(p);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.delete('/products/:id', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { rows: [use1] } = await pool.query(`SELECT 1 FROM order_items WHERE product_id=$1 LIMIT 1`, [req.params.id]);
    const { rows: [use2] } = await pool.query(`SELECT 1 FROM kit_components WHERE product_id=$1 LIMIT 1`, [req.params.id]);
    if (use1 || use2) return res.status(409).json({ error: 'No se puede eliminar: está usado en pedidos o kits' });
    const { rowCount } = await pool.query(`DELETE FROM products WHERE id=$1 AND portfolio_id=$2`, [req.params.id, pf]);
    if (!rowCount) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ─────────────── Categorías ─────────────── */
router.get('/categories', async (req: AuthRequest, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM categories WHERE portfolio_id=$1 ORDER BY name`, [pfOf(req)]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.post('/categories', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const name = String(req.body.name || '').trim().toUpperCase();
    if (!name) return res.status(400).json({ error: 'Nombre obligatorio' });
    const { rows: [dup] } = await pool.query(`SELECT id FROM categories WHERE portfolio_id=$1 AND name=$2`, [pf, name]);
    if (dup) return res.status(400).json({ error: 'Esa categoría ya existe' });
    const { rows: [c] } = await pool.query(`INSERT INTO categories (portfolio_id, name) VALUES ($1,$2) RETURNING *`, [pf, name]);
    res.json(c);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.put('/categories/:id', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const name = String(req.body.name || '').trim().toUpperCase();
    if (!name) return res.status(400).json({ error: 'Nombre obligatorio' });
    const { rows: [dup] } = await pool.query(`SELECT id FROM categories WHERE portfolio_id=$1 AND name=$2 AND id <> $3`, [pf, name, req.params.id]);
    if (dup) return res.status(400).json({ error: 'Esa categoría ya existe' });
    const { rows: [c] } = await pool.query(`UPDATE categories SET name=$3 WHERE id=$1 AND portfolio_id=$2 RETURNING *`, [req.params.id, pf, name]);
    if (!c) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(c);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.delete('/categories/:id', async (req: AuthRequest, res) => {
  try {
    const { rows: [use] } = await pool.query(`SELECT 1 FROM products WHERE category_id=$1 LIMIT 1`, [req.params.id]);
    if (use) return res.status(409).json({ error: 'No se puede eliminar: tiene productos asignados' });
    const { rowCount } = await pool.query(`DELETE FROM categories WHERE id=$1 AND portfolio_id=$2`, [req.params.id, pfOf(req)]);
    if (!rowCount) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ─────────────── Kits ─────────────── */
router.get('/kits', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { rows: kits } = await pool.query(`SELECT * FROM kits WHERE portfolio_id=$1 ORDER BY name`, [pf]);
    const out = [];
    for (const k of kits) {
      const { rows: comps } = await pool.query(
        `SELECT kc.id, kc.product_id, kc.quantity, p.name AS product_name
         FROM kit_components kc JOIN products p ON p.id = kc.product_id WHERE kc.kit_id=$1`, [k.id]);
      out.push({ ...k, components: comps, available: await kitAvailable(k.id) });
    }
    res.json(out);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.post('/kits', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { name, price, components } = req.body;
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Nombre obligatorio' });
    if (!Array.isArray(components) || !components.length) return res.status(400).json({ error: 'Agrega al menos un producto al kit' });
    const { rows: [k] } = await pool.query(`INSERT INTO kits (portfolio_id, name, price) VALUES ($1,$2,$3) RETURNING *`, [pf, String(name).trim(), Number(price) || 0]);
    for (const c of components)
      await pool.query(`INSERT INTO kit_components (kit_id, product_id, quantity) VALUES ($1,$2,$3)`, [k.id, c.product_id, Math.max(1, Math.floor(Number(c.quantity) || 1))]);
    res.json(k);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.put('/kits/:id', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { name, price, components } = req.body;
    const { rows: [k] } = await pool.query(`UPDATE kits SET name=$3, price=$4 WHERE id=$1 AND portfolio_id=$2 RETURNING *`, [req.params.id, pf, String(name || '').trim(), Number(price) || 0]);
    if (!k) return res.status(404).json({ error: 'Kit no encontrado' });
    if (Array.isArray(components)) {
      await pool.query(`DELETE FROM kit_components WHERE kit_id=$1`, [k.id]);
      for (const c of components)
        await pool.query(`INSERT INTO kit_components (kit_id, product_id, quantity) VALUES ($1,$2,$3)`, [k.id, c.product_id, Math.max(1, Math.floor(Number(c.quantity) || 1))]);
    }
    res.json(k);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.delete('/kits/:id', async (req: AuthRequest, res) => {
  try {
    const { rows: [use] } = await pool.query(`SELECT 1 FROM order_items WHERE kit_id=$1 LIMIT 1`, [req.params.id]);
    if (use) return res.status(409).json({ error: 'No se puede eliminar: está usado en pedidos' });
    const { rowCount } = await pool.query(`DELETE FROM kits WHERE id=$1 AND portfolio_id=$2`, [req.params.id, pfOf(req)]);
    if (!rowCount) return res.status(404).json({ error: 'Kit no encontrado' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ─────────────── Clientes ─────────────── */
router.get('/clients', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.whatsapp, u.city, u.address, u.status, u.created_at,
         COALESCE(SUM(o.total),0) AS total, COALESCE(SUM(o.paid),0) AS paid, COUNT(o.id)::int AS orders
       FROM users u
       LEFT JOIN LATERAL (
         SELECT o.id, COALESCE(SUM(oi.price*oi.quantity),0) AS total,
           (SELECT COALESCE(SUM(pa.amount),0) FROM payments pa WHERE pa.order_id=o.id) AS paid
         FROM orders o JOIN order_items oi ON oi.order_id=o.id
         WHERE o.client_id=u.id AND o.status <> 'canceled' GROUP BY o.id
       ) o ON true
       WHERE u.role='client' AND u.portfolio_id=$1
       GROUP BY u.id ORDER BY u.name`, [pf]);
    res.json(rows.map(r => ({
  ...r,
  whatsapp: decrypt(String(r.whatsapp || '')), // ← Desencriptar aquí
  email: decrypt(String(r.email || '')),       // ← Desencriptar aquí
  total: Number(r.total),
  paid: Number(r.paid),
  balance: Math.max(0, Number(r.total) - Number(r.paid))
})));
    res.json(rows.map(r => ({ ...r, total: Number(r.total), paid: Number(r.paid), balance: Math.max(0, Number(r.total) - Number(r.paid)) })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.post('/clients', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { name, whatsapp, city, address, pin } = req.body;
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Nombre obligatorio' });
    const tel = whatsapp ? String(whatsapp).replace(/\D/g, '') : null;
    if (tel) {
      const { rows: [dup] } = await pool.query(`SELECT id FROM users WHERE whatsapp=$1 AND portfolio_id=$2`, [tel, pf]);
      if (dup) return res.status(400).json({ error: 'Ese WhatsApp ya está registrado' });
    }
    const pinHash = pin ? await bcrypt.hash(String(pin), 10) : null;
    const { rows: [c] } = await pool.query(
      `INSERT INTO users (portfolio_id, role, whatsapp, pin_hash, name, city, address, status)
       VALUES ($1,'client',$2,$3,$4,$5,$6,'Activo') RETURNING id, name, whatsapp, city, address, status`,
      [pf, tel, pinHash, String(name).trim(), city || null, address || null]);
    res.json(c);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.put('/clients/:id', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { name, whatsapp, city, address, status } = req.body;
    const tel = whatsapp ? String(whatsapp).replace(/\D/g, '') : null;
    if (tel) {
      const { rows: [dup] } = await pool.query(`SELECT id FROM users WHERE whatsapp=$1 AND portfolio_id=$2 AND id <> $3`, [tel, pf, req.params.id]);
      if (dup) return res.status(400).json({ error: 'Ese WhatsApp ya está registrado' });
    }
    const { rows: [c] } = await pool.query(
      `UPDATE users SET name=$3, whatsapp=$4, city=$5, address=$6, status=$7
       WHERE id=$1 AND portfolio_id=$2 AND role='client' RETURNING id, name, whatsapp, city, address, status`,
      [req.params.id, pf, String(name || '').trim(), tel, city || null, address || null, status || 'Activo']);
    if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(c);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ─────────────── Pedidos (bolsitas) ─────────────── */
router.get('/orders', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const status = req.query.status ? String(req.query.status) : '';
    const q = req.query.q ? String(req.query.q).toLowerCase() : '';
    const { rows } = await pool.query(
      `SELECT o.id, o.client_id, o.order_number, o.status, o.notes, o.expires_at, o.created_at,
              u.name AS client_name, u.whatsapp AS client_whatsapp,
              COALESCE(t.total,0)::float AS total,
              COALESCE(t.items_count,0)::int AS items_count,
              COALESCE(pa.paid,0)::float AS paid
       FROM orders o
       LEFT JOIN users u ON u.id = o.client_id
       LEFT JOIN (SELECT order_id, SUM(price*quantity) AS total, SUM(quantity) AS items_count
                  FROM order_items GROUP BY order_id) t ON t.order_id = o.id
       LEFT JOIN (SELECT order_id, SUM(amount) AS paid FROM payments GROUP BY order_id) pa ON pa.order_id = o.id
       WHERE o.portfolio_id=$1 AND ($2 = '' OR o.status=$2)
         AND ($3 = '' OR LOWER(o.order_number) LIKE '%'||$3||'%' OR LOWER(COALESCE(u.name,'')) LIKE '%'||$3||'%')
       ORDER BY o.created_at DESC LIMIT 500`, [pf, status, q]);
    res.json(rows.map(o => ({ ...o, balance: Math.max(0, Number(o.total) - Number(o.paid)) })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.get('/orders/:id', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { rows: [o] } = await pool.query(
      `SELECT o.*, u.name AS client_name, u.whatsapp AS client_whatsapp, u.city AS client_city, u.address AS client_address
       FROM orders o LEFT JOIN users u ON u.id = o.client_id
       WHERE o.id=$1 AND o.portfolio_id=$2`, [req.params.id, pf]);
    if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
    const { rows: items } = await pool.query(
      `SELECT oi.id, oi.quantity, oi.price, oi.added_at, p.name AS product_name, k.name AS kit_name
       FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id LEFT JOIN kits k ON k.id=oi.kit_id
       WHERE oi.order_id=$1 ORDER BY oi.added_at`, [o.id]);
    const { rows: payments } = await pool.query(
      `SELECT * FROM payments WHERE order_id=$1 ORDER BY payment_date, created_at`, [o.id]);
    res.json({ ...o, items, payments, ...(await getOrderTotals(o.id)) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.put('/orders/:id', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { status, notes } = req.body;
    const ALLOW = ['draft', 'pending_confirm', 'apartada', 'paid', 'shipped', 'delivered', 'canceled'];
    if (status && !ALLOW.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
    const { rows: [o] } = await pool.query(`SELECT * FROM orders WHERE id=$1 AND portfolio_id=$2`, [req.params.id, pf]);
    if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
    const newStatus = status || o.status;
    const newNotes = notes !== undefined ? notes : o.notes;
    const newExpires = newStatus === 'draft' ? new Date(Date.now() + 12 * 3600 * 1000).toISOString() : null;
    const { rows: [up] } = await pool.query(
      `UPDATE orders SET status=$3, notes=$4, expires_at=$5, updated_at=NOW() WHERE id=$1 AND portfolio_id=$2 RETURNING *`,
      [req.params.id, pf, newStatus, newNotes, newExpires]);
    if (newStatus === 'paid' && o.status !== 'paid') await ensureShipmentFor(o.id, pf);
    res.json(up);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.post('/orders/:id/items', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { product_id, kit_id } = req.body;
    const qty = Math.max(1, Math.floor(Number(req.body.quantity) || 1));
    if (!product_id && !kit_id) return res.status(400).json({ error: 'Indica un producto o kit' });
    const { rows: [order] } = await pool.query(`SELECT * FROM orders WHERE id=$1 AND portfolio_id=$2`, [req.params.id, pf]);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (['canceled', 'expired'].includes(order.status)) return res.status(400).json({ error: 'Pedido cerrado' });
    let price = 0;
    if (product_id) {
      const avail = await productAvailable(product_id);
      if (avail < qty) return res.status(409).json({ error: `Stock insuficiente. Disponibles: ${avail}` });
      const { rows: [p] } = await pool.query(`SELECT price FROM products WHERE id=$1 AND portfolio_id=$2`, [product_id, pf]);
      if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
      price = Number(p.price);
    } else {
      const avail = await kitAvailable(kit_id);
      if (avail < qty) return res.status(409).json({ error: `Stock insuficiente del kit. Disponibles: ${avail}` });
      const { rows: [k] } = await pool.query(`SELECT price FROM kits WHERE id=$1 AND portfolio_id=$2`, [kit_id, pf]);
      if (!k) return res.status(404).json({ error: 'Kit no encontrado' });
      price = Number(k.price);
    }
    await pool.query(`INSERT INTO order_items (order_id, product_id, kit_id, quantity, price) VALUES ($1,$2,$3,$4,$5)`, [order.id, product_id || null, kit_id || null, qty, price]);
    res.json({ ok: true, ...(await getOrderTotals(order.id)) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.delete('/orders/:id/items/:itemId', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { rows: [order] } = await pool.query(`SELECT * FROM orders WHERE id=$1 AND portfolio_id=$2`, [req.params.id, pf]);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (['canceled', 'expired'].includes(order.status)) return res.status(400).json({ error: 'Pedido cerrado' });
    await pool.query(`DELETE FROM order_items WHERE id=$1 AND order_id=$2`, [req.params.itemId, order.id]);
    res.json({ ok: true, ...(await getOrderTotals(order.id)) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ─────────────── Abonos manuales del admin ─────────────── */
router.post('/orders/:id/payments', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const amount = Number(req.body.amount) || 0;
    if (amount <= 0) return res.status(400).json({ error: 'Valor inválido' });
    const { rows: [order] } = await pool.query(`SELECT * FROM orders WHERE id=$1 AND portfolio_id=$2`, [req.params.id, pf]);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    const { rows: [pay] } = await pool.query(
      `INSERT INTO payments (portfolio_id, order_id, amount, method, reference, note, payment_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [pf, order.id, amount, req.body.method || 'Transferencia', req.body.reference || null, req.body.note || null,
       req.body.payment_date || new Date().toISOString().slice(0, 10)]);
    const totals = await getOrderTotals(order.id);
    let newStatus = order.status;
    if (totals.balance <= 0 && ['draft', 'pending_confirm', 'apartada'].includes(order.status)) {
      newStatus = 'paid';
      await pool.query(`UPDATE orders SET status='paid', expires_at=NULL, updated_at=NOW() WHERE id=$1`, [order.id]);
      await ensureShipmentFor(order.id, pf);
    }
    res.json({ payment: pay, new_status: newStatus, ...totals });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.delete('/payments/:id', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { rows: [pay] } = await pool.query(`SELECT * FROM payments WHERE id=$1 AND portfolio_id=$2`, [req.params.id, pf]);
    if (!pay) return res.status(404).json({ error: 'Abono no encontrado' });
    await pool.query(`DELETE FROM payments WHERE id=$1`, [pay.id]);
    const totals = await getOrderTotals(pay.order_id);
    const { rows: [order] } = await pool.query(`SELECT status FROM orders WHERE id=$1`, [pay.order_id]);
    let newStatus = order?.status;
    if (order && order.status === 'paid' && totals.balance > 0) {
      newStatus = 'apartada';
      await pool.query(`UPDATE orders SET status='apartada', updated_at=NOW() WHERE id=$1`, [pay.order_id]);
    }
    res.json({ ok: true, new_status: newStatus, ...totals });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ─────────────── LOGÍSTICA ─────────────── */
const CARRIERS = ['Interrapidísimo', 'Envía', 'Coordinadora', 'Servientrega', 'envío local', 'otra'];

router.get('/logistics', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const st = req.query.status ? String(req.query.status) : '';
    const { rows } = await pool.query(
      `SELECT s.*, o.order_number, o.status AS order_status,
              u.name AS client_name, u.whatsapp AS client_whatsapp, u.city AS client_city, u.address AS client_address
       FROM shipments s
       JOIN orders o ON o.id = s.order_id
       LEFT JOIN users u ON u.id = o.client_id
       WHERE s.portfolio_id = $1 AND ($2 = '' OR s.status = $2)
       ORDER BY s.created_at DESC`, [pf, st]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.put('/logistics/:id', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const b = req.body || {};
    const action = b.action === 'send' ? 'send' : 'save';
    const { rows: [s] } = await pool.query(`SELECT * FROM shipments WHERE id=$1 AND portfolio_id=$2`, [req.params.id, pf]);
    if (!s) return res.status(404).json({ error: 'Envío no encontrado' });

    const carrier = CARRIERS.includes(b.carrier) ? b.carrier : s.carrier;
    const carrierOther = b.carrier_other !== undefined ? String(b.carrier_other).trim() : s.carrier_other;
    const payMode = ['adelantado', 'por_cobrar'].includes(b.pay_mode) ? b.pay_mode : s.pay_mode;
    const amount = b.amount !== undefined ? Number(b.amount) || 0 : Number(s.amount);
    const dimensions = b.dimensions !== undefined ? String(b.dimensions).trim() : s.dimensions;
    const city = b.city !== undefined ? String(b.city).trim() : s.city;
    const address = b.address !== undefined ? String(b.address).trim() : s.address;
    const addressKind = ['principal', 'temporal'].includes(b.address_kind) ? b.address_kind : s.address_kind;

    if (action === 'send') {
      const needOther = carrier === 'envío local' || carrier === 'otra';
      if (!(amount > 0) || !city || !address || (needOther && !carrierOther))
        return res.status(400).json({ error: 'Para Enviar completa: pago, monto, transportadora (con nombre si es local/otra), ciudad y dirección' });
    }

    if (addressKind === 'principal' && b.city !== undefined && b.address !== undefined) {
      const { rows: [o] } = await pool.query(`SELECT client_id FROM orders WHERE id=$1`, [s.order_id]);
      if (o?.client_id && city && address) {
        await pool.query(`UPDATE users SET city=$2, address=$3 WHERE id=$1`, [o.client_id, city, address]);
      }
    }

    const status = action === 'send' ? 'enviado' : 'guardado';
    const { rows: [up] } = await pool.query(
      `UPDATE shipments SET pay_mode=$3, amount=$4, carrier=$5, carrier_other=$6, dimensions=$7, city=$8, address=$9,
              address_kind=$10, status=$11, shipped_at=CASE WHEN $11='enviado' THEN NOW() ELSE shipped_at END, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [s.id, pf, payMode, amount, carrier, carrierOther || null, dimensions || null, city || null, address || null, addressKind, status]);

    if (action === 'send') {
      await pool.query(`UPDATE orders SET status='shipped', updated_at=NOW() WHERE id=$1 AND status IN ('paid','apartada','pending_confirm','draft')`, [s.order_id]);
      emitAll('stock-updated', {});
    }
    res.json(up);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ─────────────── OBJETIVOS y aportes ─────────────── */
router.get('/goals', async (req: AuthRequest, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.*, COALESCE(SUM(gp.amount),0)::float AS contributed
       FROM goals g LEFT JOIN goal_payments gp ON gp.goal_id = g.id
       WHERE g.portfolio_id = $1 GROUP BY g.id ORDER BY g.created_at`, [pfOf(req)]);
    res.json(rows.map(r => ({ ...r, target: Number(r.target), contributed: Number(r.contributed) })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.post('/goals', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { rows: [cnt] } = await pool.query(`SELECT COUNT(*)::int AS n FROM goals WHERE portfolio_id=$1`, [pf]);
    if (cnt.n >= 3) return res.status(400).json({ error: 'Máximo tres objetivos por tienda' });
    const name = String(req.body.name || '').trim();
    const target = Number(req.body.target) || 0;
    if (!name || target <= 0) return res.status(400).json({ error: 'Nombre y monto mayores a 0 son obligatorios' });
    const { rows: [g] } = await pool.query(
      `INSERT INTO goals (portfolio_id, name, target) VALUES ($1,$2,$3) RETURNING *`, [pf, name, target]);
    res.json({ ...g, target: Number(g.target), contributed: 0 });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.put('/goals/:id', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { name, target, active } = req.body;
    const { rows: [g] } = await pool.query(
      `UPDATE goals SET name=COALESCE(NULLIF($3,''), name), target=COALESCE($4, target), active=COALESCE($5, active)
       WHERE id=$1 AND portfolio_id=$2 RETURNING *`,
      [req.params.id, pf, name !== undefined ? String(name).trim() : null,
       target !== undefined ? Number(target) || null : null, active !== undefined ? !!active : null]);
    if (!g) return res.status(404).json({ error: 'Objetivo no encontrado' });
    res.json(g);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.delete('/goals/:id', async (req: AuthRequest, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM goals WHERE id=$1 AND portfolio_id=$2`, [req.params.id, pfOf(req)]);
    if (!rowCount) return res.status(404).json({ error: 'Objetivo no encontrado' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.post('/goals/:id/payments', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const amount = Number(req.body.amount) || 0;
    if (amount <= 0) return res.status(400).json({ error: 'El aporte debe ser mayor a 0' });
    const { rows: [g] } = await pool.query(`SELECT id FROM goals WHERE id=$1 AND portfolio_id=$2`, [req.params.id, pf]);
    if (!g) return res.status(404).json({ error: 'Objetivo no encontrado' });
    const { rows: [p] } = await pool.query(
      `INSERT INTO goal_payments (portfolio_id, goal_id, amount, payment_date) VALUES ($1,$2,$3,$4) RETURNING *`,
      [pf, g.id, amount, req.body.payment_date || new Date().toISOString().slice(0, 10)]);
    res.json(p);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.delete('/goal-payments/:id', async (req: AuthRequest, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM goal_payments WHERE id=$1 AND portfolio_id=$2`, [req.params.id, pfOf(req)]);
    if (!rowCount) return res.status(404).json({ error: 'Aporte no encontrado' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ─────────────── DONACIONES CERTIFICADAS ─────────────── */
router.get('/donations', async (req: AuthRequest, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM donations WHERE portfolio_id=$1 ORDER BY donation_date DESC, created_at DESC`, [pfOf(req)]);
    res.json(rows.map(r => ({ ...r, amount: Number(r.amount) })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.post('/donations', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const entity = String(req.body.entity || '').trim();
    const amount = Number(req.body.amount) || 0;
    if (!entity || amount <= 0) return res.status(400).json({ error: 'Entidad y valor mayores a 0 son obligatorios' });
    const { rows: [d] } = await pool.query(
      `INSERT INTO donations (portfolio_id, entity, amount, certificate, donation_date, note)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [pf, entity, amount, req.body.certificate || null, req.body.donation_date || new Date().toISOString().slice(0, 10), req.body.note || null]);
    res.json({ ...d, amount: Number(d.amount) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.delete('/donations/:id', async (req: AuthRequest, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM donations WHERE id=$1 AND portfolio_id=$2`, [req.params.id, pfOf(req)]);
    if (!rowCount) return res.status(404).json({ error: 'Donación no encontrada' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ─────────────── Configuración ─────────────── */
router.get('/settings', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { rows: [p] } = await pool.query(`SELECT * FROM portfolios WHERE id=$1`, [pf]);
    const { rows: sets } = await pool.query(`SELECT key, value FROM settings WHERE portfolio_id=$1`, [pf]);
    const map: Record<string, string> = {};
    sets.forEach(s => { map[s.key] = s.value; });
    res.json({
      bre_b_key: p.bre_b_key, whatsapp_number: p.whatsapp_number, whatsapp_template: p.whatsapp_template,
      order_prefix: p.order_prefix, order_digits: p.order_digits, order_start: p.order_start,
      min_payment_amount: Number(map.min_payment_amount || 10000),
      invoice_config: map.invoice_config ? JSON.parse(map.invoice_config) : null,
      profit_config: map.profit_config ? JSON.parse(map.profit_config) : null,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.put('/settings', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const b = req.body;
    await pool.query(
      `UPDATE portfolios SET
         bre_b_key = COALESCE(NULLIF($2, ''), bre_b_key),
         whatsapp_number = COALESCE(NULLIF($3, ''), whatsapp_number),
         whatsapp_template = COALESCE($4, whatsapp_template),
         order_prefix = COALESCE(NULLIF($5, ''), order_prefix),
         order_digits = COALESCE($6, order_digits),
         order_start = COALESCE($7, order_start)
       WHERE id = $1`,
      [pf,
       b.bre_b_key !== undefined ? String(b.bre_b_key).trim() : '',
       b.whatsapp_number !== undefined ? String(b.whatsapp_number).trim() : '',
       b.whatsapp_template !== undefined ? String(b.whatsapp_template) : null,
       b.order_prefix !== undefined ? String(b.order_prefix).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : '',
       b.order_digits !== undefined ? Math.min(8, Math.max(3, Number(b.order_digits) || 5)) : null,
       b.order_start !== undefined ? Math.max(1, Number(b.order_start) || 1) : null]);
    const upsert = async (key: string, value: string) => pool.query(
      `INSERT INTO settings (portfolio_id, key, value) VALUES ($1,$2,$3)
       ON CONFLICT (portfolio_id, key) DO UPDATE SET value = EXCLUDED.value`, [pf, key, value]);
    if (b.min_payment_amount !== undefined) await upsert('min_payment_amount', String(Number(b.min_payment_amount) || 0));
    if (b.invoice_config !== undefined) await upsert('invoice_config', JSON.stringify(b.invoice_config));
    if (b.profit_config !== undefined) await upsert('profit_config', JSON.stringify(b.profit_config));
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ─────────────── Importador del JSON actual (idempotente en abonos) ─────────────── */
router.post('/import-json', async (req: AuthRequest, res) => {
  const pf = pfOf(req);
  const st = req.body;
  if (!st || typeof st !== 'object' || !Array.isArray(st.inventory) || !Array.isArray(st.orders))
    return res.status(400).json({ error: 'El JSON no tiene el formato esperado (inventory, orders…)' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counts = { categories: 0, products: 0, kits: 0, clients: 0, orders: 0, payments: 0, paymentsOmitidos: 0 };

    // Categorías
    const cats = new Set<string>();
    (st.categories || []).forEach((c: any) => { if (c) cats.add(String(c).toUpperCase()); });
    (st.inventory || []).forEach((p: any) => { if (p.categoria) cats.add(String(p.categoria).toUpperCase()); });
    for (const name of cats) {
      if (!name) continue;
      const r = await client.query(`SELECT id FROM categories WHERE portfolio_id=$1 AND name=$2`, [pf, name]);
      if (!r.rows.length) { await client.query(`INSERT INTO categories (portfolio_id, name) VALUES ($1,$2)`, [pf, name]); counts.categories++; }
    }
    const catId = async (name: string) => {
      const r = await client.query(`SELECT id FROM categories WHERE portfolio_id=$1 AND name=$2`, [pf, String(name || '').toUpperCase()]);
      return r.rows[0]?.id || null;
    };

    // Productos (si ya existe, se conserva la versión del sistema)
    const prodIdByName = new Map<string, string>();
    for (const p of st.inventory || []) {
      const name = String(p.producto || '').trim(); if (!name) continue;
      const exist = await client.query(`SELECT id FROM products WHERE portfolio_id=$1 AND LOWER(name)=LOWER($2)`, [pf, name]);
      if (exist.rows.length) { prodIdByName.set(name, exist.rows[0].id); continue; }
      const r = await client.query(
        `INSERT INTO products (portfolio_id, category_id, name, code, cost, shipping_cost, price, stock, min_stock, purchase_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [pf, await catId(p.categoria), name, p.codigo ? String(p.codigo).trim() : null, Number(p.costo) || 0, Number(p.envio) || 0,
         Number(p.precio) || 0, Math.max(0, Math.floor(Number(p.stock) || 0)), Math.max(0, Math.floor(Number(p.minimo) || 0)), p.fechaCompra || null]);
      prodIdByName.set(name, r.rows[0].id); counts.products++;
    }

    // Kits
    const kitIdByName = new Map<string, string>();
    for (const k of st.kits || []) {
      const name = String(k.nombre || '').trim(); if (!name) continue;
      const exist = await client.query(`SELECT id FROM kits WHERE portfolio_id=$1 AND LOWER(name)=LOWER($2)`, [pf, name]);
      let kitId = exist.rows[0]?.id;
      if (!kitId) {
        const r = await client.query(`INSERT INTO kits (portfolio_id, name, price) VALUES ($1,$2,$3) RETURNING id`, [pf, name, Number(k.precioVenta) || 0]);
        kitId = r.rows[0].id; counts.kits++;
      } else {
        await client.query(`UPDATE kits SET price=$2 WHERE id=$1`, [kitId, Number(k.precioVenta) || 0]);
        await client.query(`DELETE FROM kit_components WHERE kit_id=$1`, [kitId]);
      }
      kitIdByName.set(name, kitId);
      for (const c of k.componentes || []) {
        const pid = prodIdByName.get(String(c.producto || '').trim());
        if (pid) await client.query(`INSERT INTO kit_components (kit_id, product_id, quantity) VALUES ($1,$2,$3)`, [kitId, pid, Math.max(1, Math.floor(Number(c.cantidad) || 1))]);
      }
    }

    // Clientes
    const clientIdByName = new Map<string, string>();
    for (const c of st.clients || []) {
      const name = String(c.nombre || '').trim(); if (!name) continue;
      const tel = String(c.telefono || c.whatsapp || c.celular || '').replace(/\D/g, '') || null;
      let uid: string | null = null;
      if (tel) {
        const r = await client.query(`SELECT id FROM users WHERE portfolio_id=$1 AND whatsapp=$2`, [pf, tel]);
        uid = r.rows[0]?.id || null;
      }
      if (!uid) {
        const r2 = await client.query(`SELECT id FROM users WHERE portfolio_id=$1 AND role='client' AND LOWER(name)=LOWER($2)`, [pf, name]);
        uid = r2.rows[0]?.id || null;
      }
      if (!uid) {
        const r3 = await client.query(
          `INSERT INTO users (portfolio_id, role, whatsapp, pin_hash, name, city, address, status)
           VALUES ($1,'client',$2,NULL,$3,$4,$5,$6) RETURNING id`,
          [pf, tel, name, c.tiktok || null, c.direccion || null, c.estado || 'Activo']);
        uid = r3.rows[0].id; counts.clients++;
      } else {
        await client.query(`UPDATE users SET name=$2, city=COALESCE($3,city), address=COALESCE($4,address), status=$5 WHERE id=$1`, [uid, name, c.tiktok || null, c.direccion || null, c.estado || 'Activo']);
      }
      clientIdByName.set(name, uid);
    }

    // Pedidos + líneas (si el número ya existe, se conserva el del sistema)
    const STATUS_MAP: Record<string, string> = { 'Pendiente': 'draft', 'Apartado': 'apartada', 'Pagado': 'paid', 'Enviado': 'shipped', 'Entregado': 'delivered', 'Cancelado': 'canceled' };
    const orderIdByNumber = new Map<string, string>();
    for (const o of st.orders || []) {
      const num = String(o.id || '').trim(); if (!num) continue;
      const exist = await client.query(`SELECT id FROM orders WHERE portfolio_id=$1 AND order_number=$2`, [pf, num]);
      if (exist.rows.length) { orderIdByNumber.set(num, exist.rows[0].id); continue; }
      const clientId = clientIdByName.get(String(o.cliente || '').trim()) || null;
      const r = await client.query(
        `INSERT INTO orders (portfolio_id, client_id, order_number, status, notes, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,NULL,$6) RETURNING id`,
        [pf, clientId, num, STATUS_MAP[o.estado] || 'draft', o.notas || null, o.fecha ? new Date(o.fecha + 'T12:00:00') : new Date()]);
      orderIdByNumber.set(num, r.rows[0].id); counts.orders++;
      for (const l of o.lineas || []) {
        const pname = String(l.producto || '').trim();
        const pid = prodIdByName.get(pname) || null;
        const kid = pid ? null : (kitIdByName.get(pname) || null);
        await client.query(
          `INSERT INTO order_items (order_id, product_id, kit_id, quantity, price, added_at) VALUES ($1,$2,$3,$4,$5,$6)`,
          [r.rows[0].id, pid, kid, Math.max(1, Math.floor(Number(l.cantidad) || 1)), Number(l.precio) || 0,
           l.fecha ? new Date(l.fecha + 'T12:00:00') : (o.fecha ? new Date(o.fecha + 'T12:00:00') : new Date())]);
      }
    }

    // Abonos: se OMITE cualquier abono idéntico ya registrado (mismo pedido, fecha, valor, medio y referencia)
    for (const p of st.payments || []) {
      const oid = orderIdByNumber.get(String(p.pedido || '').trim());
      if (!oid) continue;
      const fecha = p.fecha ? new Date(p.fecha + 'T12:00:00') : new Date();
      const dup = await client.query(
        `SELECT 1 FROM payments WHERE order_id=$1 AND payment_date=$2 AND amount=$3 AND method=$4 AND COALESCE(reference,'')=COALESCE($5,'') LIMIT 1`,
        [oid, fecha, Number(p.valor) || 0, p.medio || 'Transferencia', p.referencia || null]);
      if (dup.rows.length) { counts.paymentsOmitidos++; continue; }
      await client.query(
        `INSERT INTO payments (portfolio_id, order_id, amount, method, reference, note, payment_date) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [pf, oid, Number(p.valor) || 0, p.medio || 'Transferencia', p.referencia || null, p.nota || null, fecha]);
      counts.payments++;
    }

    // Sincroniza estado Pagado según abonos
    await client.query(
      `UPDATE orders o SET status='paid', expires_at=NULL
       WHERE o.portfolio_id=$1 AND o.status IN ('draft','apartada')
         AND (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) > 0
         AND (SELECT COALESCE(SUM(pa.amount),0) FROM payments pa WHERE pa.order_id=o.id) >=
             (SELECT COALESCE(SUM(oi.price*oi.quantity),0) FROM order_items oi WHERE oi.order_id=o.id)`, [pf]);

    // Fichas de logística para pedidos pagados/enviados importados
    await client.query(
      `INSERT INTO shipments (portfolio_id, order_id, status)
       SELECT o.portfolio_id, o.id, CASE WHEN o.status IN ('shipped','delivered') THEN 'enviado' ELSE 'por_enviar' END
       FROM orders o
       WHERE o.portfolio_id=$1 AND o.status IN ('paid','shipped','delivered')
         AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id=o.id)`, [pf]);

    // Numeración y configuración de factura
    if (st.orderNumbering) {
      await client.query(`UPDATE portfolios SET order_prefix=$2, order_start=$3, order_digits=$4 WHERE id=$1`,
        [pf, String(st.orderNumbering.prefix || 'BOL').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'BOL',
         Math.max(1, Number(st.orderNumbering.start) || 1), Math.min(8, Math.max(3, Number(st.orderNumbering.digits) || 5))]);
    }
    if (st.invoiceConfig) {
      await client.query(
        `INSERT INTO settings (portfolio_id, key, value) VALUES ($1,'invoice_config',$2)
         ON CONFLICT (portfolio_id, key) DO UPDATE SET value=EXCLUDED.value`,
        [pf, JSON.stringify(st.invoiceConfig)]);
    }

    await client.query('COMMIT');
    res.json({ ok: true, counts });
  } catch (e: any) {
    await client.query('ROLLBACK');
    console.error('ERROR import-json →', e);
    res.status(500).json({ error: 'Error al importar: ' + (e && e.message ? e.message : 'desconocido') });
  } finally {
    client.release();
  }
});
/* ─────────────── BORRADO TOTAL (Zona de peligro) ─────────────── */
router.post('/wipe', async (req: AuthRequest, res) => {
  try {
    const pf = pfOf(req);
    const { confirmText } = req.body;
    
    if (confirmText !== 'Estoy seguro de hacer el borrado') {
      return res.status(400).json({ error: 'Texto de confirmación incorrecto' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Borrado de datos transaccionales y logística
      await client.query(`DELETE FROM shipments WHERE portfolio_id=$1`, [pf]);
      await client.query(`DELETE FROM payments WHERE portfolio_id=$1`, [pf]);
      await client.query(`DELETE FROM payment_reports WHERE portfolio_id=$1`, [pf]);
      
      // order_items (por seguridad, aunque haya CASCADE)
      await client.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE portfolio_id=$1)`, [pf]);
      await client.query(`DELETE FROM orders WHERE portfolio_id=$1`, [pf]);

      // 2. Borrado de inventario y kits
      await client.query(`DELETE FROM kit_components WHERE kit_id IN (SELECT id FROM kits WHERE portfolio_id=$1)`, [pf]);
      await client.query(`DELETE FROM kits WHERE portfolio_id=$1`, [pf]);
      await client.query(`DELETE FROM products WHERE portfolio_id=$1`, [pf]);
      await client.query(`DELETE FROM categories WHERE portfolio_id=$1`, [pf]);

      // 3. Borrado de clientes (solo role='client', se preservan admins)
      await client.query(`DELETE FROM users WHERE portfolio_id=$1 AND role='client'`, [pf]);

      // 4. Borrado de objetivos, aportes y donaciones
      await client.query(`DELETE FROM goal_payments WHERE portfolio_id=$1`, [pf]);
      await client.query(`DELETE FROM goals WHERE portfolio_id=$1`, [pf]);
      await client.query(`DELETE FROM donations WHERE portfolio_id=$1`, [pf]);

      // 5. Resetear configuración personalizada a valores por defecto
      await client.query(`DELETE FROM settings WHERE portfolio_id=$1`, [pf]);
      await client.query(`
        UPDATE portfolios SET 
          bre_b_key = '3058173611',
          whatsapp_number = '+573058173611',
          whatsapp_template = 'Hola, Mar. Te envío el abono a mi bolsita {ORDER_NUMBER}. Total: {TOTAL}. Abono: {AMOUNT}.',
          order_prefix = 'BOL',
          order_digits = 5,
          order_start = 1
        WHERE id = $1
      `, [pf]);

      await client.query('COMMIT');
      res.json({ ok: true, message: 'Tienda borrada exitosamente' });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e: any) {
    console.error('ERROR wipe:', e);
    res.status(500).json({ error: 'Error al borrar la tienda: ' + (e.message || 'desconocido') });
  }
});

export default router;
