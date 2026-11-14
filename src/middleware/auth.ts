import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: any;
  cookies?: Record<string, string>;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  // Prioriza la cookie, luego el header Authorization
  const authHeader = req.headers.authorization;
  const token = req.cookies?.token || (authHeader ? authHeader.split(' ')[1] : null);
  
  if (!token) {
    return res.status(401).json({ error: 'No autenticado: token no proporcionado' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acceso denegado: rol insuficiente' });
    }
    next();
  };
}
