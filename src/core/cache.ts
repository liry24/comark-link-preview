import { createStorage, type Storage } from 'unstorage';
import type { PreviewMetadata } from './types.ts';
import { safeText, safeUrl } from './url.ts';

export interface CacheOptions {
  storage?: Storage;
  /** Required for shared storage: isolate tenant, resolver and safety policy. */
  namespace?: string;
  ttlMs?: number;
}
export function validMetadata(value: unknown): value is PreviewMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as PreviewMetadata;
  for (const key of ['title', 'description', 'siteName'] as const) {
    if (data[key] !== undefined && (typeof data[key] !== 'string' || safeText(data[key]) !== data[key]))
      return false;
  }
  if (data.favicon !== undefined && (typeof data.favicon !== 'string' || !safeUrl(data.favicon, true)))
    return false;
  if (
    data.images !== undefined &&
    (!Array.isArray(data.images) ||
      data.images.length > 8 ||
      data.images.some(
        (image) =>
          !image ||
          !safeUrl(image.url, true) ||
          (image.alt !== undefined && safeText(image.alt) !== image.alt) ||
          (image.width !== undefined && (!Number.isSafeInteger(image.width) || image.width < 1)) ||
          (image.height !== undefined && (!Number.isSafeInteger(image.height) || image.height < 1)),
      ))
  )
    return false;
  return Object.keys(data).every((key) =>
    ['title', 'description', 'siteName', 'favicon', 'images'].includes(key),
  );
}
export interface CachedPreview {
  metadata: PreviewMetadata;
  redirects: string[];
}
export function createPreviewCache(options: CacheOptions = {}) {
  if (options.storage && !options.namespace)
    throw new TypeError('Shared storage requires an explicit tenant/resolver/policy namespace');
  const ttlMs = options.ttlMs ?? 300_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs must be positive');
  const storage = options.storage ?? createStorage();
  const namespace = options.namespace ?? 'instance';
  async function key(identity: string) {
    const bytes = new TextEncoder().encode(JSON.stringify([namespace, identity]));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return (
      'comark-preview:v2:' +
      Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
    );
  }
  return {
    async get(identity: string): Promise<CachedPreview | undefined> {
      try {
        const entry = await storage.getItem<{
          version: number;
          expiresAt: number;
          data: PreviewMetadata;
          redirects: string[];
        }>(await key(identity));
        if (
          entry?.version === 2 &&
          Number.isFinite(entry.expiresAt) &&
          entry.expiresAt > Date.now() &&
          validMetadata(entry.data) &&
          Array.isArray(entry.redirects) &&
          entry.redirects.length <= 20 &&
          entry.redirects.every((url) => typeof url === 'string' && safeUrl(url))
        )
          return { metadata: structuredClone(entry.data), redirects: [...entry.redirects] };
      } catch {
        /* Cache failure is a miss. */
      }
      return undefined;
    },
    async set(identity: string, data: PreviewMetadata, redirects: string[] = []): Promise<void> {
      if (!validMetadata(data)) return;
      try {
        await storage.setItem(await key(identity), {
          version: 2,
          expiresAt: Date.now() + ttlMs,
          data,
          redirects,
        });
      } catch {
        /* Rendering success does not depend on cache writes. */
      }
    },
  };
}
