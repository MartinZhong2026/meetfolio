import { expect, test, vi } from 'vitest';
import { createCloseRequestHandler } from '../src/close-request';
test('late startup registration and repeated delivery flush audio/notebook exactly once', async () => {
  let ready = false;
  let finish!: (value: boolean) => void;
  const flush = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const reply = vi.fn();
  const request = createCloseRequestHandler(() => ready, flush, reply);
  request('close-1'); await Promise.resolve();
  expect(flush).not.toHaveBeenCalled(); expect(reply).not.toHaveBeenCalled();
  ready = true;
  request('close-1'); request('close-1'); await Promise.resolve();
  expect(flush).toHaveBeenCalledTimes(1); expect(reply).not.toHaveBeenCalled();
  finish(true); await vi.waitFor(() => expect(reply).toHaveBeenCalledWith('close-1', true));
  request('close-1');
  expect(flush).toHaveBeenCalledTimes(1);
  expect(reply).toHaveBeenLastCalledWith('close-1', true);
});
test('failed flush reports failure and a later user close can retry with a new token', async () => {
  const flush = vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue(true);
  const reply = vi.fn(); const request = createCloseRequestHandler(() => true, flush, reply);
  request('first'); await vi.waitFor(() => expect(reply).toHaveBeenCalledWith('first', false));
  request('second'); await vi.waitFor(() => expect(reply).toHaveBeenCalledWith('second', true));
  expect(flush).toHaveBeenCalledTimes(2);
});
