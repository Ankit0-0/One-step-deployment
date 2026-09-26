import { io, type Socket } from 'socket.io-client';
import { env } from './env';

let socket: Socket | null = null;

/** One shared connection per tab, authenticated by the session cookie. */
export function getSocket(): Socket {
  socket ??= io(env.NEXT_PUBLIC_API_URL, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });
  return socket;
}
