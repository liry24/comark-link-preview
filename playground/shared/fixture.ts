/** Local HTML responses exercise the real plugin without contacting example.test. */
export const fixtureSource = `# Comark link previews

A [normal link](https://example.test/plain) stays a normal link.

Hover, focus, or tap :inline-preview{href="https://example.test/article"}.

The same URL can have an author title: :inline-preview{href="https://example.test/article" title="Author title wins"}.

::preview-card{href="https://example.test/article"}
::

Source chunks keep arriving while the async plugin waits for metadata.

::preview-card{href="https://example.test/no-image"}
::

No favicon: :inline-preview{href="https://example.test/no-icon"}.

::preview-card{href="https://example.test/broken-image"}
::

Empty metadata: :inline-preview{href="https://example.test/empty"}.

Fetch failure: :inline-preview{href="https://example.test/failure"}.

End of the streamed document.
`;

export interface FixtureSettings {
  delayMs: number;
  paused: boolean;
  forceFailure: boolean;
}
export interface Fixture {
  settings: FixtureSettings;
  stats: { started: number; completed: number; aborted: number; events: string[] };
  fetch: typeof fetch;
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
export function createFixture(delayMs = 600): Fixture {
  const settings: FixtureSettings = { delayMs, paused: false, forceFailure: false };
  const stats = { started: 0, completed: 0, aborted: 0, events: [] as string[] };
  const fixtureFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const signal = init?.signal ?? (input instanceof Request ? input.signal : new AbortController().signal);
    const kind = url.pathname.slice(1);
    if (
      url.origin !== 'https://example.test' ||
      !['article', 'no-image', 'no-icon', 'broken-image', 'empty', 'failure'].includes(kind)
    )
      throw new Error('Only known local fixture URLs are accepted');
    stats.started++;
    stats.events.push(`fetch ${url.pathname}`);
    try {
      await sleep(settings.delayMs, signal);
      while (settings.paused) await sleep(40, signal);
      signal.throwIfAborted();
      if (settings.forceFailure || kind === 'failure') throw new Error('Intentional fixture failure');
      const metadata =
        kind === 'empty'
          ? ''
          : `
        <title>A complete preview from one async parse</title>
        <meta property="og:title" content="A complete preview from one async parse">
        <meta property="og:description" content="The standard Comark plugin waits for metadata, then returns ordinary HTML nodes for every renderer.">
        <meta property="og:site_name" content="Local fixture">
        ${kind === 'no-icon' ? '' : '<link rel="icon" href="/fixtures/icon.svg">'}
        ${kind === 'no-image' ? '' : `<meta property="og:image" content="/fixtures/${kind === 'broken-image' ? 'missing.svg' : 'cover.svg'}">`}
        <meta property="og:image:alt" content="Local geometric illustration">
        <meta property="og:image:width" content="640">
        <meta property="og:image:height" content="360">`;
      stats.completed++;
      stats.events.push(`complete ${url.pathname}`);
      return new Response(`<!doctype html><html><head>${metadata}</head><body>Local fixture</body></html>`, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    } catch (error) {
      if (signal.aborted) {
        stats.aborted++;
        stats.events.push(`abort ${url.pathname}`);
      } else stats.events.push(`failure ${url.pathname}`);
      throw error;
    }
  };
  return { settings, stats, fetch: fixtureFetch };
}
export function localMedia(url: string): string | undefined {
  const parsed = new URL(url);
  return parsed.origin === 'https://example.test' && parsed.pathname.startsWith('/fixtures/')
    ? parsed.pathname
    : undefined;
}
