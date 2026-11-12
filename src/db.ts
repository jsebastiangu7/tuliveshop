import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Si existe DATABASE_URL (nube) se usa esa; si no, las variables locales de tu PC
const useUrl = !!process.env.DATABASE_URL;
const needSsl = useUrl || process.env.DB_SSL === 'true';
const ssl = needSsl ? { rejectUnauthorized: false } : undefined;

export const pool = new Pool(
  useUrl
    ? { connectionString: process.env.DATABASE_URL, ssl }
    : {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: Number(process.env.DB_PORT) || 5432,
        ssl,
      }
);

pool.on('error', (err) => console.error('❌ Error en PostgreSQL:', err));