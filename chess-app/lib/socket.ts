import { io, Socket } from 'socket.io-client';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://chess-arena-backend-289232625557.asia-southeast2.run.app';

let socket: Socket | null = null;

export function getSocket(token: string): Socket {
  // Kembalikan socket yang sudah ada meskipun sedang reconnecting.
  // Bug lama: `socket?.connected` menyebabkan socket BARU dibuat saat fase
  // reconnecting, sehingga socket baru tidak punya listener dari useEffect
  // dan game state menjadi orphan.
  if (socket) return socket;

  socket = io(BACKEND_URL, {
    auth: { token },
    // 'websocket' pertama = langsung upgrade ke WS, skip polling handshake.
    // Polling sebagai fallback jika WS diblokir (corporate proxy, dll).
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocketInstance(): Socket | null {
  return socket;
}
