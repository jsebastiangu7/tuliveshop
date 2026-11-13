import { z } from 'zod';

export const adminLoginSchema = z.object({
  email: z.string().email('Email inválido').max(100),
  password: z.string().min(6, 'Mínimo 6 caracteres').max(128),
});

export const clientLoginSchema = z.object({
  whatsapp: z.string().min(8, 'WhatsApp inválido').max(20),
  pin: z.string().min(4, 'PIN inválido').max(8),
  portfolio_slug: z.string().min(1).max(50),
});

export const clientRegisterSchema = z.object({
  name: z.string().min(2).max(100),
  whatsapp: z.string().min(8).max(20),
  email: z.string().email().optional().or(z.literal('')),
  pin: z.string().min(4, 'PIN debe tener 4-8 dígitos').max(8),
  city: z.string().max(100).optional(),
  address: z.string().max(300).optional(),
  portfolio_slug: z.string().min(1).max(50),
});
