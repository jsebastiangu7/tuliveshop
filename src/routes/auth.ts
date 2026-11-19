import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { pool } from '../db.js';
import { validate } from '../middleware/validate.js';
import { adminLoginSchema, clientLoginSchema, clientRegisterSchema } from '../validations/auth.js';
import { randomBytes, randomInt } from 'node:crypto';

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
  } catch (e: any) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
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
      const temp = 'Tk' + randomBytes(6).toString('base64url') + randomInt(10, 100);
      await sendMail(user.email, 'Tu Live Shop · Contraseña temporal',
        `<p>Tu contraseña temporal es: <b>${temp}</b></p><p>Ingresa al panel y cámbiala cuando se te solicite.</p>`);
      await pool.query(`UPDATE users SET password_hash=$2, must_change_password=TRUE WHERE id=$1`,
        [user.id, await bcrypt.hash(temp, 10)]);
    }
    res.json({ ok: true, message: 'Si el correo existe, enviaremos una contraseña temporal.' });
  } catch (e: any) { console.error(e); res.status(500).json({ error: 'No se pudo procesar la solicitud' }); }
});

/* ═══════════════ CLIENTES ═══════════════
   Un cliente se identifica por su WhatsApp. Si está en varias tiendas, hay una fila en `users`
   por tienda (así pedidos, abonos y logística de cada tienda siguen separados).        */

const COOKIE_OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, maxAge: 30 * 24 * 60 * 60 * 1000 };
const digits = (v: any) => String(v ?? '').replace(/\D/g, '');
const PIN_DEFAULT = '1234'; // PIN inicial de clientes que ya existen en una tienda y nunca han ingresado

/** Datos del cliente que ve el navegador */
const clientView = (u: any, mustChange = false) => ({
  id: u.id, role: 'client', name: u.name, whatsapp: u.whatsapp, city: u.city, address: u.address, email: u.email,
  must_change_pin: mustChange || !!u.must_change_pin,
});

/** PIN demasiado fácil: repetido (111111) o secuencia (123456 / 654321) */
const weakPin = (p: string) => /^(\d)\1+$/.test(p) || '01234567890'.includes(p) || '09876543210'.includes(p);

/* ── Cliente: tiendas disponibles para darse de alta ── */
router.get('/client/portfolios', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`SELECT name, slug FROM portfolios ORDER BY name`);
    res.json(rows);
  } catch (e: any) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ── Cliente: login ──
   WhatsApp + PIN, sin elegir tienda: se entra a todas las tiendas donde ese WhatsApp ya tiene cuenta
   con ese PIN. Si el cliente existe en una tienda pero nunca había ingresado, su PIN inicial es 1234
   y la app lo obliga a crear uno nuevo. */
router.post('/client/login', validate(clientLoginSchema), async (req: Request, res: Response) => {
  try {
    const { whatsapp, pin, portfolio_slug } = req.body;
    const tel = digits(whatsapp);
    const { rows } = await pool.query(
      `SELECT u.*, p.slug AS p_slug, p.name AS p_name FROM users u JOIN portfolios p ON p.id = u.portfolio_id
       WHERE u.whatsapp=$1 AND u.role='client' AND u.status='Activo' ORDER BY p.name`, [tel]);

    const matches: any[] = [];
    let hash1234: string | null = null;
    for (const u of rows) {
      if (!u.pin_hash) {
        // Nunca había ingresado: acepta 1234 y queda obligado a cambiarlo
        if (String(pin) !== PIN_DEFAULT) continue;
        hash1234 = hash1234 || await bcrypt.hash(PIN_DEFAULT, 10);
        await pool.query(`UPDATE users SET pin_hash=$2, must_change_pin=TRUE WHERE id=$1`, [u.id, hash1234]);
        u.pin_hash = hash1234; u.must_change_pin = true;
        matches.push(u);
      } else if (await bcrypt.compare(String(pin), u.pin_hash)) {
        matches.push(u);
      }
    }
    if (!matches.length) return res.status(401).json({ error: 'WhatsApp o PIN incorrectos' });

    const stores = matches.map(u => ({ slug: u.p_slug, name: u.p_name, token: sign(u), user: clientView(u) }));
    const primary = (portfolio_slug && stores.find(s => s.slug === portfolio_slug)) || stores[0];
    res.cookie('token', primary.token, COOKIE_OPTS);
    res.json({
      token: primary.token,
      user: primary.user,
      portfolio: { id: matches[stores.indexOf(primary)].portfolio_id, slug: primary.slug, name: primary.name },
      must_change_pin: !!primary.user.must_change_pin,
      stores,
    });
  } catch (e: any) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ── Cliente: registro ──
   Datos personales + correo + PIN de 6 a 8 dígitos + una o varias tiendas.
   Si el WhatsApp ya existe en cualquier tienda NO se crea de nuevo (evita robar cuentas): debe iniciar
   sesión (PIN inicial 1234 si nunca ha ingresado) o usar "Olvidé mi PIN". */
router.post('/client/register', validate(clientRegisterSchema), async (req: Request, res: Response) => {
  const db = await pool.connect();
  try {
    const { name, whatsapp, email, pin, city, address } = req.body;
    const slugs: string[] = [...new Set<string>(req.body.portfolios?.length ? req.body.portfolios : [req.body.portfolio_slug])];
    const tel = digits(whatsapp);
    if (tel.length < 8) return res.status(400).json({ error: 'WhatsApp inválido' });
    if (weakPin(String(pin))) return res.status(400).json({ error: 'Ese PIN es muy fácil de adivinar. Elige otro (evita 123456 o 111111).' });

    const { rows: stores } = await db.query(`SELECT id, slug, name FROM portfolios WHERE slug = ANY($1)`, [slugs]);
    if (stores.length !== slugs.length) return res.status(404).json({ error: 'Alguna de las tiendas elegidas no existe' });

    const { rows: [dup] } = await db.query(`SELECT 1 AS x FROM users WHERE whatsapp=$1 AND role='client' LIMIT 1`, [tel]);
    if (dup) return res.status(409).json({ error: 'Este WhatsApp ya tiene cuenta. Inicia sesión; si nunca has ingresado, tu PIN inicial es 1234. Si lo olvidaste, usa "¿Olvidaste tu PIN?".' });

    const pinHash = await bcrypt.hash(String(pin), 10);
    const em = String(email).toLowerCase().trim();
    await db.query('BEGIN');
    const created: any[] = [];
    for (const st of stores) {
      const { rows: [u] } = await db.query(
        `INSERT INTO users (portfolio_id, role, whatsapp, pin_hash, name, city, address, email, status)
         VALUES ($1,'client',$2,$3,$4,$5,$6,$7,'Activo')
         RETURNING id,name,whatsapp,city,address,email,role,portfolio_id`,
        [st.id, tel, pinHash, String(name).trim(), city || null, address || null, em]);
      created.push({ st, u });
    }
    await db.query('COMMIT');

    // Se mantiene el orden en que el cliente eligió las tiendas
    created.sort((a, b) => slugs.indexOf(a.st.slug) - slugs.indexOf(b.st.slug));
    const list = created.map(({ st, u }) => ({ slug: st.slug, name: st.name, token: sign(u), user: clientView(u) }));
    const first = list[0]!, firstStore = created[0]!.st;
    res.cookie('token', first.token, COOKIE_OPTS);
    res.json({
      token: first.token, user: first.user,
      portfolio: { id: firstStore.id, slug: first.slug, name: first.name },
      stores: list,
    });
  } catch (e: any) {
    try { await db.query('ROLLBACK'); } catch { /* sin transacción abierta */ }
    if (e.code === '23505') {
      // Restricción única en la base de datos (p. ej. WhatsApp o correo únicos a nivel global)
      console.error('Registro: restricción única violada →', e.constraint, e.detail);
      return res.status(409).json({ error: 'No se pudo crear la cuenta porque el WhatsApp o el correo ya existen en el sistema.' });
    }
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  } finally { db.release(); }
});

/* ── Cliente: cambiar PIN (obligatorio en el primer ingreso): 6 a 8 dígitos ── */
router.post('/client/change-pin', async (req: Request, res: Response) => {
  let u: any;
  try { u = authUser(req); } catch (e: any) { return res.status(401).json({ error: 'No autenticado' }); }
  try {
    if (u.role !== 'client') return res.status(403).json({ error: 'Solo para clientes' });
    const np = String(req.body.new_pin || '');
    if (!/^\d{6,8}$/.test(np)) return res.status(400).json({ error: 'El PIN debe tener de 6 a 8 dígitos (solo números)' });
    if (weakPin(np)) return res.status(400).json({ error: 'Ese PIN es muy fácil de adivinar. Elige otro (evita 123456 o 111111).' });

    const hash = await bcrypt.hash(np, 10);
    const { rows: [me] } = await pool.query(`UPDATE users SET pin_hash=$2, must_change_pin=FALSE WHERE id=$1 RETURNING whatsapp`, [u.id, hash]);

    // Sus otras tiendas que SIGUEN con el PIN inicial 1234 reciben el mismo PIN nuevo (para no pedirle
    // cambiarlo tienda por tienda). Nunca se tocan las que ya tienen un PIN propio o temporal.
    const updated: string[] = [u.id];
    if (me?.whatsapp) {
      const { rows: sibs } = await pool.query(
        `SELECT id, pin_hash FROM users WHERE whatsapp=$1 AND role='client' AND id<>$2 AND must_change_pin=TRUE AND pin_hash IS NOT NULL`,
        [me.whatsapp, u.id]);
      for (const s of sibs) {
        if (await bcrypt.compare(PIN_DEFAULT, s.pin_hash)) {
          await pool.query(`UPDATE users SET pin_hash=$2, must_change_pin=FALSE WHERE id=$1`, [s.id, hash]);
          updated.push(s.id);
        }
      }
    }
    res.json({ ok: true, updated });
  } catch (e: any) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ── Cliente con sesión: ver y actualizar sus datos ──
   Se actualizan en TODAS las tiendas donde ese WhatsApp tiene cuenta, para que cada tienda tenga el dato vigente.
   El WhatsApp no se edita aquí: es su llave de ingreso y de todas sus tiendas. */
router.get('/client/me', async (req: Request, res: Response) => {
  let u: any;
  try { u = authUser(req); } catch { return res.status(401).json({ error: 'No autenticado' }); }
  try {
    if (u.role !== 'client') return res.status(403).json({ error: 'Solo para clientes' });
    const { rows: [me] } = await pool.query(`SELECT name, whatsapp, email, city, address FROM users WHERE id=$1 AND role='client'`, [u.id]);
    if (!me) return res.status(404).json({ error: 'Cuenta no encontrada' });
    res.json(me);
  } catch (e: any) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

router.put('/client/me', async (req: Request, res: Response) => {
  let u: any;
  try { u = authUser(req); } catch { return res.status(401).json({ error: 'No autenticado' }); }
  try {
    if (u.role !== 'client') return res.status(403).json({ error: 'Solo para clientes' });
    const name = String(req.body.name ?? '').trim();
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const city = String(req.body.city ?? '').trim();
    const address = String(req.body.address ?? '').trim();
    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Escribe tu nombre completo' });
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Correo electrónico inválido' });
    if (city.length > 100 || address.length > 300) return res.status(400).json({ error: 'Ciudad o dirección demasiado largas' });
    const { rows: [me] } = await pool.query(`SELECT whatsapp FROM users WHERE id=$1 AND role='client'`, [u.id]);
    if (!me) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const { rows } = await pool.query(
      `UPDATE users SET name=$2, email=COALESCE(NULLIF($3,''), email), city=NULLIF($4,''), address=NULLIF($5,'')
       WHERE role='client' AND whatsapp=$1 RETURNING id, name, whatsapp, email, city, address, portfolio_id`,
      [me.whatsapp, name, email, city, address]);
    const mine = rows.find((r: any) => r.id === u.id) || rows[0];
    res.json({ ok: true, stores_updated: rows.length, user: { id: mine.id, role: 'client', name: mine.name, whatsapp: mine.whatsapp, email: mine.email, city: mine.city, address: mine.address } });
  } catch (e: any) { console.error(e); res.status(500).json({ error: 'Error del servidor' }); }
});

/* ── Cliente con sesión: darse de alta en otras tiendas ──
   Copia sus datos y su PIN actual a una fila nueva por tienda. Devuelve solo las tiendas agregadas. */
router.post('/client/add-stores', async (req: Request, res: Response) => {
  let u: any;
  try { u = authUser(req); } catch { return res.status(401).json({ error: 'No autenticado' }); }
  const db = await pool.connect();
  try {
    if (u.role !== 'client') return res.status(403).json({ error: 'Solo para clientes' });
    const slugs: string[] = [...new Set<string>(Array.isArray(req.body.portfolios) ? req.body.portfolios.map(String) : [])].slice(0, 30);
    if (!slugs.length) return res.status(400).json({ error: 'Selecciona al menos una tienda' });

    const { rows: [me] } = await db.query(`SELECT * FROM users WHERE id=$1 AND role='client'`, [u.id]);
    if (!me) return res.status(404).json({ error: 'Cuenta no encontrada' });
    const { rows: stores } = await db.query(`SELECT id, slug, name FROM portfolios WHERE slug = ANY($1)`, [slugs]);
    if (stores.length !== slugs.length) return res.status(404).json({ error: 'Alguna de las tiendas elegidas no existe' });

    await db.query('BEGIN');
    const added: any[] = [];
    for (const st of stores) {
      const { rows: [ex] } = await db.query(`SELECT 1 AS x FROM users WHERE whatsapp=$1 AND role='client' AND portfolio_id=$2`, [me.whatsapp, st.id]);
      if (ex) continue; // ya está inscrito en esa tienda
      const { rows: [n] } = await db.query(
        `INSERT INTO users (portfolio_id, role, whatsapp, pin_hash, name, city, address, email, status, must_change_pin)
         VALUES ($1,'client',$2,$3,$4,$5,$6,$7,'Activo',$8)
         RETURNING id,name,whatsapp,city,address,email,role,portfolio_id,must_change_pin`,
        [st.id, me.whatsapp, me.pin_hash, me.name, me.city, me.address, me.email, !!me.must_change_pin]);
      added.push({ slug: st.slug, name: st.name, token: sign(n), user: clientView(n) });
    }
    await db.query('COMMIT');
    res.json({ added });
  } catch (e: any) {
    try { await db.query('ROLLBACK'); } catch { /* sin transacción abierta */ }
    console.error(e); res.status(500).json({ error: 'Error del servidor' });
  } finally { db.release(); }
});

/* ── Cliente: olvidé mi PIN ──
   WhatsApp + correo registrado → PIN temporal aleatorio SOLO al correo del dueño; al ingresar con él
   la app obliga a crear uno nuevo. Aplica a todas sus tiendas que tengan ese correo. */
router.post('/client/forgot-pin', async (req: Request, res: Response) => {
  try {
    const tel = digits(req.body.whatsapp);
    const em = String(req.body.email || '').toLowerCase().trim();
    const ok = { ok: true, message: 'Si el WhatsApp y el correo coinciden, enviaremos un PIN temporal.' };
    if (tel.length < 8 || !em) return res.json(ok);

    const { rows } = await pool.query(
      `SELECT id, email FROM users WHERE whatsapp=$1 AND role='client' AND status='Activo' AND LOWER(email)=$2`, [tel, em]);
    if (rows.length) {
      const tempPin = String(randomInt(100000, 1000000));
      await sendMail(rows[0].email, 'Tu Live Shop · PIN temporal',
        `<p>Tu PIN temporal es: <b>${tempPin}</b></p><p>Ingresa con tu WhatsApp y este PIN; la app te pedirá crear uno nuevo de 6 a 8 dígitos.</p><p>Si no lo pediste tú, ignora este mensaje.</p>`);
      const hash = await bcrypt.hash(tempPin, 10);
      await pool.query(`UPDATE users SET pin_hash=$2, must_change_pin=TRUE WHERE id = ANY($1)`, [rows.map(r => r.id), hash]);
    }
    res.json(ok);
  } catch (e: any) { console.error(e); res.status(500).json({ error: 'No se pudo enviar el correo. Intenta más tarde.' }); }
});

/* ── Cerrar sesión: borra la cookie (el JS no puede, es httpOnly) ── */
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
  res.json({ ok: true });
});

export default router;
