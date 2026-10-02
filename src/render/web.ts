/* eslint-disable no-control-regex -- Deliberate control rejection for explicit relative media paths. */
import { children, sourceStart } from '../comark/tree.ts';
import type { ElementNode, MarkdownDocument, Node } from 'comark';
import type { PreviewSnapshot } from '../core/types.ts';
import { safeText, safeUrl } from '../core/url.ts';

export interface PreviewTarget {
  id: string;
  start: number;
  kind: 'inline-preview' | 'preview-card';
  title?: string;
  href?: string;
  confirmed: boolean;
  snapshot: PreviewSnapshot;
}
export type MediaUrlResolver = (url: string, kind: 'image' | 'favicon') => string | undefined;
const element = (tag: string, attrs: Record<string, unknown>, ...content: Node[]): ElementNode => [
  tag,
  attrs,
  ...content,
];
const icon = (): ElementNode => element('span', { class: 'clp-icon', 'aria-hidden': 'true' }, '↗');
function media(
  url: string | undefined,
  kind: 'image' | 'favicon',
  resolve?: MediaUrlResolver,
): string | undefined {
  if (!url) return undefined;
  try {
    const value = resolve ? resolve(url, kind) : url;
    if (
      resolve &&
      value?.startsWith('/') &&
      !value.startsWith('//') &&
      !value.includes('\\') &&
      !/[\u0000-\u0020\u007f]/u.test(value)
    )
      return value;
    return safeUrl(value ?? '', true)?.href;
  } catch {
    return undefined;
  }
}
function cardContent(target: PreviewTarget, resolve?: MediaUrlResolver): Node[] {
  const metadata = target.snapshot.metadata;
  const title = safeText(target.title) ?? safeText(metadata.title) ?? target.href ?? 'Link preview';
  const favicon = media(metadata.favicon, 'favicon', resolve);
  const image = metadata.images?.[0];
  const imageUrl = media(image?.url, 'image', resolve);
  return [
    element(
      'span',
      { class: 'clp-summary' },
      element(
        'span',
        { class: 'clp-heading' },
        element(
          'span',
          { class: 'clp-favicon' },
          icon(),
          ...(favicon
            ? [
                element('img', {
                  src: favicon,
                  alt: '',
                  referrerpolicy: 'no-referrer',
                  'data-clp-media': 'favicon',
                  width: 16,
                  height: 16,
                }),
              ]
            : []),
        ),
        element('span', { class: 'clp-title' }, title),
      ),
      ...(safeText(metadata.description)
        ? [element('span', { class: 'clp-description' }, safeText(metadata.description) ?? '')]
        : []),
      ...(safeText(metadata.siteName)
        ? [element('span', { class: 'clp-site' }, safeText(metadata.siteName) ?? '')]
        : []),
    ),
    ...(imageUrl
      ? [
          element('img', {
            class: 'clp-image',
            src: imageUrl,
            alt: image?.alt ?? '',
            referrerpolicy: 'no-referrer',
            'data-clp-media': 'image',
          }),
        ]
      : []),
  ];
}
export function previewNode(target: PreviewTarget, resolve?: MediaUrlResolver): ElementNode {
  const href = target.confirmed && target.href ? safeUrl(target.href)?.href : undefined;
  const title = safeText(target.title) ?? safeText(target.snapshot.metadata.title) ?? href ?? 'Link preview';
  const empty = target.snapshot.state === 'ready' && Object.keys(target.snapshot.metadata).length === 0;
  if (target.snapshot.state === 'failed' || empty)
    return href ? element('a', { href }, safeText(target.title) ?? href) : element('span', {}, title);
  const pending = target.snapshot.state === 'pending';
  const root = {
    class: 'clp ' + (target.kind === 'inline-preview' ? 'clp-inline' : 'clp-block'),
    'data-clp-id': target.id,
    'aria-busy': pending ? 'true' : 'false',
  };
  if (target.kind === 'preview-card') {
    return element(
      'span',
      root,
      element(
        href ? 'a' : 'span',
        { class: 'clp-card', ...(href ? { href } : {}) },
        ...cardContent(target, resolve),
      ),
    );
  }
  const favicon = media(target.snapshot.metadata.favicon, 'favicon', resolve);
  return element(
    'span',
    root,
    element(
      href ? 'a' : 'span',
      { class: 'clp-link', ...(href ? { href } : {}) },
      element(
        'span',
        { class: 'clp-favicon' },
        icon(),
        ...(favicon
          ? [
              element('img', {
                src: favicon,
                alt: '',
                width: 16,
                height: 16,
                referrerpolicy: 'no-referrer',
                'data-clp-media': 'favicon',
              }),
            ]
          : []),
      ),
      element('span', { class: 'clp-title' }, title),
    ),
    element(
      'button',
      {
        type: 'button',
        class: 'clp-toggle',
        'aria-label': 'Show link preview',
        'aria-controls': target.id + '-panel',
        'data-clp-toggle': '',
      },
      '⌄',
    ),
    element(
      'span',
      {
        id: target.id + '-panel',
        class: 'clp-panel clp-card',
        popover: 'manual',
        role: 'group',
        'aria-label': 'Link preview',
      },
      ...cardContent(target, resolve),
    ),
  );
}

/** The canonical document is never modified or used as the display tree. */
export function renderPreviewDocument(
  document: MarkdownDocument,
  targets: readonly PreviewTarget[],
  resolve?: MediaUrlResolver,
): MarkdownDocument {
  const byStart = new Map(targets.map((target) => [target.start, target]));
  const walk = (node: Node, interactive = false): Node => {
    if (typeof node === 'string' || node[0] === null) return node;
    const start = sourceStart(node);
    if (node[0] === 'inline-preview' || node[0] === 'preview-card') {
      const target = start === undefined ? undefined : byStart.get(start);
      if (interactive)
        return element(
          'span',
          {},
          safeText(target?.title) ??
            safeText(target?.snapshot.metadata.title) ??
            safeText(target?.href) ??
            'Link preview',
        );
      return previewNode(
        target ?? {
          id: 'unconfirmed',
          start: -1,
          kind: node[0],
          confirmed: false,
          snapshot: { state: 'pending', metadata: {} },
        },
        resolve,
      );
    }
    return [
      node[0],
      { ...node[1] },
      ...children(node).map((child) => walk(child, interactive || ['a', 'button'].includes(node[0]))),
    ];
  };
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      Array.isArray(node) && node[0] === 'inline-preview' ? element('p', {}, walk(node)) : walk(node),
    ),
  };
}
