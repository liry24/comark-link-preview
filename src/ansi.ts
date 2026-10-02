/* eslint-disable no-control-regex -- Terminal control bytes from input must never execute. */
import { children, sourceStart } from './comark/tree.ts';
import { renderAnsiFromDocument, type AnsiRendererOptions } from '@comark/ansi';
import type { MarkdownDocument, Node } from 'comark';
import type { PreviewController, PreviewView } from './comark/controller.ts';
import { safeText, safeUrl } from './core/url.ts';

export function renderPreviewAnsi(view: PreviewView, options?: AnsiRendererOptions): Promise<string> {
  const targets = new Map(view.targets.map((target) => [target.start, target]));
  const walk = (node: Node): Node => {
    if (typeof node === 'string')
      return node.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, '');
    if (node[0] === null) return '';
    const start = sourceStart(node);
    const target = start === undefined ? undefined : targets.get(start);
    if (target) {
      const href = target.confirmed && target.href && safeUrl(target.href) ? target.href : '';
      const metadata = target.snapshot.metadata;
      const title = safeText(target.title) ?? metadata.title ?? href ?? 'Link preview';
      const text = [safeText(title), href && href !== title ? safeText(href) : '', metadata.description]
        .filter(Boolean)
        .join(target.kind === 'preview-card' ? '\n' : ' — ');
      return target.kind === 'preview-card' ? ['p', {}, text] : text;
    }
    return [node[0], { ...node[1] }, ...children(node).map(walk)];
  };
  const document: MarkdownDocument = { ...view.document, nodes: view.document.nodes.map(walk) };
  return renderAnsiFromDocument(document, options);
}
export interface AnsiOutput {
  isTTY?: boolean;
  write(text: string): unknown;
}
/** Owns the output region. A pipe receives only the final document, once. */
export function connectPreviewAnsi(
  controller: PreviewController,
  output: AnsiOutput,
  options?: AnsiRendererOptions,
): () => void {
  let disposed = false;
  let sequence = 0;
  let lineCount = 0;
  let printedFinal = false;
  const unsubscribe = controller.subscribe((view) => {
    const current = ++sequence;
    const complete =
      view.ended && view.targets.every((target) => !target.confirmed || target.snapshot.state !== 'pending');
    if (!output.isTTY && (!complete || printedFinal)) return;
    void renderPreviewAnsi(view, { ...options, colors: !!output.isTTY && options?.colors !== false }).then(
      (text) => {
        if (disposed || current !== sequence) return;
        if (output.isTTY) {
          const rewind = lineCount ? `\u001b[${lineCount}F\u001b[0J` : '';
          output.write(rewind + text + '\n');
          lineCount = text.split('\n').length;
        } else {
          output.write(text + '\n');
          printedFinal = true;
        }
      },
    );
  });
  return () => {
    disposed = true;
    unsubscribe();
  };
}
