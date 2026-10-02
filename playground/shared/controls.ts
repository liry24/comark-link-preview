import { fixtureSource, sleep, type DemoController, type Fixture } from './fixture.ts';

/** Controls own only this separate root, never the framework-owned output. */
export function mountControls(root: HTMLElement, controller: DemoController, fixture: Fixture) {
  root.innerHTML = `<fieldset><legend>Deterministic streaming fixture</legend>
    <label>Source delay (ms) <input data-input-delay type="number" min="0" max="2000" value="35"></label>
    <label>Characters per chunk <input data-chunk-size type="number" min="1" max="100" value="12"></label>
    <label>Metadata field delay (ms) <input data-field-delay type="number" min="0" max="10000" value="900"></label>
    <label><input data-pause-metadata type="checkbox"> Pause metadata delivery</label>
    <label><input data-failure type="checkbox"> Fail all metadata requests</label>
    <div><button data-restart>Restart stream</button> <button data-pause-input>Pause input</button> <button data-finish>Finish input</button> <button data-cancel>Cancel / clear</button></div>
    <label>Source (editing replaces the current stream)<textarea data-source spellcheck="false" rows="8"></textarea></label>
    <output data-status></output><pre data-events aria-label="Resolver event log"></pre>
  </fieldset>`;
  const element = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const source = element<HTMLTextAreaElement>('[data-source]');
  const status = element<HTMLOutputElement>('[data-status]');
  const events = element<HTMLPreElement>('[data-events]');
  const pause = element<HTMLButtonElement>('[data-pause-input]');
  const lifetime = new AbortController();
  let streaming: AbortController | undefined;
  let inputPaused = false;
  let message = 'Ready';
  let operation = 0;
  const number = (selector: string, max: number) =>
    Math.max(0, Math.min(max, Number(element<HTMLInputElement>(selector).value) || 0));
  const renderStatus = () => {
    const snapshot = controller.getSnapshot();
    status.value = `${message}; source ${snapshot.source.length} characters; revision ${snapshot.revision}; metadata requests ${fixture.stats.started}, completed ${fixture.stats.completed}, aborted ${fixture.stats.aborted}`;
    events.textContent = fixture.stats.events.slice(-12).join('\n');
  };
  const stopInput = () => {
    operation++;
    streaming?.abort();
    streaming = undefined;
    inputPaused = false;
    pause.textContent = 'Pause input';
  };
  const run = async () => {
    stopInput();
    const token = operation;
    const stream = new AbortController();
    streaming = stream;
    message = 'Streaming';
    await controller.update('');
    if (stream.signal.aborted || token !== operation) return;
    try {
      for (let offset = 0; offset < fixtureSource.length;) {
        while (inputPaused) await sleep(40, stream.signal);
        const size = Math.max(1, number('[data-chunk-size]', 100));
        const chunk = fixtureSource.slice(offset, offset + size);
        await controller.append(chunk);
        offset += chunk.length;
        await sleep(number('[data-input-delay]', 2000), stream.signal);
      }
      await controller.end();
      message = 'Input complete; metadata may still be arriving';
    } catch (error) {
      if (!stream.signal.aborted) message = `Input error: ${String(error)}`;
    } finally {
      if (token === operation) renderStatus();
    }
  };
  const listen = (selector: string, event: string, callback: () => void) =>
    element(selector).addEventListener(event, callback, { signal: lifetime.signal });
  listen('[data-restart]', 'click', () => {
    void run();
  });
  listen('[data-pause-input]', 'click', () => {
    inputPaused = !inputPaused;
    pause.textContent = inputPaused ? 'Resume input' : 'Pause input';
    message = inputPaused ? 'Input paused; metadata continues' : 'Streaming';
    renderStatus();
  });
  listen('[data-finish]', 'click', () => {
    stopInput();
    message = 'Input complete';
    void controller.update(fixtureSource, { ended: true });
  });
  listen('[data-cancel]', 'click', () => {
    stopInput();
    message = 'Cancelled';
    void controller.update('', { ended: true });
  });
  listen('[data-source]', 'input', () => {
    stopInput();
    message = 'Edited source';
    void controller.update(source.value, { ended: true });
  });
  listen('[data-field-delay]', 'input', () => {
    fixture.settings.fieldDelayMs = number('[data-field-delay]', 10000);
  });
  listen('[data-pause-metadata]', 'change', () => {
    fixture.settings.paused = element<HTMLInputElement>('[data-pause-metadata]').checked;
  });
  listen('[data-failure]', 'change', () => {
    fixture.settings.forceFailure = element<HTMLInputElement>('[data-failure]').checked;
  });
  const unsubscribe = controller.subscribe((snapshot) => {
    if (document.activeElement !== source) source.value = snapshot.source;
    renderStatus();
  });
  const timer = setInterval(renderStatus, 150);
  return () => {
    stopInput();
    clearInterval(timer);
    unsubscribe();
    lifetime.abort();
    root.replaceChildren();
  };
}
