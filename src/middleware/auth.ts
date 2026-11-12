import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: { id: string; role: string; portfolio_id?: string };
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token no proporcionado' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET!) as AuthRequest['user'];
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o vencido' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role))
      return res.status(403).json({ error: 'Acceso denegado' });
    next();
  };
}