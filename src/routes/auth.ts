import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { pool } from '../db.js';
import { validate } from '../middleware/validate.js';
import { adminLoginSchema, clientLoginSchema, clientRegisterSchema } from '../validations/auth.js';

const router = Router();

const sign = (u: any) => jwt.sign(
  { id: u.id, role: u.role, portfolio_id: u.portfolio_id },
  process.env.JWT_SECRET!,
  { expiresIn: u.role === 'client' ? '30d' : '7d' }
);

function mailer() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT) || 465,
    secure: Number(SMTP_PORT) !== 587, auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendMail(to: string, subject: string, html: string) {
  const t = mailer();
  if (!t) throw new Error('El envío de correo no está configurado (SMTP). Define SMTP_HOST/SMTP_USER/SMTP_PASS en Render.');
  await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, html });
}

const authUser = (req: any) => {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : (req.cookies?.token || null);
  if (!tok) throw new Error('No autenticado');
  return jwt.verify(tok, process.env.JWT_SECRET!) as any;
};

/* ── Admin: login ── */
router.post('/admin/login', validate(adminLoginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const { rows: [user] } = await pool.query(
      `SELECT * FROM users WHERE email=$1 AND role IN ('admin','super_admin') AND status='Activo'`,
      [String(email).toLowerCase().trim()]);
    
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Credenciales inválidas' });
    
    let portfolio = null;
    if (user.portfolio_id) {
      const { rows: [pf] } = await pool.query(`SELECT id,name,slug FROM portfolios WHERE id=$1`, [user.portfolio_id]);
      portfolio = pf;
    }
    
    const token = sign(user);
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      token,
      user: { id: user.id, role: user.role, name: user.name, email: user.email },
      portfolio,
      must_change_password: !!user.must_change_password
    });
  } catch (e: any) { console.error(e); res.status(500).json({ error: 'Error del servidor: ' + e.message }); }
});

/* ── Admin: cambiar contraseña ── */
router.post('/admin/change-password', async (req: Request, res: Response) => {
  try {
    const u = authUser(req);
    const np = String(req.body.new_password || '');
    if (np.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    await pool.query(`UPDATE users SET password_hash=$2, must_change_password=FALSE WHERE id=$1`,
      [u.id, await bcrypt.hash(np, 10)]);
    res.json({ ok: true });
  } catch (e: any) { res.status(401).json({ error: e.message || 'No autenticado' }); }
});

/* ── Admin: olvidé contraseña ── */
router.post('/admin/forgot-password', async (req: Request, res: Response) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const { rows: [user] } = await pool.query(
      `SELECT * FROM users WHERE email=$1 AND role IN ('admin','super_admin')`, [email]);
    
    if (user && user.email) {
      const temp = 'Pk' + Math.random().toString(36).slice(2, 8) + Math.floor(Math.random() * 90 + 10);
      await pool.query(`UPDATE users SET password_hash=$2, must_change_password=TRUE WHERE id=$1`,
        [user.id, await bcrypt.hash(temp, 10)]);
      await sendMail(user.email, 'Tu Live Shop · Contraseña temporal',
        `<p>Tu contraseña temporal es: <b>${temp}</b></p><p>Ingresa al panel y cámbiala cuando se te solicite.</p>`);
    }
    res.json({ ok: true, message: 'Si el correo existe, enviaremos una contraseña temporal.' });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── Cliente: login ── */
router.post('/client/login', validate(clientLoginSchema), async (req: Request, res: Response) => {
  try {
    const { whatsapp, pin, portfolio_slug } = req.body;
    const tel = String(whatsapp).replace(/\D/g, '');
    
    let query = `SELECT * FROM users WHERE whatsapp=$1 AND role='client' AND status='Activo'`;
    let params: any[] = [tel];
    
    if (portfolio_slug) {
      const { rows: [pf] } = await pool.query(`SELECT id FROM portfolios WHERE slug=$1`, [portfolio_slug]);
      if (!pf) return res.status(404).json({ error: 'Tienda no encontrada' });
      query += ` AND portfolio_id=$2`;
      params.push(pf.id);
    }

    const { rows: users } = await pool.query(query, params);
    
    // Filtrar usuarios que tengan PIN (o aceptar 1234 si no tienen)
    const validUsers = users.filter((u: any) => {
      if (!u.pin_hash) return String(pin) === '1234';
      return true;
    });

    if (validUsers.length === 0) {
      return res.status(401).json({ error: 'WhatsApp o PIN incorrectos.' });
    }

    // Si hay múltiples tiendas, devolvemos la lista para que el cliente elija
    if (validUsers.length > 1 && !portfolio_slug) {
      const { rows: portfolios } = await pool.query(
        `SELECT id, name, slug FROM portfolios WHERE id IN (${validUsers.map((_: any, i: number) => `$${i+1}`).join(',')})`,
        validUsers.map((u: any) => u.portfolio_id)
      );
      return res.json({ 
        multiple_stores: portfolios.map((p: any) => ({ slug: p.slug, name: p.name })),
        message: 'Selecciona una tienda'
      });
    }

    const user = validUsers[0];

    // Si no tiene PIN, lo creamos con 1234 y forzamos el cambio
    if (!user.pin_hash) {
      await pool.query(`UPDATE users SET pin_hash=$2, must_change_pin=TRUE WHERE id=$1`, 
        [user.id, await bcrypt.hash('1234', 10)]);
      user.pin_hash = await bcrypt.hash('1234', 10);
      user.must_change_pin = true;
    }
    
    if (!(await bcrypt.compare(String(pin), user.pin_hash))) {
      return res.status(401).json({ error: 'WhatsApp o PIN incorrectos.' });
    }

    const { rows: [pf] } = await pool.query(`SELECT id, name, slug FROM portfolios WHERE id=$1`, [user.portfolio_id]);
    
    const token = sign(user);
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.json({
      token,
      user: { id: user.id, role: 'client', name: user.name, whatsapp: user.whatsapp, city: user.city, address: user.address, email: user.email },
      portfolio: { id: pf.id, slug: pf.slug, name: pf.name },
      must_change_pin: !!user.must_change_pin
    });
  } catch (e: any) { console.error(e); res.status(500).json({ error: 'Error del servidor: ' + e.message }); }
});

/* ── Cliente: registro ── */
router.post('/client/register', validate(clientRegisterSchema), async (req: Request, res: Response) => {
  try {
    const { whatsapp, pin, name, city, address, email, portfolio_slug } = req.body;
    const { rows: [pf] } = await pool.query(`SELECT id FROM portfolios WHERE slug=$1`, [portfolio_slug]);
    if (!pf) return res.status(404).json({ error: 'Tienda no encontrada' });
    
    const tel = String(whatsapp).replace(/\D/g, '');
    const em = email ? String(email).toLowerCase().trim() : null;
    
    const { rows: [existing] } = await pool.query(
      `SELECT * FROM users WHERE whatsapp=$1 AND portfolio_id=$2 AND role='client'`, [tel, pf.id]);
    
    const pinHash = await bcrypt.hash(String(pin), 10);
    
    if (existing) {
      const { rows: [user] } = await pool.query(
        `UPDATE users SET pin_hash=$2, name=$3, city=COALESCE($4,city), address=COALESCE($5,address), email=COALESCE($6,email), status='Activo', must_change_pin=FALSE
         WHERE id=$1 RETURNING id,name,whatsapp,city,address,email`,
        [existing.id, pinHash, String(name).trim(), city || null, address || null, em]);
      
      const token = sign(user);
      res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000 });
      return res.json({ token, user: { ...user, role: 'client' }, portfolio: { id: pf.id, slug: pf.slug, name: pf.name } });
    }
    
    const { rows: [user] } = await pool.query(
      `INSERT INTO users (portfolio_id, role, whatsapp, pin_hash, name, city, address, email, status)
       VALUES ($1,'client',$2,$3,$4,$5,$6,$7,'Activo') RETURNING id,name,whatsapp,city,address,email`,
      [pf.id, tel, pinHash, String(name).trim(), city || null, address || null, em]);
    
    const token = sign(user);
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ token, user: { ...user, role: 'client' }, portfolio: { id: pf.id, slug: pf.slug, name: pf.name } });
  } catch (e: any) { console.error(e); res.status(500).json({ error: 'Error del servidor: ' + e.message }); }
});

/* ── Cliente: cambiar PIN ── */
router.post('/client/change-pin', async (req: Request, res: Response) => {
  try {
    const u = authUser(req);
    const np = String(req.body.new_pin || '');
    if (np.length < 4) return res.status(400).json({ error: 'El PIN debe tener al menos 4 dígitos' });
    await pool.query(`UPDATE users SET pin_hash=$2, must_change_pin=FALSE WHERE id=$1`, [u.id, await bcrypt.hash(np, 10)]);
    res.json({ ok: true });
  } catch (e: any) { res.status(401).json({ error: e.message || 'No autenticado' }); }
});

/* ── Cliente: olvidé mi PIN ── */
router.post('/client/forgot-pin', async (req: Request, res: Response) => {
  try {
    const tel = String(req.body.whatsapp || '').replace(/\D/g, '');
    const em = String(req.body.email || '').toLowerCase().trim();
    
    const { rows: [user] } = await pool.query(
      `SELECT * FROM users WHERE whatsapp=$1 AND role='client' AND LOWER(email)=LOWER($2)`, [tel, em]);
    
    if (user && user.email) {
      await pool.query(`UPDATE users SET pin_hash=$2, must_change_pin=TRUE WHERE id=$1`, [user.id, await bcrypt.hash('1234', 10)]);
      await sendMail(user.email, 'Tu Live Shop · PIN temporal',
        `<p>Tu PIN temporal es: <b>1234</b></p><p>Ingresa con tu WhatsApp y este PIN; la app te pedirá crear uno nuevo.</p>`);
    }
    res.json({ ok: true, message: 'Si el WhatsApp y el correo coinciden, enviaremos un PIN temporal.' });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;