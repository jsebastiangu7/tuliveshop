import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';

const router = Router();

const sign = (u: any) => jwt.sign(
  { id: u.id, role: u.role, portfolio_id: u.portfolio_id },
  process.env.JWT_SECRET!,
  { expiresIn: u.role === 'client' ? '30d' : '7d' }
);

// Admin: email + contraseña
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

    const { rows: [user] } = await pool.query(
      `SELECT * FROM users WHERE email = $1 AND role IN ('admin','super_admin') AND status = 'Activo'`,
      [email.toLowerCase().trim()]
    );
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Credenciales inválidas' });

    let portfolio = null;
    if (user.portfolio_id) {
      const { rows: [pf] } = await pool.query(
        `SELECT id, name, slug FROM portfolios WHERE id = $1`, [user.portfolio_id]);
      portfolio = pf;
    }
    res.json({
      token: sign(user),
      user: { id: user.id, role: user.role, name: user.name, email: user.email },
      portfolio,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

// Cliente: WhatsApp + PIN
router.post('/client/login', async (req, res) => {
  try {
    const { whatsapp, pin, portfolio_slug } = req.body;
    if (!whatsapp || !pin || !portfolio_slug)
      return res.status(400).json({ error: 'WhatsApp, PIN y tienda requeridos' });

    const { rows: [pf] } = await pool.query(`SELECT id FROM portfolios WHERE slug = $1`, [portfolio_slug]);
    if (!pf) return res.status(404).json({ error: 'Tienda no encontrada' });

    const { rows: [user] } = await pool.query(
      `SELECT * FROM users WHERE whatsapp = $1 AND portfolio_id = $2 AND role = 'client' AND status = 'Activo'`,
      [String(whatsapp).replace(/\D/g, ''), pf.id]
    );
    if (!user) return res.status(401).json({ error: 'WhatsApp o PIN incorrectos' });
    if (!user.pin_hash)
      return res.status(401).json({ error: 'Cuenta importada: entra por "Crear cuenta" con tu WhatsApp para definir tu PIN y activarla' });
    if (!(await bcrypt.compare(pin, user.pin_hash)))
      return res.status(401).json({ error: 'WhatsApp o PIN incorrectos' });

    res.json({
      token: sign(user),
      user: {
        id: user.id, role: 'client', name: user.name, whatsapp: user.whatsapp,
        city: user.city, address: user.address, tiktok: user.tiktok, instagram: user.instagram, avatar: user.avatar,
      },
      portfolio: { id: pf.id, slug: portfolio_slug },
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

// Registro de cliente nuevo (o activación de cliente importado sin PIN)
router.post('/client/register', async (req, res) => {
  try {
    const { whatsapp, pin, name, city, address, portfolio_slug } = req.body;
    if (!whatsapp || !pin || !name || !portfolio_slug)
      return res.status(400).json({ error: 'WhatsApp, PIN, nombre y tienda son obligatorios' });
    if (String(pin).length < 4) return res.status(400).json({ error: 'El PIN debe tener al menos 4 dígitos' });

    const { rows: [pf] } = await pool.query(`SELECT id FROM portfolios WHERE slug = $1`, [portfolio_slug]);
    if (!pf) return res.status(404).json({ error: 'Tienda no encontrada' });

    const tel = String(whatsapp).replace(/\D/g, '');
    const { rows: [existing] } = await pool.query(
      `SELECT * FROM users WHERE whatsapp = $1 AND portfolio_id = $2 AND role = 'client'`, [tel, pf.id]);

    if (existing && !existing.pin_hash) {
      const pinHash = await bcrypt.hash(pin, 10);
      const { rows: [user] } = await pool.query(
        `UPDATE users SET pin_hash = $2, name = $3, city = COALESCE($4, city), address = COALESCE($5, address), status = 'Activo'
         WHERE id = $1 RETURNING id, name, whatsapp, city, address, tiktok, instagram, avatar`,
        [existing.id, pinHash, name.trim(), city || null, address || null]);
      return res.json({
        token: sign({ id: user.id, role: 'client', portfolio_id: pf.id }),
        user: { ...user, role: 'client' },
        portfolio: { id: pf.id, slug: portfolio_slug },
      });
    }
    if (existing) return res.status(400).json({ error: 'Este WhatsApp ya está registrado en esta tienda' });

    const pinHash = await bcrypt.hash(pin, 10);
    const { rows: [user] } = await pool.query(
      `INSERT INTO users (portfolio_id, role, whatsapp, pin_hash, name, city, address, status)
       VALUES ($1,'client',$2,$3,$4,$5,$6,'Activo')
       RETURNING id, name, whatsapp, city, address, tiktok, instagram, avatar`,
      [pf.id, tel, pinHash, name.trim(), city || null, address || null]
    );
    res.json({
      token: sign({ id: user.id, role: 'client', portfolio_id: pf.id }),
      user: { ...user, role: 'client' },
      portfolio: { id: pf.id, slug: portfolio_slug },
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

// Datos propios del cliente conectado
router.get('/me', authenticate, requireRole('client'), async (req: AuthRequest, res) => {
  try {
    const { rows: [u] } = await pool.query(
      `SELECT id, name, whatsapp, city, address, tiktok, instagram, avatar FROM users WHERE id = $1`, [req.user!.id]);
    if (!u) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ user: { ...u, role: 'client' } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

// El cliente actualiza su perfil (foto, datos, redes) y/o su dirección
router.put('/me', authenticate, requireRole('client'), async (req: AuthRequest, res) => {
  try {
    const b = req.body || {};
    let avatar: string | null = null;
    if (b.avatar !== undefined) {
      avatar = String(b.avatar);
      if (avatar.length > 2500000) return res.status(400).json({ error: 'La foto es demasiado pesada (máx ~1.5 MB)' });
      if (avatar !== '' && !/^data:image\/(png|jpe?g|webp);base64,/.test(avatar))
        return res.status(400).json({ error: 'Formato de imagen no válido (PNG, JPG o WEBP)' });
    }
    const { rows: [u] } = await pool.query(
      `UPDATE users SET
         name = COALESCE(NULLIF($2,''), name),
         city = COALESCE($3, city),
         address = COALESCE($4, address),
         tiktok = COALESCE($5, tiktok),
         instagram = COALESCE($6, instagram),
         avatar = COALESCE($7, avatar)
       WHERE id = $1 AND role = 'client'
       RETURNING id, name, whatsapp, city, address, tiktok, instagram, avatar`,
      [req.user!.id,
       b.name !== undefined ? String(b.name).trim() : null,
       b.city !== undefined ? String(b.city).trim() : null,
       b.address !== undefined ? String(b.address).trim() : null,
       b.tiktok !== undefined ? String(b.tiktok).trim() : null,
       b.instagram !== undefined ? String(b.instagram).trim() : null,
       avatar]);
    if (!u) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ user: { ...u, role: 'client' } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

export default router;