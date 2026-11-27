import { Router } from 'express';
import { pool } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import { pushToPortfolio, countDevices } from '../services/push.js';

const router = Router();

/** Mínimo entre dos anuncios de live de la misma tienda (evita que los clientes silencien la app) */
const LIVE_COOLDOWN_MIN = 10;

/**
 * La app registra aquí el token del celular. Un cliente con varias tiendas tiene un usuario por tienda,
 * así que la app llama una vez por cada sesión; la primera con reset=true limpia lo anterior de ese dispositivo
 * (si otra persona usaba el mismo celular, deja de recibir los avisos de la anterior).
 */
router.post('/register', authenticate, requireRole('client', 'admin'), async (req: AuthRequest, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (token.length < 20 || token.length > 4096) return res.status(400).json({ error: 'Token inválido' });
    if (req.body?.reset === true) await pool.query(`DELETE FROM device_tokens WHERE token = $1`, [token]);
    await pool.query(
      `INSERT INTO device_tokens (user_id, portfolio_id, role, token) VALUES ($1::uuid, $2::uuid, $3, $4)
       ON CONFLICT (user_id, token) DO UPDATE SET updated_at = NOW()`,
      [req.user!.id, req.user!.portfolio_id, req.user!.role, token]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/** Al cerrar sesión en la app: el dispositivo deja de recibir avisos de ese usuario */
router.post('/unregister', authenticate, async (req: AuthRequest, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (token) await pool.query(`DELETE FROM device_tokens WHERE token = $1 AND user_id = $2::uuid`, [token, req.user!.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/** Administrador: cuántos clientes recibirían el anuncio y si puede enviarlo ya */
router.get('/live', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const pf = req.user!.portfolio_id as string;
    const { rows: [p] } = await pool.query(
      `SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM (last_live_push_at + ($2 || ' minutes')::interval - NOW())) / 60))::int AS wait_min
       FROM portfolios WHERE id = $1::uuid`, [pf, String(LIVE_COOLDOWN_MIN)]);
    res.json({ devices: await countDevices(pf, 'client'), wait_min: Number(p?.wait_min || 0) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/** Administrador: "Anunciar Live" → push a todos los clientes de SU tienda que tienen la app */
router.post('/live', authenticate, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const pf = req.user!.portfolio_id as string;
    const extra = String(req.body?.message || '').replace(/\s+/g, ' ').trim().slice(0, 120);

    // Reserva el cupo de forma atómica: si dos clics llegan a la vez, solo uno pasa
    const { rows: [claimed] } = await pool.query(
      `UPDATE portfolios SET last_live_push_at = NOW()
       WHERE id = $1::uuid AND (last_live_push_at IS NULL OR last_live_push_at < NOW() - ($2 || ' minutes')::interval)
       RETURNING name`, [pf, String(LIVE_COOLDOWN_MIN)]);
    if (!claimed) {
      return res.status(429).json({ error: `Ya anunciaste un live hace poco. Puedes volver a avisar cada ${LIVE_COOLDOWN_MIN} minutos.` });
    }

    const sent = await pushToPortfolio(pf, 'client', {
      title: `🔴 ¡${claimed.name} está en vivo!`,
      body: extra || 'Entra ahora y activa el Modo compra para no perderte nada.',
      data: { type: 'live_started' },
    });
    res.json({ ok: true, sent });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

export default router;
