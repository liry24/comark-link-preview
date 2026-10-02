import { expect, it, vi } from 'vitest';
import { createPreviewService } from '../src/core/service.ts';
import type { PreviewSnapshot } from '../src/core/types.ts';
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
it('deduplicates fetches, delivers metadata independently and aborts only the last subscriber', async () => {
  let calls = 0;
  let aborts = 0;
  let publish: ((value: PreviewSnapshot) => void) | undefined;
  const service = createPreviewService({
    resolve: (_url, { signal, emit }) => {
      calls++;
      publish = emit;
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => {
          aborts++;
          reject(signal.reason);
        }),
      );
    },
  });
  const a: PreviewSnapshot[] = [];
  const b: PreviewSnapshot[] = [];
  const one = service.subscribe('https://example.com/#a', (value) => a.push(value));
  const two = service.subscribe('https://example.com/#b', (value) => b.push(value));
  await vi.waitFor(() => expect(calls).toBe(1));
  publish?.({ state: 'pending', metadata: { title: 'Arrived' } });
  expect(a.at(-1)?.metadata.title).toBe('Arrived');
  expect(b.at(-1)?.metadata.title).toBe('Arrived');
  one.unsubscribe();
  expect(aborts).toBe(0);
  two.unsubscribe();
  expect(aborts).toBe(1);
  service.dispose();
});
it('honors concurrency, prevents old cancelled completion from deleting new same-URL jobs', async () => {
  let calls = 0;
  const releases: Array<() => void> = [];
  const service = createPreviewService({
    concurrency: 1,
    resolve: async () => {
      calls++;
      await new Promise<void>((resolve) => releases.push(resolve));
      return { title: 'Ready' };
    },
  });
  const one = service.subscribe('https://example.com', () => {});
  await vi.waitFor(() => expect(calls).toBe(1));
  one.unsubscribe();
  const two = service.subscribe('https://example.com', () => {});
  releases.shift()?.();
  await vi.waitFor(() => expect(calls).toBe(2));
  const three = service.subscribe('https://example.com/#x', () => {});
  expect(calls).toBe(2);
  releases.shift()?.();
  await tick();
  two.unsubscribe();
  three.unsubscribe();
  service.dispose();
});
it('failed/partial snapshots are not cached and logs are bounded codes only', async () => {
  let calls = 0;
  const logs: unknown[] = [];
  const service = createPreviewService({
    logger: (event) => {
      logs.push(event);
      throw Error('logger');
    },
    resolve: async (_url, { emit }) => {
      calls++;
      emit({ state: 'pending', metadata: { title: 'Partial' } });
      throw Error('secret?token=do-not-log');
    },
  });
  for (let i = 0; i < 2; i++) {
    const events: PreviewSnapshot[] = [];
    const sub = service.subscribe('https://example.com', (value) => events.push(value));
    await vi.waitFor(() => expect(events.at(-1)?.state).toBe('failed'));
    sub.unsubscribe();
  }
  expect(calls).toBe(2);
  expect(logs).toEqual([{ code: 'network' }]);
  service.dispose();
});
it('one document byte limit does not fail another subscriber sharing its request', async () => {
  let deliver: (() => void) | undefined;
  const service = createPreviewService({
    resolve: async (_url, { consumeBytes }) => {
      await new Promise<void>((resolve) => {
        deliver = () => {
          consumeBytes?.(10);
          resolve();
        };
      });
      return { title: 'Shared success' };
    },
  });
  const one: PreviewSnapshot[] = [];
  const two: PreviewSnapshot[] = [];
  const limited = service.subscribe(
    'https://example.com',
    (value) => one.push(value),
    () => {
      throw Error('budget');
    },
  );
  const permitted = service.subscribe('https://example.com', (value) => two.push(value));
  await vi.waitFor(() => expect(deliver).toBeTypeOf('function'));
  deliver?.();
  await vi.waitFor(() => expect(two.at(-1)?.state).toBe('ready'));
  expect(one.at(-1)?.state).toBe('failed');
  limited.unsubscribe();
  permitted.unsubscribe();
  service.dispose();
});
