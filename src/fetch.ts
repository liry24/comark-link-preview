import { createResolver } from './metadata/resolver.ts';
import type { ResolverLimits } from './core/types.ts';
import type { UrlPolicy } from './core/policy.ts';
import type { ServiceOptions } from './core/service.ts';
export interface FetchResolverOptions extends UrlPolicy {
  limits?: Partial<ResolverLimits>;
  /** Optional app-controlled fetch. Authorization hooks alone do not enforce connection policy. */
  fetch?: typeof globalThis.fetch;
}
/** Uses the runtime’s native Fetch API. URL authorization is not a complete SSRF or public-egress guarantee. */
export function createFetchResolver(options: FetchResolverOptions = {}): ServiceOptions {
  const fetch = options.fetch ?? globalThis.fetch;
  return {
    policy: options,
    ...(options.limits?.deadlineMs ? { deadlineMs: options.limits.deadlineMs } : {}),
    resolve: createResolver(async (url, signal) => {
      const response = await fetch(url.href, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { accept: 'text/html' },
        credentials: 'omit',
      });
      return { status: response.status, headers: response.headers, body: response.body };
    }, options.limits),
  };
}
