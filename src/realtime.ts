import type { Server as SocketServer } from 'socket.io';

let io: SocketServer | null = null;

export function setIO(server: SocketServer) { io = server; }

/** Emite solo a los navegadores suscritos al portafolio (tienda) */
export function emitPortfolio(portfolioId: string, event: string, payload: any) {
  io?.to(`portfolio:${portfolioId}`).emit(event, payload);
}

/** Emite a todos los conectados (tienda y panel) */
export function emitAll(event: string, payload: any) {
  io?.emit(event, payload);
}