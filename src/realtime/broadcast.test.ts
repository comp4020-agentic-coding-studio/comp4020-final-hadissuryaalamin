import { describe, expect, it, vi } from "vitest";
import { broadcast, registerClient } from "./broadcast.ts";

// Unit tests for the in-memory client registry/broadcast, in isolation: no
// Fastify app, no real `ws` server, no network. A fake "socket" is just the
// minimal shape broadcast.ts actually touches — readyState, send(), and an
// `on(event, handler)` registry so registerClient's close/error wiring can
// be exercised and triggered manually.
const OPEN = 1;
const CLOSED = 3;

function fakeSocket(readyState: number = OPEN) {
  const handlers = new Map<string, () => void>();
  return {
    readyState,
    send: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      handlers.set(event, handler);
    }),
    // Test helper, not part of the real ws.WebSocket surface: fires whatever
    // handler registerClient attached for `event`.
    trigger(event: string) {
      handlers.get(event)?.();
    },
  };
}

describe("registerClient", () => {
  it("adds a socket so it receives subsequent broadcasts", () => {
    const socket = fakeSocket();
    registerClient(socket as never);

    broadcast({ type: "pick:claimed", payload: { property_id: 1 } });

    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "pick:claimed", payload: { property_id: 1 } }));
  });

  it("removes the socket once it closes, so it gets no further broadcasts", () => {
    const socket = fakeSocket();
    registerClient(socket as never);
    socket.trigger("close");

    broadcast({ type: "ranks:changed" });

    expect(socket.send).not.toHaveBeenCalled();
  });

  it("removes the socket on error, so it gets no further broadcasts", () => {
    const socket = fakeSocket();
    registerClient(socket as never);
    socket.trigger("error");

    broadcast({ type: "ranks:changed" });

    expect(socket.send).not.toHaveBeenCalled();
  });
});

describe("broadcast", () => {
  it("sends the JSON-stringified event to every registered open socket", () => {
    const a = fakeSocket();
    const b = fakeSocket();
    registerClient(a as never);
    registerClient(b as never);

    broadcast({ type: "pick:released", payload: { property_id: 7 } });

    const expected = JSON.stringify({ type: "pick:released", payload: { property_id: 7 } });
    expect(a.send).toHaveBeenCalledWith(expected);
    expect(b.send).toHaveBeenCalledWith(expected);
  });

  it("skips a socket that isn't open, without pruning it", () => {
    const notOpen = fakeSocket(CLOSED);
    registerClient(notOpen as never);

    broadcast({ type: "ranks:changed" });

    expect(notOpen.send).not.toHaveBeenCalled();
  });

  it("prunes a socket whose send() throws so a later broadcast doesn't retry it", () => {
    const flaky = fakeSocket();
    flaky.send.mockImplementation(() => {
      throw new Error("socket hung up");
    });
    const healthy = fakeSocket();
    registerClient(flaky as never);
    registerClient(healthy as never);

    // First broadcast: flaky throws (caught, not propagated) and gets pruned;
    // healthy still receives it.
    expect(() => broadcast({ type: "ranks:changed" })).not.toThrow();
    expect(flaky.send).toHaveBeenCalledTimes(1);
    expect(healthy.send).toHaveBeenCalledTimes(1);

    // Second broadcast: flaky is no longer registered, so send() isn't
    // called on it again; healthy still gets this one too.
    broadcast({ type: "ranks:changed" });
    expect(flaky.send).toHaveBeenCalledTimes(1);
    expect(healthy.send).toHaveBeenCalledTimes(2);
  });
});
