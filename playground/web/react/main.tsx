import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MarkdownDocument } from '@comark/react';
import { initializePreviews } from 'comark-link-preview/browser';
import { createDemo, fixtureSource } from '../../shared/fixture.ts';
import { mountControls } from '../../shared/controls.ts';
import '../../shared/page.css';

const demo = createDemo('react-fixture', location.origin);
function App() {
  const [view, setView] = useState(demo.controller.getSnapshot());
  const controls = useRef<HTMLDivElement>(null);
  const output = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const unsubscribe = demo.controller.subscribe(setView);
    const disposeControls = mountControls(controls.current!, demo.controller, demo.fixture);
    const disposePreviews = initializePreviews(output.current!);
    void demo.controller.update(fixtureSource, { ended: true });
    return () => {
      disposePreviews();
      disposeControls();
      unsubscribe();
      demo.controller.dispose();
    };
  }, []);
  return (
    <>
      <div ref={controls} />
      <section data-preview-output ref={output}>
        <MarkdownDocument value={view.value} />
      </section>
    </>
  );
}
const root = createRoot(document.getElementById('app')!);
root.render(<App />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
