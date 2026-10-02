import type { ComarkPlugin, ElementNode, Node } from 'comark';
import { createFetchResolver, type FetchResolverOptions } from './fetch.ts';
import { createPreviewService } from './core/service.ts';
import type { CacheOptions } from './core/cache.ts';
import { PreviewError, type PreviewLogger, type PreviewSnapshot } from './core/types.ts';
import { safeText, safeUrl, fetchIdentity } from './core/url.ts';
import { previewNode, type MediaUrlResolver } from './render/web.ts';
import { ensureBrowserInteractions } from './browser.ts';

export interface LinkPreviewOptions extends FetchResolverOptions, CacheOptions {
  concurrency?: number;
  maxUrls?: number;
  maxDocumentBytes?: number;
  logger?: PreviewLogger;
  maxLogEvents?: number;
  mediaUrl?: MediaUrlResolver;
  /** Text-oriented output for terminal renderers. */
  output?: 'web' | 'ansi';
}
export type { UrlAuthorizationContext } from './core/policy.ts';
export type { MediaUrlResolver } from './render/web.ts';

/** Resolve explicit preview components before Comark returns the rendered document. */
export function linkPreview(options: LinkPreviewOptions = {}): ComarkPlugin {
  const maxUrls = options.maxUrls ?? 100;
  const maxBytes = options.maxDocumentBytes ?? 4_000_000;
  if (!Number.isSafeInteger(maxUrls) || maxUrls < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new TypeError('Invalid document limits');
  const service = createPreviewService({ ...options, ...createFetchResolver(options) });
  return {
    name: 'link-preview',
    async post(state) {
      if (options.output !== 'ansi') ensureBrowserInteractions();
      let count = 0;
      let bytes = 0;
      const requests = new Map<string, Promise<PreviewSnapshot>>();
      const failed: PreviewSnapshot = { state: 'failed', metadata: {} };
      const read = (href: string): Promise<PreviewSnapshot> => {
        const identity = fetchIdentity(href);
        const existing = requests.get(identity);
        if (existing) return existing;
        if (requests.size >= maxUrls) return Promise.resolve(failed);
        const promise = new Promise<PreviewSnapshot>((resolve) => {
          const subscription = service.subscribe(
            href,
            (snapshot) => {
              if (snapshot.state !== 'pending') {
                resolve(snapshot);
                queueMicrotask(() => subscription.unsubscribe());
              }
            },
            (size) => {
              bytes += size;
              if (bytes > maxBytes) throw new PreviewError('limit');
            },
          );
        });
        requests.set(identity, promise);
        return promise;
      };
      // Stable across server/client parses of the same Markdown; no ambient document context.
      let hash = 2166136261;
      for (const character of state.markdown) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      const walk = async (node: Node, interactive = false): Promise<Node> => {
        if (typeof node === 'string' || node[0] === null) return node;
        if (node[0] === 'inline-preview' || node[0] === 'preview-card') {
          const id = `clp-${(hash >>> 0).toString(36)}-${count++}`;
          const href = typeof node[1].href === 'string' ? safeUrl(node[1].href)?.href : undefined;
          const title = typeof node[1].title === 'string' ? safeText(node[1].title) : undefined;
          const snapshot = href && !interactive ? await read(href) : failed;
          if (interactive) return ['span', {}, title ?? href ?? 'Link preview'];
          if (options.output === 'ansi') {
            const label = title ?? snapshot.metadata.title ?? href ?? 'Link preview';
            const link: ElementNode = href ? ['a', { href }, label] : ['span', {}, label];
            return node[0] === 'preview-card' && snapshot.state === 'ready'
              ? [
                  'p',
                  {},
                  link,
                  ...(snapshot.metadata.description ? [' — ' + snapshot.metadata.description] : []),
                  ...(snapshot.metadata.siteName ? [' (' + snapshot.metadata.siteName + ')'] : []),
                ]
              : link;
          }
          return previewNode(
            {
              id,
              kind: node[0],
              ...(title ? { title } : {}),
              ...(href ? { href } : {}),
              snapshot,
            },
            options.mediaUrl,
          );
        }
        const [tag, attributes, ...children] = node;
        return [
          tag,
          attributes,
          ...(await Promise.all(
            children.map((child) => walk(child, interactive || ['a', 'button'].includes(tag))),
          )),
        ];
      };
      state.tree.nodes = await Promise.all(state.tree.nodes.map((node) => walk(node)));
    },
  };
}
export default linkPreview;
