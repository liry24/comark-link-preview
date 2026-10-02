import { PreviewError } from './types.ts';
import { safeUrl } from './url.ts';
export interface UrlAuthorizationContext {
  kind: 'initial' | 'redirect';
  from?: URL;
  signal: AbortSignal;
}
export interface UrlPolicy {
  /** Native URLPattern strings. Undefined allows HTTP(S); [] denies every URL. */
  allowedUrls?: readonly string[];
  /** Authorization only. A DNS precheck does not constrain a later socket connection. */
  authorize?: (url: URL, context: UrlAuthorizationContext) => boolean | Promise<boolean>;
}
export function createUrlPolicy(options: UrlPolicy = {}) {
  const patterns = options.allowedUrls?.map((pattern) => new URLPattern(pattern));
  return async (url: URL, context: UrlAuthorizationContext): Promise<void> => {
    context.signal.throwIfAborted();
    if (!safeUrl(url.href)) throw new PreviewError('invalid-url');
    if (patterns && !patterns.some((pattern) => pattern.test(url.href))) throw new PreviewError('denied');
    if (options.authorize) {
      let allowed: boolean;
      try {
        allowed = await options.authorize(new URL(url.href), {
          ...context,
          ...(context.from ? { from: new URL(context.from.href) } : {}),
        });
      } catch {
        context.signal.throwIfAborted();
        throw new PreviewError('denied');
      }
      context.signal.throwIfAborted();
      // eslint-disable-next-line typescript/no-unnecessary-boolean-literal-compare -- JavaScript callbacks must return a real boolean.
      if (allowed !== true) throw new PreviewError('denied');
    }
  };
}
/** Bound caller-supplied asynchronous work even when it neglects the signal. */
export async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
