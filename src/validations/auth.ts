import { z } from 'zod';

export const adminLoginSchema = z.object({
  email: z.string().email('Email inválido').max(100),
  password: z.string().min(6, 'Mínimo 6 caracteres').max(128),
});

export const clientLoginSchema = z.object({
  whatsapp: z.string().min(8, 'WhatsApp inválido').max(20),
  // 4 a 8: acepta el PIN inicial 1234 y los PIN antiguos; los NUEVOS deben ser de 6 a 8 dígitos
  pin: z.string().min(4, 'PIN inválido').max(8, 'PIN inválido'),
  portfolio_slug: z.string().max(50).optional(),
});

export const pinRule = z.string().regex(/^\d{6,8}$/, 'El PIN debe tener de 6 a 8 dígitos (solo números)');

export const clientRegisterSchema = z.object({
  name: z.string().trim().min(2, 'Escribe tu nombre completo').max(100),
  whatsapp: z.string().min(8, 'WhatsApp inválido').max(20),
  email: z.string().trim().email('Correo electrónico inválido').max(120),
  pin: pinRule,
  city: z.string().max(100).optional().or(z.literal('')),
  address: z.string().max(300).optional().or(z.literal('')),
  // Una o varias tiendas (también acepta el campo antiguo portfolio_slug)
  portfolios: z.array(z.string().min(1).max(50)).min(1, 'Elige al menos una tienda').max(30).optional(),
  portfolio_slug: z.string().min(1).max(50).optional(),
}).refine(d => (d.portfolios && d.portfolios.length) || d.portfolio_slug, { message: 'Elige al menos una tienda', path: ['portfolios'] });
