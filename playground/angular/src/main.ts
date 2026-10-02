import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { MarkdownDocument } from '@comark/angular';
import { parseMarkdown, type MarkdownDocument as ComarkDocument } from 'comark';
import { linkPreview } from 'comark-link-preview';
import { createFixture, localMedia } from '../../shared/fixture.ts';
import { mountControls } from '../../shared/controls.ts';

@Component({
  selector: 'preview-app',
  standalone: true,
  imports: [MarkdownDocument],
  template: `<nav><a href="http://127.0.0.1:5173/">All examples</a></nav>
    <h1>Angular</h1>
    <p>The async Comark plugin returns a complete document to the stock Angular renderer.</p>
    <div #controls></div>
    <section data-preview-output><comark-markdown-document [value]="view()" /></section>`,
})
class App implements AfterViewInit, OnDestroy {
  readonly view = signal<ComarkDocument>({ nodes: [], meta: {}, frontmatter: {} });
  @ViewChild('controls', { static: true }) controls!: ElementRef<HTMLElement>;
  private revision = 0;
  private cleanup = () => {};
  ngAfterViewInit() {
    const fixture = createFixture();
    const options = {
      allowedUrls: ['https://example.test/*'],
      fetch: fixture.fetch,
      mediaUrl: localMedia,
      limits: { deadlineMs: 10_000 },
    };
    let plugin = linkPreview(options);
    this.cleanup = mountControls(this.controls.nativeElement, fixture, async (source, reset) => {
      const current = ++this.revision;
      if (reset) plugin = linkPreview(options);
      const document = await parseMarkdown(source, { plugins: [plugin] });
      if (current === this.revision) this.view.set(document);
    });
  }
  ngOnDestroy() {
    this.revision++;
    this.cleanup();
  }
}
void bootstrapApplication(App).catch((error) => console.error(error));
