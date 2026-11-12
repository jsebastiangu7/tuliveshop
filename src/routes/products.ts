import { Router } from 'express';
import { pool } from '../db.js';
import { productAvailable } from '../services/inventory.js';

const router = Router();

const portfolioBySlug = async (slug: string) => {
  const { rows: [pf] } = await pool.query(`SELECT * FROM portfolios WHERE slug = $1`, [slug]);
  return pf || null;
};

// Catálogo público (stock disponible en tiempo real)
router.get('/portfolio/:slug', async (req, res) => {
  try {
    const pf = await portfolioBySlug(req.params.slug);
    if (!pf) return res.status(404).json({ error: 'Tienda no encontrada' });
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.code, p.price, p.image_url, c.name AS category,
        GREATEST(0, p.stock
          - COALESCE((SELECT SUM(oi.quantity) FROM order_items oi
                      JOIN orders o ON o.id = oi.order_id
                      WHERE oi.product_id = p.id AND o.status NOT IN ('canceled','expired')), 0)
          - COALESCE((SELECT SUM(oi.quantity * kc.quantity) FROM order_items oi
                      JOIN orders o ON o.id = oi.order_id
                      JOIN kit_components kc ON kc.kit_id = oi.kit_id
                      WHERE oi.kit_id IS NOT NULL AND kc.product_id = p.id
                        AND o.status NOT IN ('canceled','expired')), 0)
        ) AS available
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.portfolio_id = $1 ORDER BY p.name`,
      [pf.id]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

// Kits con disponibilidad calculada
router.get('/kits/:slug', async (req, res) => {
  try {
    const pf = await portfolioBySlug(req.params.slug);
    if (!pf) return res.status(404).json({ error: 'Tienda no encontrada' });
    const { rows: kits } = await pool.query(
      `SELECT id, name, price FROM kits WHERE portfolio_id = $1 ORDER BY name`, [pf.id]);
    const result = [];
    for (const k of kits) {
      const { rows: comps } = await pool.query(
        `SELECT kc.product_id, kc.quantity, p.name AS product_name
         FROM kit_components kc JOIN products p ON p.id = kc.product_id
         WHERE kc.kit_id = $1`, [k.id]);
      let min = Infinity;
      for (const c of comps) {
        const avail = await productAvailable(c.product_id);
        min = Math.min(min, Math.floor(avail / Math.max(1, Number(c.quantity))));
      }
      result.push({ ...k, components: comps, available: Number.isFinite(min) ? min : 0 });
    }
    res.json(result);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.get('/categories/:slug', async (req, res) => {
  const pf = await portfolioBySlug(req.params.slug);
  if (!pf) return res.status(404).json({ error: 'Tienda no encontrada' });
  const { rows } = await pool.query(
    `SELECT * FROM categories WHERE portfolio_id = $1 ORDER BY name`, [pf.id]);
  res.json(rows);
});

// Configuración pública de la tienda (Bre-b, WhatsApp)
router.get('/config/:slug', async (req, res) => {
  const pf = await portfolioBySlug(req.params.slug);
  if (!pf) return res.status(404).json({ error: 'Tienda no encontrada' });
  res.json({
    id: pf.id, name: pf.name, slug: pf.slug,
    bre_b_key: pf.bre_b_key, whatsapp_number: pf.whatsapp_number,
    whatsapp_template: pf.whatsapp_template, order_prefix: pf.order_prefix,
  });
});

export default router;