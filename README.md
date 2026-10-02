# comark-link-preview

Link previews for explicit Comark components.

```sh
npm install comark-link-preview comark
```

```ts
import { parseMarkdown } from 'comark';
import linkPreview from 'comark-link-preview';
import 'comark-link-preview/style.css';

const document = await parseMarkdown(markdown, {
  plugins: [linkPreview({ allowedUrls: ['https://example.com/*'] })],
});
```

Render the returned document with your usual Comark renderer. No component registration is needed.

```md
See :inline-preview{href="https://example.com/article" title="My title"}.

::preview-card{href="https://example.com/article"}
::
```

Metadata is fetched before parsing completes. An author title takes priority; failures become ordinary links. Ordinary Markdown links are unchanged. Keep your original Markdown for editing and saving.

## Options

- `allowedUrls`: URLPattern strings. Omit to allow HTTP(S); `[]` denies all. `https://*.example.com/*` matches subdomains, not the apex.
- `authorize(url, { kind, from, signal })`: optional asynchronous boolean policy, combined with the allowlist. Runs for initial URLs, redirects, and cached redirect chains.
- `fetch`: optional standard Fetch implementation, for application-controlled network access.
- `storage`, `namespace`, `ttlMs`: optional unstorage cache; shared storage requires a namespace isolating the tenant and policy. Default TTL is five minutes.
- `limits`: `deadlineMs` (8,000), `maxBytes` (512,000), `maxRedirects` (5), `maxFieldLength` (2,048), `maxImages` (8).
- `concurrency` (4), `maxUrls` (100), `maxDocumentBytes` (4,000,000): request and document limits.
- `mediaUrl(url, kind)`: replace an image or favicon URL with HTTPS or a same-origin `/path`; return `undefined` to omit it. Direct images use `no-referrer`.
- `idPrefix`: optional document-unique HTML identifier for independently parsed server/client output. Otherwise IDs are generated per parse; hydrate the same completed document returned by the server.
- `output: 'ansi'`: readable link/card text for Comark's terminal renderer. Default output is web markup.
- `logger(event)`: optional bounded diagnostics containing a code, without URLs or remote content.

## Runtime notes

Requires Node 24+ or a compatible Web Fetch/URLPattern runtime. Browser fetches are subject to CORS; server-side parsing is usually appropriate for external websites. Cloudflare Workers should enable `global_fetch_strictly_public` and use public global fetch rather than privileged bindings.

URL authorization is not complete SSRF protection. Applications accepting untrusted URLs must enforce their own network/egress policy. Comark may auto-close partial streamed input; any parsed URL can be fetched through your policy. Parse only complete input if early requests are unacceptable. Incremental parsers can retain previously rendered cards; recreate the parser when changing authorization policy.

Inline previews support hover, focus, touch, and Escape when the plugin runs in the browser. Server-generated static HTML supports the native preview button, but has no hover behavior or JavaScript image-error handling. Angular uses its standard renderer and may recreate nodes on source updates.
