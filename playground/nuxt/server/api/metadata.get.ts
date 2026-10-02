import { resolveFixture } from '../../../shared/fixture.ts';
export default defineEventHandler((event) => {
  const query = getQuery(event);
  const url = typeof query.url === 'string' ? query.url : '';
  if (!/^https:\/\/example\.test\/(article|no-image|no-icon|broken-image|empty|failure)$/.test(url))
    throw createError({ statusCode: 400, statusMessage: 'Unknown local fixture' });
  const settings = {
    fieldDelayMs: Math.max(0, Math.min(10000, Number(query.delay) || 0)),
    paused: false,
    forceFailure: query.fail === 'true',
  };
  const abort = new AbortController();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (value: unknown) => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(value) + '\n'));
      };
      try {
        const metadata = await resolveFixture(url, { signal: abort.signal, emit }, settings);
        emit({ state: 'ready', metadata });
      } catch {
        if (!abort.signal.aborted) emit({ state: 'failed', metadata: {} });
      } finally {
        if (!abort.signal.aborted) controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
  event.node.res.once('close', () => abort.abort());
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
  });
});
