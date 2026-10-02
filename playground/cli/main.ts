import { createAnsiRenderer } from '@comark/ansi';
import { linkPreview } from 'comark-link-preview';
import { createFixture, fixtureSource, sleep } from '../shared/fixture.ts';

const fixture = createFixture(100);
const renderAnsi = createAnsiRenderer({
  plugins: [
    linkPreview({
      allowedUrls: ['https://example.test/*'],
      fetch: fixture.fetch,
      limits: { deadlineMs: 10_000 },
      output: 'ansi',
    }),
  ],
});
const signal = new AbortController().signal;
let source = '';
for (let offset = 0; offset < fixtureSource.length; offset += 40) {
  source += fixtureSource.slice(offset, offset + 40);
  await sleep(10, signal);
}
// A redirected stream receives one complete, readable document without redraw codes.
process.stdout.write(await renderAnsi(source));
