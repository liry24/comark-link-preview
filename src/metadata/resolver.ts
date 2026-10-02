import {
  PreviewError,
  type PreviewResolver,
  type PreviewTransport,
  type ResolverLimits,
} from '../core/types.ts';
import { safeUrl } from '../core/url.ts';
import { createMetadataParser } from './parser.ts';

const defaults: ResolverLimits = {
  deadlineMs: 8000,
  maxBytes: 512_000,
  maxRedirects: 5,
  maxFieldLength: 2048,
  maxImages: 8,
};
export function createResolver(
  transport: PreviewTransport,
  limits: Partial<ResolverLimits> = {},
): PreviewResolver {
  if (typeof transport !== 'function') throw new TypeError('An explicitly safe transport is required');
  const config = { ...defaults, ...limits };
  for (const [key, value] of Object.entries(config))
    if (!Number.isSafeInteger(value) || value < (key === 'maxRedirects' ? 0 : 1))
      throw new TypeError('Invalid resolver limits');
  return async (input, options) => {
    const controller = new AbortController();
    const cancel = () => controller.abort(options.signal.reason);
    options.signal.addEventListener('abort', cancel, { once: true });
    if (options.signal.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new PreviewError('timeout')), config.deadlineMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      let url = safeUrl(input);
      if (!url) throw new PreviewError('invalid-url');
      let response;
      for (let redirects = 0; ; redirects++) {
        controller.signal.throwIfAborted();
        response = await transport(url, controller.signal);
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        await response.body?.cancel();
        if (redirects >= config.maxRedirects) throw new PreviewError('limit');
        const location = response.headers.get('location');
        if (!location) throw new PreviewError('http');
        const from = url;
        try {
          url = safeUrl(new URL(location, url).href);
        } catch {
          url = undefined;
        }
        if (!url) throw new PreviewError('invalid-url');
        await options.authorizeRedirect?.(url, from);
      }
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel();
        throw new PreviewError('http');
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!/^text\/html(?:\s*;|$)/iu.test(contentType)) {
        await response.body?.cancel();
        throw new PreviewError('content-type');
      }
      const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/iu)?.[1]?.toLowerCase();
      if (charset && !['utf-8', 'utf8', 'us-ascii'].includes(charset)) {
        await response.body?.cancel();
        throw new PreviewError('encoding');
      }
      const parser = createMetadataParser({
        url: url.href,
        maxFieldLength: config.maxFieldLength,
        maxImages: config.maxImages,
        emit: (metadata) => options.emit({ state: 'pending', metadata }),
      });
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let count = 0;
      reader = response.body?.getReader();
      if (!reader) throw new PreviewError('parse');
      while (true) {
        controller.signal.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        if (!part.value) throw new PreviewError('parse');
        count += part.value.byteLength;
        if (count > config.maxBytes) throw new PreviewError('limit');
        options.consumeBytes?.(part.value.byteLength);
        try {
          parser.write(decoder.decode(part.value, { stream: true }));
        } catch {
          throw new PreviewError('encoding');
        }
        if (parser.done) break;
      }
      controller.signal.throwIfAborted();
      try {
        parser.write(decoder.decode());
      } catch {
        throw new PreviewError('encoding');
      }
      const metadata = parser.end();
      options.emit({ state: 'ready', metadata });
      return metadata;
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', cancel);
      try {
        await reader?.cancel();
      } catch {
        /* The remote may already have closed. */
      }
      reader?.releaseLock();
    }
  };
}
