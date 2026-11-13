import type { Request, Response, NextFunction } from 'express';
   import jwt from 'jsonwebtoken';

   export interface AuthRequest extends Request {
     user?: any;
   }

   export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
     // Prioriza la cookie, luego el header Authorization
     const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
     
     if (!token) {
       return res.status(401).json({ error: 'No autenticado: token no proporcionado' });
     }

     try {
       const decoded = jwt.verify(token, process.env.JWT_SECRET!);
       req.user = decoded;
       next();
     } catch (e) {
       return res.status(401).json({ error: 'Token inválido o expirado' });
     }
      import { pool } from '../db.js'; // Asegúrate de importar el pool

   // Dentro de la función authenticate, después de req.user = decoded:
   if (req.user.portfolio_id) {
     await pool.query("SET LOCAL app.current_portfolio_id = $1", [req.user.portfolio_id]);
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
