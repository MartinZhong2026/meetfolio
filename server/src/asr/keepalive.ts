import type WebSocket from 'ws';

/**
 * Transport-level heartbeat for the provider connection (DashScope's own SDK pings every 30 s). A half-open TCP
 * connection otherwise looks healthy until a send finally fails. If no pong arrives within `deadAfterMs` the socket is
 * terminated, which the pipeline treats as an abnormal disconnect and recovers from.
 * Returns a function that stops the timer.
 */
export function keepAlive(ws: WebSocket, intervalMs: number, deadAfterMs = intervalMs * 2.5): () => void {
  let lastPong = Date.now();
  const onPong = () => (lastPong = Date.now());
  ws.on('pong', onPong);
  const timer = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    if (Date.now() - lastPong > deadAfterMs) {
      ws.terminate();
      return;
    }
    try {
      ws.ping();
    } catch {
      /* socket closing */
    }
  }, intervalMs);
  timer.unref();
  const stop = () => {
    clearInterval(timer);
    ws.off('pong', onPong);
  };
  ws.once('close', stop);
  return stop;
}
