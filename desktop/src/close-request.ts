/** Retryable main→preload close delivery, with exactly-once audio/notebook flush per request. */
export function createCloseRequestHandler(ready: () => boolean, flush: () => Promise<boolean>, reply: (id: string, ok: boolean) => void) {
  let current: { id: string; done: boolean; ok: boolean } | null = null;
  return (id: string): void => {
    if (current?.id === id) {
      if (current.done) reply(id, current.ok);
      return;
    }
    // A window can be closed before React registers its notebook callback. Main retries delivery.
    if (!ready()) return;
    const request = { id, done: false, ok: false };
    current = request;
    void Promise.resolve().then(flush).then(ok => {
      request.done = true; request.ok = ok; reply(id, ok);
    }, () => {
      request.done = true; reply(id, false);
    });
  };
}
