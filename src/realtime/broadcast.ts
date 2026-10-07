import type { WebSocket } from "ws";

// In-memory registry of connected, authenticated WebSocket clients. No
// Fastify/HTTP dependency so it stays unit-testable without a running server.

export interface RealtimeEvent {
  type: string;
  payload?: unknown;
}

const clients = new Set<WebSocket>();

/** Adds a socket to the registry; removes it automatically on close/error. */
export function registerClient(socket: WebSocket): void {
  clients.add(socket);
  const remove = () => {
    clients.delete(socket);
  };
  socket.on("close", remove);
  socket.on("error", remove);
}

/** Sends `event` as JSON to every open socket. Dead sockets are pruned, never thrown. */
export function broadcast(event: RealtimeEvent): void {
  const message = JSON.stringify(event);
  for (const socket of [...clients]) {
    // 1 === WebSocket.OPEN
    if (socket.readyState !== 1) continue;
    try {
      socket.send(message);
    } catch {
      clients.delete(socket);
    }
  }
}
