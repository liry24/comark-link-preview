import { mountPreviewHtml } from 'comark-link-preview/html';
import { createDemo, fixtureSource } from '../../shared/fixture.ts';
import { mountControls } from '../../shared/controls.ts';
import '../../shared/page.css';
const app = document.getElementById('app')!;
const controls = app.appendChild(document.createElement('div'));
const output = app.appendChild(document.createElement('section'));
output.setAttribute('data-preview-output', '');
const { controller, fixture } = createDemo('html-fixture', location.origin);
const disposeControls = mountControls(controls, controller, fixture);
const disposeOutput = mountPreviewHtml(output, controller);
void controller.update(fixtureSource, { ended: true });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    disposeOutput();
    disposeControls();
    controller.dispose();
    app.replaceChildren();
  });
