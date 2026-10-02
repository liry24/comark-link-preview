import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { MarkdownDocument } from '@comark/angular';
import { initializePreviews } from 'comark-link-preview/browser';
import { createDemo, fixtureSource } from '../../shared/fixture.ts';
import { mountControls } from '../../shared/controls.ts';

@Component({
  selector: 'preview-app',
  standalone: true,
  imports: [MarkdownDocument],
  template: `<nav><a href="http://127.0.0.1:5173/">All examples</a></nav>
    <h1>Angular</h1>
    <p>
      Stock Comark renderer. Its current remount-on-update behavior is a known limitation for focus and open
      popovers.
    </p>
    <div #controls></div>
    <section #output data-preview-output>
      <comark-markdown-document [value]="view().value" />
    </section>`,
})
class App implements AfterViewInit, OnDestroy {
  private readonly demo = createDemo('angular-fixture', location.origin);
  readonly view = signal(this.demo.controller.getSnapshot());
  @ViewChild('controls', { static: true }) controls!: ElementRef<HTMLElement>;
  @ViewChild('output', { static: true }) output!: ElementRef<HTMLElement>;
  private cleanup = () => {};
  ngAfterViewInit() {
    const unsubscribe = this.demo.controller.subscribe((next) => this.view.set(next));
    const disposeControls = mountControls(
      this.controls.nativeElement,
      this.demo.controller,
      this.demo.fixture,
    );
    const disposePreviews = initializePreviews(this.output.nativeElement);
    this.cleanup = () => {
      disposePreviews();
      disposeControls();
      unsubscribe();
      this.demo.controller.dispose();
    };
    void this.demo.controller.update(fixtureSource, { ended: true });
  }
  ngOnDestroy() {
    this.cleanup();
  }
}
void bootstrapApplication(App).catch((error) => console.error(error));
