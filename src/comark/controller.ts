import { validMetadata } from '../core/cache.ts';
import { children, sourceStart } from './tree.ts';
import { createMarkdownParser, type MarkdownDocument, type Node } from 'comark';
import {
  createPreviewService,
  type PreviewService,
  type PreviewSubscription,
  type ServiceOptions,
} from '../core/service.ts';
import { PreviewError, type PreviewSnapshot } from '../core/types.ts';
import { fetchIdentity, safeText, safeUrl } from '../core/url.ts';
import { renderPreviewDocument, type MediaUrlResolver, type PreviewTarget } from '../render/web.ts';
import { isInputConfirmed } from './completion.ts';
import { createPreviewSourceTracker } from './source.ts';

export interface DocumentSnapshot {
  documentId: string;
  generation: number;
  revision: number;
  source: string;
  ended: boolean;
  document: MarkdownDocument;
  targets: PreviewTarget[];
}
export interface PreviewView extends DocumentSnapshot {
  value: MarkdownDocument;
}
export interface ControllerOptions {
  documentId: string;
  service?: PreviewService;
  resolver?: ServiceOptions;
  initial?: DocumentSnapshot;
  mediaUrl?: MediaUrlResolver;
  maxUrls?: number;
  maxDocumentBytes?: number;
}
export interface PreviewController {
  getSnapshot(): PreviewView;
  subscribe(listener: (view: PreviewView) => void): () => void;
  update(source: string, options?: { ended?: boolean }): Promise<void>;
  append(chunk: string): Promise<void>;
  end(): Promise<void>;
  /** Call after hydrating an initial SSR snapshot, not before. */
  resume(): void;
  dispose(): void;
}
interface FetchGroup {
  identity: string;
  snapshot: PreviewSnapshot;
  subscription?: PreviewSubscription;
}
const emptyDocument = (): MarkdownDocument => ({ nodes: [], meta: {}, frontmatter: {} });
/** One controller per source document; views can subscribe independently. No ambient context. */
export function createPreviewController(options: ControllerOptions): PreviewController {
  if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(options.documentId))
    throw new TypeError('documentId must be a stable, safe unique identifier');
  if (Boolean(options.service) === Boolean(options.resolver))
    throw new TypeError('Provide exactly one service or resolver configuration');
  if (options.initial) {
    const initial = options.initial;
    if (
      typeof initial.source !== 'string' ||
      typeof initial.ended !== 'boolean' ||
      !Number.isSafeInteger(initial.generation) ||
      initial.generation < 0 ||
      !Number.isSafeInteger(initial.revision) ||
      initial.revision < 0 ||
      !initial.document ||
      !Array.isArray(initial.document.nodes) ||
      !Array.isArray(initial.targets) ||
      initial.targets.some(
        (target) =>
          !target ||
          !/^[a-zA-Z0-9_-]+$/u.test(target.id) ||
          !Number.isSafeInteger(target.start) ||
          target.start < 0 ||
          !['inline-preview', 'preview-card'].includes(target.kind) ||
          typeof target.confirmed !== 'boolean' ||
          (target.href !== undefined && typeof target.href !== 'string') ||
          (target.title !== undefined && typeof target.title !== 'string') ||
          !target.snapshot ||
          !['pending', 'ready', 'failed'].includes(target.snapshot.state) ||
          !validMetadata(target.snapshot.metadata),
      )
    )
      throw new TypeError('Invalid preview snapshot');
  }
  const maxUrls = options.maxUrls ?? 100;
  const maxBytes = options.maxDocumentBytes ?? 4_000_000;
  if (!Number.isSafeInteger(maxUrls) || maxUrls < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new TypeError('Invalid document limits');
  const service = options.service ?? createPreviewService(options.resolver!);
  const listeners = new Set<(view: PreviewView) => void>();
  const groups = new Map<string, FetchGroup>();
  let disposed = false;
  let resumed = !options.initial;
  let totalBytes = 0;
  let generation = options.initial?.generation ?? 0;
  let source = options.initial?.source ?? '';
  let requestedSource = source;
  let parsingSource = source;
  let revision = options.initial?.revision ?? 0;
  let ended = options.initial?.ended ?? false;
  let document = options.initial?.document ?? emptyDocument();
  let targets = structuredClone(options.initial?.targets ?? []);
  if (options.initial && options.initial.documentId !== options.documentId)
    throw new TypeError('Snapshot documentId mismatch');
  const parser = () => {
    const tracker = createPreviewSourceTracker(() => parsingSource);
    return createMarkdownParser({
      autoUnwrap: false,
      autoClose: tracker.autoClose,
      plugins: [tracker.plugin],
    });
  };
  let parse = parser();
  let queue = Promise.resolve();
  let latest = view();
  function view(): PreviewView {
    return {
      documentId: options.documentId,
      generation,
      revision,
      source,
      ended,
      document,
      targets: structuredClone(targets),
      value: renderPreviewDocument(document, targets, options.mediaUrl),
    };
  }
  function notify() {
    revision++;
    latest = view();
    for (const listener of listeners) listener(latest);
  }
  function cancelGroups() {
    for (const group of groups.values()) group.subscription?.unsubscribe();
    groups.clear();
  }
  function reconcile() {
    if (!resumed || disposed) return;
    const required = new Set<string>();
    for (const target of targets)
      if (target.confirmed && target.href && safeUrl(target.href)) required.add(fetchIdentity(target.href));
    for (const [key, group] of groups)
      if (!required.has(key)) {
        group.subscription?.unsubscribe();
        groups.delete(key);
      }
    let count = 0;
    for (const identity of required) {
      if (++count > maxUrls) {
        for (const target of targets)
          if (target.href && safeUrl(target.href) && fetchIdentity(target.href) === identity)
            target.snapshot = { state: 'failed', metadata: {} };
        continue;
      }
      const existing = groups.get(identity);
      if (existing) {
        for (const target of targets)
          if (
            target.confirmed &&
            target.href &&
            safeUrl(target.href) &&
            fetchIdentity(target.href) === identity
          )
            target.snapshot = existing.snapshot;
        continue;
      }
      const matching = targets.filter(
        (target) =>
          target.confirmed && target.href && safeUrl(target.href) && fetchIdentity(target.href) === identity,
      );
      const completed = matching.find((target) => target.snapshot.state === 'ready');
      const group: FetchGroup = {
        identity,
        snapshot: completed?.snapshot ?? { state: 'pending', metadata: {} },
      };
      groups.set(identity, group);
      if (completed) continue;
      const currentGeneration = generation;
      group.subscription = service.subscribe(
        identity,
        (snapshot) => {
          if (disposed || generation !== currentGeneration || groups.get(identity) !== group) return;
          group.snapshot = snapshot;
          for (const target of targets)
            if (
              target.confirmed &&
              target.href &&
              safeUrl(target.href) &&
              fetchIdentity(target.href) === identity
            )
              target.snapshot = snapshot;
          notify();
        },
        (bytes) => {
          totalBytes += bytes;
          if (totalBytes > maxBytes) throw new PreviewError('limit');
        },
      );
    }
  }
  function collect(tree: MarkdownDocument) {
    const result: PreviewTarget[] = [];
    const previous = new Map(targets.map((target) => [target.id, target]));
    function walk(node: Node) {
      if (typeof node === 'string' || node[0] === null) return;
      const start = sourceStart(node);
      if ((node[0] === 'inline-preview' || node[0] === 'preview-card') && start !== undefined) {
        const id = `${options.documentId}-${generation}-${start}`;
        const href = typeof node[1].href === 'string' ? node[1].href : undefined;
        const title = safeText(node[1].title);
        const confirmed =
          node[1][':href'] === undefined && isInputConfirmed(source, start, ended) && href !== undefined;
        const prior = previous.get(id);
        const snapshot =
          confirmed && href && !safeUrl(href)
            ? { state: 'failed' as const, metadata: {} }
            : prior && prior.href === href && prior.confirmed === confirmed
              ? prior.snapshot
              : { state: 'pending' as const, metadata: {} };
        result.push({
          id,
          start,
          kind: node[0],
          ...(href ? { href } : {}),
          ...(title ? { title } : {}),
          confirmed,
          snapshot,
        });
      }
      for (const child of children(node)) walk(child);
    }
    for (const node of tree.nodes) walk(node);
    return result;
  }
  function update(input: string, settings: { ended?: boolean } = {}): Promise<void> {
    if (disposed) return Promise.reject(new Error('Preview controller is disposed'));
    if (!input.startsWith(requestedSource)) {
      generation++;
      cancelGroups();
      parse = parser();
      totalBytes = 0;
    }
    requestedSource = input;
    const currentGeneration = generation;
    const currentParser = parse;
    const work = queue.then(async () => {
      if (disposed || generation !== currentGeneration) return;
      parsingSource = input;
      const tree = await currentParser(input, { streaming: true });
      if (disposed || generation !== currentGeneration) return;
      source = input;
      ended = settings.ended ?? false;
      document = tree;
      targets = collect(tree);
      reconcile();
      notify();
    });
    queue = work.catch(() => {});
    return work;
  }
  return {
    getSnapshot: () => latest,
    subscribe(listener) {
      if (disposed) throw new Error('Preview controller is disposed');
      listeners.add(listener);
      listener(latest);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    append: (chunk) => update(requestedSource + chunk),
    end: () => update(requestedSource, { ended: true }),
    resume() {
      if (!resumed) {
        resumed = true;
        reconcile();
        notify();
      }
    },
    dispose() {
      disposed = true;
      listeners.clear();
      cancelGroups();
      if (!options.service) service.dispose();
    },
  };
}
