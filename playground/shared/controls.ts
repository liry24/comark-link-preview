import { fixtureSource, sleep, type Fixture } from './fixture.ts';

/** Playground input controls only. Parsing and rendering belong to each example. */
export function mountControls(
  root: HTMLElement,
  fixture: Fixture,
  onSource: (source: string, reset: boolean) => Promise<void>,
  renderInitial = true,
) {
  root.innerHTML = `<fieldset><legend>Deterministic source + async metadata</legend>
    <label>Source delay (ms) <input data-input-delay type="number" min="0" max="2000" value="35"></label>
    <label>Characters per chunk <input data-chunk-size type="number" min="1" max="100" value="12"></label>
    <label>Metadata response delay (ms) <input data-metadata-delay type="number" min="0" max="10000" value="${fixture.settings.delayMs}"></label>
    <label><input data-pause-metadata type="checkbox"> Pause metadata delivery (10-second timeout)</label>
    <label><input data-failure type="checkbox"> Fail all metadata requests</label>
    <div><button data-restart>Restart stream</button> <button data-pause-input>Pause input</button> <button data-finish>Finish input</button> <button data-cancel>Cancel / clear</button></div>
    <label>Source (editing replaces the current stream)<textarea data-source spellcheck="false" rows="8"></textarea></label>
    <output data-status></output><pre data-events aria-label="Fetch event log"></pre>
  </fieldset>`;
  const element = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const source = element<HTMLTextAreaElement>('[data-source]');
  const status = element<HTMLOutputElement>('[data-status]');
  const events = element<HTMLPreElement>('[data-events]');
  const pause = element<HTMLButtonElement>('[data-pause-input]');
  const lifetime = new AbortController();
  let streaming: AbortController | undefined;
  let inputPaused = false;
  let message = 'Complete async result';
  let revision = 0;
  let renderedRevision = 0;
  let currentSource = fixtureSource;
  const number = (selector: string, max: number) =>
    Math.max(0, Math.min(max, Number(element<HTMLInputElement>(selector).value) || 0));
  const renderStatus = () => {
    status.value = `${message}; source ${currentSource.length} characters; revision ${revision}; rendered ${renderedRevision}; metadata requests ${fixture.stats.started}, completed ${fixture.stats.completed}, aborted ${fixture.stats.aborted}`;
    status.dataset.revision = String(revision);
    status.dataset.renderedRevision = String(renderedRevision);
    status.dataset.started = String(fixture.stats.started);
    status.dataset.completed = String(fixture.stats.completed);
    events.textContent = fixture.stats.events.slice(-12).join('\n');
  };
  const publish = (next: string, reset = false) => {
    const token = ++revision;
    currentSource = next;
    if (document.activeElement !== source) source.value = next;
    renderStatus();
    void onSource(next, reset)
      .then(() => {
        if (token !== revision || lifetime.signal.aborted) return;
        renderedRevision = token;
        renderStatus();
      })
      .catch((error: unknown) => {
        if (token !== revision || lifetime.signal.aborted) return;
        message = `Render error: ${String(error)}`;
        renderStatus();
      });
  };
  const stopInput = () => {
    streaming?.abort();
    streaming = undefined;
    inputPaused = false;
    pause.textContent = 'Pause input';
  };
  const run = async () => {
    stopInput();
    const stream = new AbortController();
    streaming = stream;
    message = 'Streaming; the latest completed parse is shown';
    publish('', true);
    try {
      for (let offset = 0; offset < fixtureSource.length;) {
        while (inputPaused) await sleep(40, stream.signal);
        offset += Math.max(1, number('[data-chunk-size]', 100));
        publish(fixtureSource.slice(0, offset));
        await sleep(number('[data-input-delay]', 2000), stream.signal);
      }
      message = 'Input complete; awaiting the final async parse';
      renderStatus();
    } catch (error) {
      if (!stream.signal.aborted) {
        message = `Input error: ${String(error)}`;
        renderStatus();
      }
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
    message = inputPaused ? 'Input paused; the current parse may still finish' : 'Streaming';
    renderStatus();
  });
  listen('[data-finish]', 'click', () => {
    stopInput();
    message = 'Input complete; awaiting the final async parse';
    publish(fixtureSource, true);
  });
  listen('[data-cancel]', 'click', () => {
    stopInput();
    message = 'Cancelled; stale parse results will be ignored';
    publish('', true);
  });
  listen('[data-source]', 'input', () => {
    stopInput();
    message = 'Edited source; awaiting its async parse';
    publish(source.value, true);
  });
  listen('[data-metadata-delay]', 'input', () => {
    fixture.settings.delayMs = number('[data-metadata-delay]', 10000);
  });
  listen('[data-pause-metadata]', 'change', () => {
    fixture.settings.paused = element<HTMLInputElement>('[data-pause-metadata]').checked;
  });
  listen('[data-failure]', 'change', () => {
    fixture.settings.forceFailure = element<HTMLInputElement>('[data-failure]').checked;
  });
  source.value = currentSource;
  if (renderInitial) publish(currentSource, true);
  else renderStatus();
  const timer = setInterval(renderStatus, 150);
  return () => {
    stopInput();
    clearInterval(timer);
    lifetime.abort();
    root.replaceChildren();
  };
}
