import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { pool } from './db.js';
import { securityHeaders } from './middleware/security.js';
import { authLimiter, apiLimiter } from './middleware/rateLimit.js';
import { setIO, emitAll } from './realtime.js';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import orderRoutes from './routes/orders.js';
import adminRoutes from './routes/admin.js';
import superRoutes from './routes/super.js';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true },
});
setIO(io);

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(securityHeaders); // ← Solo una vez
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

// Tiempo real: cualquier cambio en bolsitas avisa a todos los navegadores conectados
app.use('/api/orders', (req, res, next) => {
  res.on('finish', () => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) emitAll('stock-updated', {});
  });
  next();
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', apiLimiter, adminRoutes);
app.use('/api/super', superRoutes);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'PostgreSQL conectada ✓', fecha: new Date().toISOString() });
  } catch {
    res.status(500).json({ status: 'error', db: 'sin conexión' });
  }
});

app.get('/', (req, res) => {
  const file = req.query.t ? 'index.html' : 'landing.html';
  res.sendFile(path.join(process.cwd(), 'public', file));
});

app.use(express.static(path.join(process.cwd(), 'public'), {
  index: false, // No permite listar el contenido de la carpeta
  dotfiles: 'deny', // Bloquea el acceso a archivos que empiezan con punto (.env, .git)
  extensions: ['html', 'js', 'css', 'png', 'jpg', 'jpeg', 'svg', 'ico', 'webp'], // Solo sirve estos tipos
  setHeaders: (res, path) => {
    if (path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache de 1 día para estáticos
    }
  }
}));

io.on('connection', (socket) => {
  socket.on('join-portfolio', (portfolioId: string) => socket.join(`portfolio:${portfolioId}`));
});

const PORT = Number(process.env.PORT) || 3001;
httpServer.listen(PORT, () => console.log(`🚀 Servidor en http://localhost:${PORT}`));
