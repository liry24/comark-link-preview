import { createPreviewController, type DocumentSnapshot, type PreviewController } from 'comark-link-preview';
import type { PreviewMetadata, PreviewResolver, ResolveOptions } from 'comark-link-preview';

export const fixtureSource = `# Comark link previews\n\nA [normal link](https://example.test/plain) stays a normal link.\n\nHover, focus, or tap :inline-preview{href="https://example.test/article"} while the next paragraph streams.\n\nThe same URL has its own view: :inline-preview{href="https://example.test/article" title="Author title wins"}.\n\n::preview-card{href="https://example.test/article"}\n::\n\nThis paragraph continues while metadata is still arriving.\n\n::preview-card{href="https://example.test/no-image"}\n::\n\nNo favicon: :inline-preview{href="https://example.test/no-icon"}.\n\n::preview-card{href="https://example.test/broken-image"}\n::\n\nEmpty metadata: :inline-preview{href="https://example.test/empty"}.\n\nResolver failure: :inline-preview{href="https://example.test/failure"}.\n\nEnd of the streamed document.\n`;

export interface FixtureSettings {
  fieldDelayMs: number;
  paused: boolean;
  forceFailure: boolean;
}
export interface FixtureStats {
  started: number;
  completed: number;
  aborted: number;
  events: string[];
}
export interface Fixture {
  settings: FixtureSettings;
  stats: FixtureStats;
  resolve: PreviewResolver;
}
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted);
      resolve();
    }, ms);
    signal.addEventListener('abort', aborted, { once: true });
  });
}
async function fieldDelay(settings: FixtureSettings, signal: AbortSignal) {
  await sleep(settings.fieldDelayMs, signal);
  while (settings.paused) await sleep(40, signal);
  signal.throwIfAborted();
}
/** Fixed, public-looking IDs are data only. This resolver never fetches them. */
export async function resolveFixture(
  url: string,
  options: ResolveOptions,
  settings: FixtureSettings,
): Promise<PreviewMetadata> {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://example.test') throw new Error('Only fixture IDs are accepted');
  const kind = parsed.pathname.slice(1);
  if (!['article', 'no-image', 'no-icon', 'broken-image', 'empty', 'failure'].includes(kind))
    throw new Error('Unknown fixture');
  await fieldDelay(settings, options.signal);
  if (settings.forceFailure || kind === 'failure') throw new Error('Intentional fixture failure');
  if (kind === 'empty') return {};
  const metadata: PreviewMetadata = { title: 'A title arrived before the image' };
  options.emit({ state: 'pending', metadata: { ...metadata } });
  await fieldDelay(settings, options.signal);
  metadata.description =
    'Metadata arrives independently from source chunks. Focus and card identity should survive updates.';
  options.emit({ state: 'pending', metadata: { ...metadata } });
  await fieldDelay(settings, options.signal);
  metadata.siteName = 'Local fixture';
  if (kind !== 'no-icon') metadata.favicon = 'https://example.test/fixtures/icon.svg';
  options.emit({ state: 'pending', metadata: { ...metadata } });
  await fieldDelay(settings, options.signal);
  if (kind !== 'no-image')
    metadata.images = [
      {
        url: `https://example.test/fixtures/${kind === 'broken-image' ? 'missing.svg' : 'cover.svg'}`,
        alt: 'Local geometric illustration',
        width: 640,
        height: 360,
      },
    ];
  return metadata;
}
export function createFixture(remote = false): Fixture {
  const settings: FixtureSettings = { fieldDelayMs: 900, paused: false, forceFailure: false };
  const stats: FixtureStats = { started: 0, completed: 0, aborted: 0, events: [] };
  const resolve: PreviewResolver = async (url, options) => {
    stats.started++;
    stats.events.push(`start ${new URL(url).pathname}`);
    try {
      const metadata = remote
        ? await resolveRemoteFixture(url, options, settings)
        : await resolveFixture(url, options, settings);
      stats.completed++;
      stats.events.push(`ready ${new URL(url).pathname}`);
      return metadata;
    } catch (error) {
      if (options.signal.aborted) {
        stats.aborted++;
        stats.events.push(`abort ${new URL(url).pathname}`);
      } else stats.events.push(`failure ${new URL(url).pathname}`);
      throw error;
    }
  };
  return { settings, stats, resolve };
}
/** Nuxt-only same-origin endpoint; never contacts a fixture URL. */
async function resolveRemoteFixture(
  url: string,
  options: ResolveOptions,
  settings: FixtureSettings,
): Promise<PreviewMetadata> {
  const query = new URLSearchParams({
    url,
    delay: String(settings.fieldDelayMs),
    fail: String(settings.forceFailure),
  });
  const response = await fetch(`/api/metadata?${query}`, { signal: options.signal });
  if (!response.ok || !response.body) throw new Error('Fixture endpoint failed');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let result: PreviewMetadata | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        while (settings.paused) await sleep(40, options.signal);
        const event = JSON.parse(line) as {
          state: 'pending' | 'ready' | 'failed';
          metadata: PreviewMetadata;
        };
        if (event.state === 'failed') throw new Error('Intentional fixture failure');
        if (event.state === 'ready') result = event.metadata;
        else options.emit(event);
      }
      if (done) break;
    }
    if (!result) throw new Error('Incomplete fixture response');
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function localMedia(_origin: string) {
  return (url: string) => {
    const parsed = new URL(url);
    return parsed.origin === 'https://example.test' && parsed.pathname.startsWith('/fixtures/')
      ? parsed.pathname
      : undefined;
  };
}
export function createDemo(documentId: string, origin: string, initial?: DocumentSnapshot, remote = false) {
  const fixture = createFixture(remote);
  const controller = createPreviewController({
    documentId,
    resolver: { resolve: fixture.resolve, ttlMs: 1 },
    mediaUrl: localMedia(origin),
    ...(initial ? { initial } : {}),
  });
  return { fixture, controller };
}
/** Request-local suspended snapshot. No metadata work starts on the SSR server. */
export async function createInitialSnapshot(documentId: string): Promise<DocumentSnapshot> {
  const initial: DocumentSnapshot = {
    documentId,
    generation: 0,
    revision: 0,
    source: '',
    ended: false,
    document: { nodes: [], meta: {}, frontmatter: {} },
    targets: [],
  };
  const controller = createPreviewController({
    documentId,
    initial,
    resolver: {
      resolve: async () => {
        throw new Error('SSR must remain suspended');
      },
    },
  });
  await controller.update(fixtureSource, { ended: true });
  const { value: _value, ...snapshot } = controller.getSnapshot();
  controller.dispose();
  return JSON.parse(JSON.stringify(snapshot)) as DocumentSnapshot;
}
export type DemoController = PreviewController;
