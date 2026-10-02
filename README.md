# comark-link-preview

Explicit, progressively resolved link previews for Comark. Development version **0.0.0**; not published to npm.

```md
See :inline-preview{href="https://example.com" title="Optional author title"}.

::preview-card{href="https://example.com"}
::
```

Ordinary links stay ordinary. Author titles win. Missing images are omitted; missing favicons use the built-in icon. Failed or empty previews become ordinary links.

## Use

Node **24+**, Comark **0.7+**, ESM. Until release, install the tested tarball. Browser rendering needs the renderer you use, such as `@comark/react` or `@comark/vue`.

```ts
import { createPreviewController } from 'comark-link-preview';
import { createFetchResolver } from 'comark-link-preview/fetch';
import 'comark-link-preview/style.css';

const controller = createPreviewController({
  documentId: 'article-1',
  resolver: createFetchResolver({
    allowedUrls: ['https://example.com/*', 'https://*.example.com/*'],
    authorize: async (url, { signal }) => !signal.aborted && url.pathname !== '/private',
  }),
});
const unsubscribe = controller.subscribe(({ value }) => {
  // Pass value to your Comark MarkdownDocument renderer.
});
await controller.append('See :inline-preview{href="https://example.com"}');
await controller.end();
// On disposal: unsubscribe(); controller.dispose()
```

Run metadata fetching on your server. Browser applications provide a `resolver: { resolve }` that calls their server endpoint; the Nuxt example demonstrates progressive responses. Resolver callbacks receive `signal`, `emit` (whole pending snapshots), and `consumeBytes`; return the completed metadata. Network work never blocks parsing.

For HTML, use `mountPreviewHtml(root, controller)` from `/html`; for terminal output, use `connectPreviewAnsi(controller, output)` from `/ansi`. Pipes receive one final document. React, Vue, Svelte, Angular and Nuxt use their existing Comark renderer with `value`. Call `initializePreviews(root)` from `/browser` after hydration and its returned cleanup before unmount.

Serialize the controller snapshot for SSR; initialize the client with `initial` and the same document ID, then call `resume()` after hydration. Controllers are request-local. Multiple views can subscribe independently. Dispose the controller when its document is no longer needed.

## Boundaries

- URL authorization is **not complete SSRF protection**. `allowedUrls` uses native URLPattern strings; omitted means HTTP(S), `[]` denies all. `authorize` composes with the patterns and runs before fetching or reading cached results, including redirects. `*.example.com` excludes the apex. A DNS precheck does not bind the subsequent connection. Supply an app-controlled `fetch` or network egress controls where needed; no credentials or incoming headers are forwarded.
- `/workers` exposes `createWorkersResolver({ publicFetch: 'global_fetch_strictly_public', ...policy })`. Enable that compatibility flag on hosted Cloudflare Workers. It uses the platform public-network boundary, not DNS pinning; privileged bindings/routing overrides are outside this contract.
- Default media URLs are HTTPS with `no-referrer`; viewers still contact the image host. An explicit `mediaUrl` callback can return a validated HTTPS URL or same-origin root-relative proxy path. No proxy service is included.
- UTF-8 HTML is supported. Fetches have byte, redirect, concurrency and deadline limits; metadata is never treated as HTML. Shared unstorage drivers require an explicit namespace separating tenant, resolver and policy. Successful completed entries alone are cached.
- Real source syntax must finish before fetching. Dynamic `:href` is not resolved. Later YAML props revoke earlier requests. Markdown serialization uses `snapshot.document`, preserving author meaning rather than byte-identical spelling.
- Stable surrounding markup preserves preview nodes during ordinary updates. Structural Markdown reinterpretation may remount. The current stock Angular renderer also remounts on metadata updates, so focus/popover state may reset there.
- Browser interactions use the basic Popover API (Chrome/Edge 114+, Firefox 125+, Safari 17+). Normal Comark document sanitization remains the application's responsibility.

## Develop

Install Node 24.19+ and Bun 1.4.2, then `bun install --ignore-scripts`.

- `bun dev`: builds/watches the package and launches the Vite 8 hub, Angular CLI and Nuxt dev servers. Ctrl+C stops all children.
- `bun dev:cli`: the same fixture through the ANSI renderer, using Node.
- `bun check`: format, typed lint, types, regression tests and build.
- `bun test:browser`: actual browser journeys across all six web examples.
- `bun test:package`: pack, inspect and run an isolated consumer.

Fixtures expose independent source/metadata delays, pause, failure, edit, restart and cancellation without external fetches. Bun is only the package manager/script launcher. Runtime processes use Node. No release, tag or npm publication is automatic; the first release remains a separately approved 0.1.0.
