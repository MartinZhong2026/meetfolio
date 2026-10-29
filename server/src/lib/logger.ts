import pino from 'pino';

export type Logger = pino.Logger;

/**
 * Logger that structurally cannot leak transcript content: callers only pass ids, counts and
 * error codes, and these field names are redacted defensively anyway.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: ['text', 'transcript', 'content', 'req.headers.cookie', 'req.headers.authorization', '*.text', '*.content', '*.password', 'password'],
      censor: '[redacted]',
    },
    serializers: {
      // Query strings can carry single-use tokens (password reset links); never log them.
      req: (req: { method?: string; url?: string; id?: string }) => ({ method: req.method, url: req.url?.split('?')[0], id: req.id }),
    },
  });
}
