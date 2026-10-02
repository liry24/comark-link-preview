import { createHtmlRenderer } from '@comark/html';
import { linkPreview } from 'comark-link-preview';
import { createFixture, localMedia } from '../../shared/fixture.ts';
import { mountControls } from '../../shared/controls.ts';
import '../../shared/page.css';

const app = document.getElementById('app')!;
const controls = app.appendChild(document.createElement('div'));
const output = app.appendChild(document.createElement('section'));
output.setAttribute('data-preview-output', '');
const fixture = createFixture();
const options = {
  allowedUrls: ['https://example.test/*'],
  fetch: fixture.fetch,
  mediaUrl: localMedia,
  limits: { deadlineMs: 10_000 },
};
let renderHtml = createHtmlRenderer({ plugins: [linkPreview(options)] });
let revision = 0;
const disposeControls = mountControls(controls, fixture, async (source, reset) => {
  const current = ++revision;
  if (reset) renderHtml = createHtmlRenderer({ plugins: [linkPreview(options)] });
  const html = await renderHtml(source);
  if (current === revision) output.innerHTML = html;
});
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    revision++;
    disposeControls();
    app.replaceChildren();
  });
