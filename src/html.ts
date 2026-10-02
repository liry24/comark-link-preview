import { renderHtmlFromDocument } from '@comark/html';
import { escapeHtml } from 'comark/utils';
import type { PreviewController, PreviewView } from './comark/controller.ts';
import { initializePreviews } from './browser.ts';

export function renderPreviewHtml(view: PreviewView): Promise<string> {
  return renderHtmlFromDocument(view.value, {
    components: {
      previewSpan: {
        match: (node) =>
          node[0] === 'span' &&
          typeof node[1].class === 'string' &&
          node[1].class.split(' ').some((name) => name.startsWith('clp')),
        handler: async (node, state) => {
          // Comark 0.7 minimizes the string "true" even for ARIA. Keep token-valued ARIA explicit.
          const attributes = Object.entries(node[1])
            .filter(
              ([name, value]) =>
                name !== '$' && value !== undefined && value !== null && /^[a-zA-Z][\w:.-]*$/u.test(name),
            )
            .map(([name, value]) => `${name}="${escapeHtml(String(value))}"`)
            .join(' ');
          return `<span${attributes ? ' ' + attributes : ''}>${await state.flow(node, state)}</span>`;
        },
      },
    },
  });
}
/** HTML owns its nodes here; framework renderers must not share this mount root. */
export function mountPreviewHtml(root: HTMLElement, controller: PreviewController): () => void {
  let revision = 0;
  let disposed = false;
  const cleanup = initializePreviews(root);
  const unsubscribe = controller.subscribe((view) => {
    const current = ++revision;
    void renderPreviewHtml(view).then((html) => {
      if (disposed || current !== revision) return;
      const template = document.createElement('template');
      template.innerHTML = html;
      reconcile(root, template.content);
    });
  });
  return () => {
    disposed = true;
    unsubscribe();
    cleanup();
  };
}
const ownedAttributes = new Set(['aria-expanded', 'data-clp-loaded']);
function reconcile(existing: ParentNode, next: ParentNode): void {
  const fresh = [...next.childNodes];
  for (let index = 0; index < fresh.length; index++) {
    const replacement = fresh[index]!;
    const current = existing.childNodes[index];
    if (!current) {
      existing.appendChild(replacement.cloneNode(true));
      continue;
    }
    if (
      current.nodeType !== replacement.nodeType ||
      current.nodeName !== replacement.nodeName ||
      (current instanceof Element &&
        replacement instanceof Element &&
        current.getAttribute('data-clp-id') !== replacement.getAttribute('data-clp-id'))
    ) {
      existing.replaceChild(replacement.cloneNode(true), current);
      continue;
    }
    if (current instanceof Element && replacement instanceof Element) {
      for (const attribute of [...current.attributes]) {
        if (
          !replacement.hasAttribute(attribute.name) &&
          !ownedAttributes.has(attribute.name) &&
          !(attribute.name === 'style' && current.classList.contains('clp-panel'))
        )
          current.removeAttribute(attribute.name);
      }
      for (const attribute of [...replacement.attributes])
        if (current.getAttribute(attribute.name) !== attribute.value)
          current.setAttribute(attribute.name, attribute.value);
      reconcile(current, replacement);
    } else if (current.textContent !== replacement.textContent) current.textContent = replacement.textContent;
  }
  while (existing.childNodes.length > fresh.length) existing.removeChild(existing.lastChild!);
}
