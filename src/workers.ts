import type { UrlPolicy } from './core/policy.ts';
import type { ServiceOptions } from './core/service.ts';
import { createResolver } from './metadata/resolver.ts';
import type { ResolverLimits, PreviewTransport } from './core/types.ts';
import { PreviewError } from './core/types.ts';
import { safeUrl } from './core/url.ts';

export interface WorkersResolverOptions extends UrlPolicy {
  /** Explicit deployment assertion: hosted Cloudflare Worker with this flag enabled. */
  publicFetch: 'global_fetch_strictly_public';
  limits?: Partial<ResolverLimits>;
}
/** Relies on hosted Workers public-network egress, not application-level DNS pinning. */
export function createWorkersResolver(options: WorkersResolverOptions): ServiceOptions {
  if (options?.publicFetch !== 'global_fetch_strictly_public')
    throw new TypeError(
      'Enable global_fetch_strictly_public on the deployed Worker before using this resolver',
    );
  const transport: PreviewTransport = async (input, signal) => {
    const url = safeUrl(input.href);
    if (!url) throw new PreviewError('invalid-url');
    // Do not forward Request, inbound headers, cf overrides, bindings or injected privileged fetch.
    const response = await globalThis.fetch(url.href, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: { accept: 'text/html' },
      credentials: 'omit',
    });
    return { status: response.status, headers: response.headers, body: response.body };
  };
  return {
    resolve: createResolver(transport, options.limits),
    policy: options,
    ...(options.limits?.deadlineMs ? { deadlineMs: options.limits.deadlineMs } : {}),
  };
}
