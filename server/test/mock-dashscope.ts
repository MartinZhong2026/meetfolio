import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

/**
 * Local servers speaking the two DashScope protocols as documented in Alibaba's SDK/sample code.
 * They let us exercise the real adapter code (WebSocket, framing, JSON) without calling the paid API.
 * They prove protocol handling, NOT that the live service accepts our requests.
 */
export interface MockServer {
  url: string;
  received: Array<{ headers: http.IncomingHttpHeaders; url: string; messages: any[]; binaryBytes: number }>;
  onConn?: (ws: WebSocket, rec: MockServer['received'][number]) => void;
  rejectWith?: number;
  close(): Promise<void>;
}

export async function startMock(handler: (ws: WebSocket, rec: MockServer['received'][number], server: MockServer) => void, wsOpts: { autoPong?: boolean } = {}): Promise<MockServer> {
  const received: MockServer['received'] = [];
  const server: MockServer = { url: '', received, close: async () => {} };
  const httpServer = http.createServer();
  const wss = new WebSocketServer({ noServer: true, autoPong: wsOpts.autoPong ?? true });
  httpServer.on('upgrade', (req, socket, head) => {
    if (server.rejectWith) {
      socket.write(`HTTP/1.1 ${server.rejectWith} Rejected\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const rec = { headers: req.headers, url: req.url ?? '', messages: [] as any[], binaryBytes: 0 };
      received.push(rec);
      handler(ws, rec, server);
    });
  });
  await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
  const port = (httpServer.address() as AddressInfo).port;
  server.url = `ws://127.0.0.1:${port}`;
  server.close = async () => {
    for (const c of wss.clients) c.terminate();
    wss.close();
    await new Promise<void>((r) => httpServer.close(() => r()));
  };
  return server;
}

/** DashScope "inference" protocol (qwen-audio-*-asr-flash-streaming / Fun-ASR). */
export function inferenceHandler(opts: { failTask?: { code: string; message: string }; sentences?: (audioMs: number) => any[] } = {}) {
  return (ws: WebSocket, rec: MockServer['received'][number]) => {
    let taskId = '';
    let audioBytes = 0;
    let sentCount = 0;
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        audioBytes += (data as Buffer).length;
        rec.binaryBytes = audioBytes;
        for (const s of opts.sentences?.(audioBytes / 32) ?? []) {
          if (s.__n <= sentCount) continue;
          sentCount = s.__n;
          const { __n, ...sentence } = s;
          ws.send(JSON.stringify({ header: { task_id: taskId, event: 'result-generated', attributes: {} }, payload: { output: { sentence }, usage: null } }));
        }
        return;
      }
      const msg = JSON.parse(data.toString());
      rec.messages.push(msg);
      const action = msg.header?.action;
      if (action === 'run-task') {
        taskId = msg.header.task_id;
        if (opts.failTask) {
          ws.send(JSON.stringify({ header: { task_id: taskId, event: 'task-failed', error_code: opts.failTask.code, error_message: opts.failTask.message }, payload: {} }));
          return;
        }
        ws.send(JSON.stringify({ header: { task_id: taskId, event: 'task-started', attributes: {} }, payload: {} }));
      } else if (action === 'finish-task') {
        ws.send(JSON.stringify({ header: { task_id: taskId, event: 'task-finished', attributes: {} }, payload: { output: {}, usage: null } }));
        setTimeout(() => ws.close(1000), 5);
      }
    });
  };
}

/** DashScope Realtime protocol (qwen3-asr-flash-realtime). */
export function realtimeHandler(opts: { onAudio?: (ws: WebSocket, totalBytes: number) => void } = {}) {
  return (ws: WebSocket, rec: MockServer['received'][number]) => {
    let total = 0;
    ws.send(JSON.stringify({ event_id: 'e0', type: 'session.created', session: { id: 'sess_1' } }));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      rec.messages.push(msg);
      if (msg.type === 'session.update') ws.send(JSON.stringify({ event_id: 'e1', type: 'session.updated', session: msg.session }));
      else if (msg.type === 'input_audio_buffer.append') {
        total += Buffer.from(msg.audio, 'base64').length;
        rec.binaryBytes = total;
        opts.onAudio?.(ws, total);
      } else if (msg.type === 'session.finish') {
        ws.send(JSON.stringify({ event_id: 'e9', type: 'session.finished' }));
        setTimeout(() => ws.close(1000), 5);
      }
    });
  };
}
