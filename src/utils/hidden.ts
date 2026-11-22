import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

/**
 * Tienda oculta: los clientes no la ven ni pueden operar en ella; el administrador sigue trabajando normal.
 * Se consulta con una caché corta (15 s) para no ir a la base de datos en cada petición.
 */
const cache = new Map<string, { hidden: boolean; at: number }>();
const TTL = 15000;

export function clearHiddenCache() { cache.clear(); }

export async function isPortfolioHidden(id: string): Promise<boolean> {
  const c = cache.get(id);
  if (c && Date.now() - c.at < TTL) return c.hidden;
  const { rows: [r] } = await pool.query(`SELECT hidden FROM portfolios WHERE id = $1`, [id]);
  const hidden = !!r?.hidden;
  cache.set(id, { hidden, at: Date.now() });
  return hidden;
}

/** Bloquea a los CLIENTES de una tienda oculta (admin y superadmin pasan). Va antes de las rutas de pedidos. */
export async function blockHiddenForClients(req: Request, res: Response, next: NextFunction) {
  try {
    const h = req.headers.authorization;
    const token = (h && h.startsWith('Bearer ') ? h.slice(7) : null) || (req as any).cookies?.token || null;
    if (!token) return next();
    let d: any;
    try { d = jwt.verify(token, process.env.JWT_SECRET as string); } catch { return next(); } // el token inválido lo rechaza authenticate
    if (d?.role === 'client' && d.portfolio_id && await isPortfolioHidden(d.portfolio_id))
      return res.status(403).json({ error: 'Esta tienda no está disponible por ahora', code: 'store_hidden' });
    next();
  } catch (e) { next(e); }
}
