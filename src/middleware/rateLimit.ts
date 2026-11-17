import rateLimit from 'express-rate-limit';

// Login: 10 intentos FALLIDOS cada 15 minutos por IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos. Intenta en 15 minutos.' },
  skipSuccessfulRequests: true, // solo cuentan los intentos fallidos (listar tiendas o entrar bien no gasta cupo)
  standardHeaders: true,
  legacyHeaders: false,
});

// Panel admin: 100 peticiones por minuto
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Demasiadas peticiones' },
  standardHeaders: true,
  legacyHeaders: false,
});
