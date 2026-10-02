import { connectPreviewAnsi } from 'comark-link-preview/ansi';
import { createDemo, fixtureSource, sleep } from '../shared/fixture.ts';
const { controller, fixture } = createDemo('cli-fixture', 'https://example.test');
fixture.settings.fieldDelayMs = 100;
const disconnect = connectPreviewAnsi(controller, process.stdout);
try {
  const signal = new AbortController().signal;
  for (let offset = 0; offset < fixtureSource.length; offset += 40) {
    await controller.append(fixtureSource.slice(offset, offset + 40));
    await sleep(10, signal);
  }
  await controller.end();
  await new Promise<void>((resolve) => {
    const unsubscribe = controller.subscribe((view) => {
      if (
        view.ended &&
        view.targets.every((target) => !target.confirmed || target.snapshot.state !== 'pending')
      )
        queueMicrotask(() => {
          unsubscribe();
          resolve();
        });
    });
  });
  await disconnect.flush();
} finally {
  disconnect.dispose();
  controller.dispose();
}
