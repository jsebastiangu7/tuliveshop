import { Request, Response, NextFunction } from 'express';

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  // Prevenir MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Prevenir clickjacking (no permitir iframes)
  res.setHeader('X-Frame-Options', 'DENY');
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Permissions policy (limitar APIs del navegador)
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Content Security Policy (solo recursos de confianza)
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://api.render.com;"
  );
  next();
}
