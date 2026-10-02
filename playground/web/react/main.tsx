import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MarkdownDocument } from '@comark/react';
import { parseMarkdown, type MarkdownDocument as ComarkDocument } from 'comark';
import { linkPreview } from 'comark-link-preview';
import { createFixture, localMedia } from '../../shared/fixture.ts';
import { mountControls } from '../../shared/controls.ts';
import '../../shared/page.css';

function App() {
  const [view, setView] = useState<ComarkDocument>({ nodes: [], meta: {}, frontmatter: {} });
  const controls = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fixture = createFixture();
    const options = {
      allowedUrls: ['https://example.test/*'],
      fetch: fixture.fetch,
      mediaUrl: localMedia,
      limits: { deadlineMs: 10_000 },
    };
    let plugin = linkPreview(options);
    let revision = 0;
    const disposeControls = mountControls(controls.current!, fixture, async (source, reset) => {
      const current = ++revision;
      if (reset) plugin = linkPreview(options);
      const document = await parseMarkdown(source, { plugins: [plugin] });
      if (current === revision) setView(document);
    });
    return () => {
      revision++;
      disposeControls();
    };
  }, []);
  return (
    <>
      <div ref={controls} />
      <section data-preview-output>
        <MarkdownDocument value={view} />
      </section>
    </>
  );
}
const root = createRoot(document.getElementById('app')!);
root.render(<App />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
