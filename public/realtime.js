// Shared WebSocket client for live updates (cleaner.html, cleaners.html,
// properties.html, admin.html). Connects to the same-origin /ws endpoint —
// the session cookie rides along on the upgrade handshake automatically, so
// there's nothing to pass in the URL. Reconnects with simple backoff if the
// connection drops (server restart, network blip), and re-subscribes
// nothing extra: handlers registered via onRealtime stay registered across
// reconnects since they're stored outside the socket itself.
//
// Message shape on the wire: { "type": "pick:claimed", "payload": {...} }
// (see src/realtime/broadcast.ts). Unknown types are ignored — a page only
// reacts to the types it subscribed to.

(function () {
  const handlers = new Map(); // type -> Set<handler>
  const RECONNECT_MIN_MS = 500;
  const RECONNECT_MAX_MS = 10000;
  let reconnectDelay = RECONNECT_MIN_MS;
  let socket = null;

  function dispatch(type, payload) {
    const set = handlers.get(type);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        console.error("realtime handler error for", type, err);
      }
    }
  }

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/ws`);

    socket.addEventListener("open", () => {
      reconnectDelay = RECONNECT_MIN_MS;
    });

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message.type !== "string") return;
      dispatch(message.type, message.payload);
    });

    socket.addEventListener("close", () => {
      socket = null;
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    });

    socket.addEventListener("error", () => {
      // "close" always follows "error" for a WebSocket, so the reconnect
      // scheduling above is enough — nothing to do here but avoid an
      // unhandled-error console spam from the default action.
    });
  }

  /** Subscribes `handler(payload)` to every message of `type`. */
  window.onRealtime = function onRealtime(type, handler) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(handler);
  };

  connect();
})();
