import { pool } from '../db.js';

/** Pedidos que descuentan stock: todo lo no cancelado ni vencido (incluye pagados/enviados/entregados y bolsitas abiertas) */
const CONSUME = `('canceled','expired')`;

async function consumedDirect(productId: string): Promise<number> {
  const { rows: [r] } = await pool.query(
    `SELECT COALESCE(SUM(oi.quantity),0)::int AS q
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.product_id = $1 AND o.status NOT IN ('canceled','expired')`, [productId]);
  return Number(r.q);
}

async function consumedViaKits(productId: string): Promise<number> {
  const { rows: [r] } = await pool.query(
    `SELECT COALESCE(SUM(oi.quantity * kc.quantity),0)::int AS q
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN kit_components kc ON kc.kit_id = oi.kit_id
     WHERE kc.product_id = $1 AND o.status NOT IN ('canceled','expired')`, [productId]);
  return Number(r.q);
}

/** Stock realmente disponible para vender (fórmula de tu Administrador Emprendedor) */
export async function productAvailable(productId: string): Promise<number> {
  const { rows: [p] } = await pool.query(`SELECT stock FROM products WHERE id = $1`, [productId]);
  if (!p) return 0;
  const d = await consumedDirect(productId);
  const k = await consumedViaKits(productId);
  return Math.max(0, Number(p.stock) - d - k);
}

/** Kits armables según componentes */
export async function kitAvailable(kitId: string): Promise<number> {
  const { rows: comps } = await pool.query(
    `SELECT kc.product_id, kc.quantity FROM kit_components kc WHERE kc.kit_id = $1`, [kitId]);
  if (!comps.length) return 0;
  let min = Infinity;
  for (const c of comps) {
    const avail = await productAvailable(c.product_id);
    min = Math.min(min, Math.floor(avail / Math.max(1, Number(c.quantity))));
  }
  return Math.max(0, min === Infinity ? 0 : min);
}

/** Totales de una bolsita */
export async function getOrderTotals(orderId: string) {
  const { rows: [t] } = await pool.query(
    `SELECT COALESCE(SUM(price * quantity),0)::float AS total FROM order_items WHERE order_id = $1`, [orderId]);
  const { rows: [p] } = await pool.query(
    `SELECT COALESCE(SUM(amount),0)::float AS paid FROM payments WHERE order_id = $1`, [orderId]);
  const total = Number(t.total), paid = Number(p.paid);
  return { total, paid, balance: Math.max(0, total - paid) };
}

export const money = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

/** Crea la ficha de logística cuando un pedido queda Pagado (si no existe) */
export async function ensureShipmentFor(orderId: string, portfolioId: string): Promise<string | null> {
  const { rows: [ex] } = await pool.query(`SELECT id FROM shipments WHERE order_id = $1`, [orderId]);
  if (ex) return ex.id;
  const { rows: [s] } = await pool.query(
    `INSERT INTO shipments (portfolio_id, order_id, status) VALUES ($1, $2, 'por_enviar') RETURNING id`,
    [portfolioId, orderId]);
  return s?.id || null;
}