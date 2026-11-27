import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { pool } from '../db.js';

/**
 * Notificaciones push (Firebase Cloud Messaging).
 * Credencial: variable de entorno FIREBASE_SERVICE_ACCOUNT con el JSON de la cuenta de servicio
 * (en texto plano o en base64). Si no existe, los avisos se omiten en silencio y el resto del sistema sigue igual.
 * NUNCA se lanza una excepción desde aquí: un fallo de push no debe romper un abono, un envío ni una reserva.
 */

export type PushPayload = {
  title: string;
  body: string;
  /** Datos para la app (todo en texto). `type` indica qué pantalla refrescar/abrir. */
  data?: Record<string, string>;
};

let ready: boolean | null = null;

function init(): boolean {
  if (ready !== null) return ready;
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) { ready = false; console.warn('Push desactivado: falta FIREBASE_SERVICE_ACCOUNT'); return ready; }
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const sa = JSON.parse(text);
    if (!getApps().length) initializeApp({ credential: cert(sa) });
    ready = true;
  } catch (e: any) {
    ready = false;
    console.error('Push desactivado: credencial de Firebase inválida →', e?.message);
  }
  return ready;
}

/** Códigos de FCM que significan "este token ya no sirve" (app desinstalada, token vencido…) */
const DEAD = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

async function sendToTokens(tokens: string[], n: PushPayload): Promise<number> {
  if (!tokens.length || !init()) return 0;
  const messaging = getMessaging();
  let sent = 0;
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    try {
      const r = await messaging.sendEachForMulticast({
        tokens: chunk,
        notification: { title: n.title, body: n.body },
        data: n.data || {},
        android: { priority: 'high', notification: { channelId: 'avisos' } },
      });
      sent += r.successCount;
      const dead: string[] = [];
      r.responses.forEach((resp, idx) => {
        const code = resp.error?.code;
        const tk = chunk[idx];
        if (!resp.success && code && DEAD.has(code) && tk) dead.push(tk);
      });
      if (dead.length) await pool.query(`DELETE FROM device_tokens WHERE token = ANY($1)`, [dead]);
    } catch (e: any) {
      console.error('Push: error enviando lote →', e?.message);
    }
  }
  return sent;
}

/** Aviso a usuarios concretos (por id de usuario) */
export async function pushToUsers(userIds: string[], n: PushPayload): Promise<number> {
  try {
    if (!userIds.length) return 0;
    const { rows } = await pool.query(`SELECT DISTINCT token FROM device_tokens WHERE user_id = ANY($1::uuid[])`, [userIds]);
    return await sendToTokens(rows.map((r: any) => r.token), n);
  } catch (e: any) { console.error('Push: pushToUsers →', e?.message); return 0; }
}

/** Aviso a todos los dispositivos de una tienda: `client` (clientes con la app) o `admin` (administradores) */
export async function pushToPortfolio(portfolioId: string, role: 'client' | 'admin', n: PushPayload): Promise<number> {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT token FROM device_tokens WHERE portfolio_id = $1::uuid AND role = $2`, [portfolioId, role]);
    return await sendToTokens(rows.map((r: any) => r.token), n);
  } catch (e: any) { console.error('Push: pushToPortfolio →', e?.message); return 0; }
}

/** Cuántos dispositivos recibirían un aviso (para mostrarlo en el panel) */
export async function countDevices(portfolioId: string, role: 'client' | 'admin'): Promise<number> {
  const { rows: [r] } = await pool.query(
    `SELECT COUNT(DISTINCT token)::int AS n FROM device_tokens WHERE portfolio_id = $1::uuid AND role = $2`, [portfolioId, role]);
  return Number(r?.n || 0);
}
