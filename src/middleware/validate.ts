import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      });
    }
    req.body = result.data;
    next();
  };
} 
