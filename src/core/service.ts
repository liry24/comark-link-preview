import { createUrlPolicy, withAbort, type UrlPolicy } from './policy.ts';
import { createPreviewCache, validMetadata, type CacheOptions } from './cache.ts';
import { PreviewError, type PreviewLogger, type PreviewResolver, type PreviewSnapshot } from './types.ts';
import { fetchIdentity } from './url.ts';

export interface ServiceOptions extends CacheOptions {
  resolve: PreviewResolver;
  policy?: UrlPolicy;
  concurrency?: number;
  deadlineMs?: number;
  logger?: PreviewLogger;
  maxLogEvents?: number;
}
export interface PreviewSubscription {
  unsubscribe(): void;
}
export interface PreviewService {
  subscribe(
    url: string,
    listener: (snapshot: PreviewSnapshot) => void,
    consumeBytes?: (bytes: number) => void,
  ): PreviewSubscription;
  dispose(): void;
}
interface Listener {
  emit: (snapshot: PreviewSnapshot) => void;
  consumeBytes?: (bytes: number) => void;
}
interface Job {
  identity: string;
  listeners: Set<Listener>;
  controller: AbortController;
  snapshot: PreviewSnapshot;
  started: boolean;
  timer?: ReturnType<typeof setTimeout>;
}
/** Instance-local deduplication and concurrency. Sharing a service is always explicit. */
export function createPreviewService(options: ServiceOptions): PreviewService {
  const concurrency = options.concurrency ?? 4;
  const deadlineMs = options.deadlineMs ?? 8000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1) throw new TypeError('Invalid deadline');
  const maxLogs = options.maxLogEvents ?? 20;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || !Number.isSafeInteger(maxLogs) || maxLogs < 0)
    throw new TypeError('Invalid service limits');
  const cache = createPreviewCache(options);
  const authorize = createUrlPolicy(options.policy);
  const jobs = new Map<string, Job>();
  const logged = new Set<string>();
  let active = 0;
  let disposed = false;
  function emit(job: Job, snapshot: PreviewSnapshot) {
    if (job.controller.signal.aborted) return;
    job.snapshot = structuredClone(snapshot);
    if (snapshot.state !== 'pending' && jobs.get(job.identity) === job) jobs.delete(job.identity);
    for (const listener of job.listeners) listener.emit(structuredClone(snapshot));
  }
  function log(error: unknown) {
    const code = error instanceof PreviewError ? error.code : 'network';
    if (logged.has(code) || logged.size >= maxLogs) return;
    logged.add(code);
    try {
      options.logger?.({ code });
    } catch {
      /* Diagnostics never break rendering. */
    }
  }
  async function run(job: Job) {
    active++;
    job.started = true;
    try {
      const initialUrl = new URL(job.identity);
      await withAbort(
        authorize(initialUrl, { kind: 'initial', signal: job.controller.signal }),
        job.controller.signal,
      );
      const cached = await withAbort(cache.get(job.identity), job.controller.signal);
      job.controller.signal.throwIfAborted();
      if (cached) {
        let from = initialUrl;
        for (const href of cached.redirects) {
          const url = new URL(href);
          await withAbort(
            authorize(url, { kind: 'redirect', from, signal: job.controller.signal }),
            job.controller.signal,
          );
          from = url;
        }
        emit(job, { state: 'ready', metadata: cached.metadata });
        return;
      }
      const redirects: string[] = [];
      const metadata = await withAbort(
        options.resolve(job.identity, {
          signal: job.controller.signal,
          async authorizeRedirect(url, from) {
            await withAbort(
              authorize(url, { kind: 'redirect', from, signal: job.controller.signal }),
              job.controller.signal,
            );
            redirects.push(url.href);
          },
          emit(snapshot) {
            if (!validMetadata(snapshot.metadata) || !['pending', 'ready', 'failed'].includes(snapshot.state))
              throw new PreviewError('parse');
            // Only the settled resolver may transition to terminal success and cache.
            emit(job, {
              state: snapshot.state === 'ready' ? 'pending' : snapshot.state,
              metadata: snapshot.metadata,
            });
          },
          consumeBytes(bytes) {
            for (const listener of [...job.listeners]) {
              try {
                listener.consumeBytes?.(bytes);
              } catch (error) {
                log(error);
                listener.emit({ state: 'failed', metadata: {} });
                job.listeners.delete(listener);
              }
            }
            if (!job.listeners.size) {
              job.controller.abort();
              job.controller.signal.throwIfAborted();
            }
          },
        }),
        job.controller.signal,
      );
      job.controller.signal.throwIfAborted();
      if (!validMetadata(metadata)) throw new PreviewError('parse');
      // A remote driver may never settle. Persistence must not own the render or concurrency slot.
      void cache.set(job.identity, metadata, redirects);
      emit(job, { state: 'ready', metadata });
    } catch (error) {
      if (!job.controller.signal.aborted) {
        log(error);
        emit(job, { state: 'failed', metadata: {} });
      }
    } finally {
      clearTimeout(job.timer);
      active--;
      if (!job.listeners.size && jobs.get(job.identity) === job) jobs.delete(job.identity);
      pump();
    }
  }
  function pump() {
    if (disposed) return;
    for (const job of jobs.values()) {
      if (active >= concurrency) break;
      if (!job.started && job.listeners.size && !job.controller.signal.aborted) void run(job);
    }
  }
  return {
    subscribe(url, listener, consumeBytes) {
      if (disposed) throw new Error('Preview service is disposed');
      const identity = fetchIdentity(url);
      let job = jobs.get(identity);
      if (!job) {
        job = {
          identity,
          listeners: new Set(),
          controller: new AbortController(),
          snapshot: { state: 'pending', metadata: {} },
          started: false,
        };
        jobs.set(identity, job);
        const queued = job;
        job.timer = setTimeout(() => {
          const error = new PreviewError('timeout');
          log(error);
          emit(queued, { state: 'failed', metadata: {} });
          queued.controller.abort(error);
        }, deadlineMs);
      }
      const entry: Listener = { emit: listener, ...(consumeBytes ? { consumeBytes } : {}) };
      job.listeners.add(entry);
      listener(structuredClone(job.snapshot));
      pump();
      let removed = false;
      return {
        unsubscribe() {
          if (removed) return;
          removed = true;
          job.listeners.delete(entry);
          if (!job.listeners.size) {
            clearTimeout(job.timer);
            job.controller.abort();
            if (jobs.get(identity) === job) jobs.delete(identity);
          }
        },
      };
    },
    dispose() {
      disposed = true;
      for (const job of jobs.values()) {
        job.listeners.clear();
        clearTimeout(job.timer);
        job.controller.abort();
      }
      jobs.clear();
    },
  };
}
