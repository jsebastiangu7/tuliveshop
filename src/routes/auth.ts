import { Router } from 'express';
import type { Request, Response } from 'express';
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
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ token, user: { id: user.id, role: user.role, name: user.name, email: user.email }, portfolio, must_change_password: !!user.must_change_password });
  } catch (e: any) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ── Admin: olvidé contraseña (Correo + Documento) ── */
router.post('/admin/forgot-password', async (req: Request, res: Response) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const document = String(req.body.document || '').trim();
    
    // Buscamos un admin cuyo correo coincida Y el NIT/documento de su portafolio coincida
    const { rows: [user] } = await pool.query(
      `SELECT u.id, u.email, p.nit 
       FROM users u 
       JOIN portfolios p ON u.portfolio_id = p.id 
       WHERE u.email = $1 AND u.role IN ('admin','super_admin') AND (p.nit = $2 OR p.id::text = $2)`,
      [email, document]
    );

    if (user && user.email) {
      const temp = 'Tk' + Math.random().toString(36).slice(2, 8) + Math.floor(Math.random() * 90 + 10);
      await pool.query(`UPDATE users SET password_hash=$2, must_change_password=TRUE WHERE id=$1`,
        [user.id, await bcrypt.hash(temp, 10)]);
      await sendMail(user.email, 'Tu Live Shop · Recuperación de contraseña',
        `<p>Tu contraseña temporal es: <b>${temp}</b></p><p>Ingresa al panel y cámbiala cuando se te solicite.</p>`);
    }
    // Mensaje genérico por seguridad
    res.json({ ok: true, message: 'Si los datos coinciden, enviaremos una contraseña temporal a tu correo.' });
  } catch (e: any) { res.status(500).json({ error: 'Error del servidor' }); }
});

/* ── Cliente: login ── */
router.post('/client/login', async (req: Request, res: Response) => {
  try {
    const { whatsapp, pin } = req.body;
    const tel = String(whatsapp).replace(/\D/g, '');
    
    const { rows: [user] } = await pool.query(
      `SELECT * FROM users WHERE whatsapp=$1 AND role='client' AND status='Activo'`, [tel]
    );
    
    if (!user || !(await bcrypt.compare(String(pin), user.pin_hash))) {
      return res.status(401).json({ error: 'WhatsApp o PIN incorrectos' });
    }

    if (user.must_change_pin) {
      const token = sign(user);
      res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000 });
      return res.json({ 
        token, 
        user: { id: user.id, role: 'client', name: user.name, whatsapp: user.whatsapp, email: user.email },
        must_change_pin: true 
      });
    }

    if (user.portfolio_id) {
      const { rows: [pf] } = await pool.query(`SELECT id, name, slug FROM portfolios WHERE id=$1`, [user.portfolio_id]);
      const token = sign({ ...user, portfolio_id: pf.id });
      res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000 });
      return res.json({ 
        token, 
        user: { id: user.id, role: 'client', name: user.name, whatsapp: user.whatsapp, city: user.city, address: user.address, email: user.email }, 
        portfolio: { id: pf.id, slug: pf.slug, name: pf.name }
      });
    } else {
      const { rows: portfolios } = await pool.query(`SELECT id, name, slug FROM portfolios ORDER BY name`);
      const token = sign(user);
      res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000 });
      return res.json({
        needs_portfolio_selection: true,
        token,
        user: { id: user.id, role: 'client', name: user.name, whatsapp: user.whatsapp, email: user.email },
        portfolios
      });
    }
  } catch (e: any) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ── Cliente: registro (Soporta múltiples tiendas) ── */
router.post('/client/register', async (req: Request, res: Response) => {
  try {
    const { whatsapp, pin, name, city, address, email, portfolios } = req.body;
    if (!whatsapp || !pin || !name) return res.status(400).json({ error: 'WhatsApp, PIN y nombre son obligatorios' });
    if (String(pin).length < 4) return res.status(400).json({ error: 'El PIN debe tener al menos 4 dígitos' });
    if (!portfolios || !Array.isArray(portfolios) || portfolios.length === 0) {
      return res.status(400).json({ error: 'Debes seleccionar al menos una tienda' });
    }

    const tel = String(whatsapp).replace(/\D/g, '');
    const em = email ? String(email).toLowerCase().trim() : null;
    const pinHash = await bcrypt.hash(String(pin), 10);

    // Verificamos si ya existe en alguna de las tiendas seleccionadas
    const { rows: [existing] } = await pool.query(
      `SELECT * FROM users WHERE whatsapp=$1 AND role='client' AND portfolio_id = ANY($2::uuid[])`, 
      [tel, portfolios] // Nota: esto asume que portfolios es un array de slugs, necesitamos convertirlo a IDs
    );
    
    // Obtenemos los IDs de los portfolios
    const { rows: pfRows } = await pool.query(`SELECT id, slug FROM portfolios WHERE slug = ANY($1)`, [portfolios]);
    const pfIds = pfRows.map((p: any) => p.id);
    
    const { rows: [existingById] } = await pool.query(
      `SELECT * FROM users WHERE whatsapp=$1 AND role='client' AND portfolio_id = ANY($2)`, 
      [tel, pfIds]
    );

    if (existingById) {
      return res.status(400).json({ error: 'Este WhatsApp ya está registrado en una de las tiendas seleccionadas.' });
    }

    // Creamos un usuario por cada tienda seleccionada (para mantener compatibilidad con schema actual de 1 portfolio_id por user)
    const createdUsers = [];
    for (const pf of pfRows) {
      const { rows: [newUser] } = await pool.query(
        `INSERT INTO users (portfolio_id, role, whatsapp, pin_hash, name, city, address, email, status, must_change_pin)
         VALUES ($1,'client',$2,$3,$4,$5,$6,$7,'Activo', TRUE)
         RETURNING id,name,whatsapp,city,address,email`,
        [pf.id, tel, pinHash, String(name).trim(), city || null, address || null, em]
      );
      createdUsers.push(newUser);
    }

    const token = sign(createdUsers[0]); // Token basado en el primer usuario creado
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000 });
    
    res.json({ 
      token, 
      user: { ...createdUsers[0], role: 'client' }, 
      message: 'Registro exitoso.' 
    });
  } catch (e: any) { console.error(e); res.status(500).json({ error: 'Error del servidor: ' + e.message }); }
});

/* ── Cliente: obtener tiendas disponibles (para el registro) ── */
router.get('/client/portfolios', async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`SELECT id, name, slug FROM portfolios ORDER BY name`);
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: 'Error del servidor' }); }
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
    const { rows: [user] } = await pool.query(`SELECT * FROM users WHERE whatsapp=$1 AND role='client' AND LOWER(email)=LOWER($2)`, [tel, em]);
    if (user && user.email) {
      await pool.query(`UPDATE users SET pin_hash=$2, must_change_pin=TRUE WHERE id=$1`, [user.id, await bcrypt.hash('1234', 10)]);
      await sendMail(user.email, 'Tu Live Shop · PIN temporal', `<p>Tu PIN temporal es: <b>1234</b></p><p>Ingresa con tu WhatsApp y este PIN; la app te pedirá crear uno nuevo.</p>`);
    }
    res.json({ ok: true, message: 'Si el WhatsApp y el correo coinciden, enviaremos un PIN temporal.' });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
