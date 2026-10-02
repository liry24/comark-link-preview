import { children } from './tree.ts';
import { autoCloseMarkdown } from 'comark';
import type { AutoCloseOptions, ComarkPlugin, Node } from 'comark';
import type { RuleBlock, RuleInline, StateCore, Token } from 'markdown-exit';

/** A feasibility implementation for Comark 0.7.0. No private rule APIs/imports. */
export function createPreviewSourceTracker(getSource: () => string, options: AutoCloseOptions = {}) {
  type Marker = { offset: number; text: string };
  type Event = { tokens: Token[]; index: number; localStart: number };
  let rawTail = '',
    healedTail = '',
    markdown = '';
  let events: Event[] = [];
  let inlineMaps = new WeakMap<Token[], number[]>();
  let sourceMap = new Map<number, number>();
  const markerAttribute = 'data-clp-source-start';
  // Only a retained parser node or a token observation can carry trusted source metadata.
  const trustedNodes = new WeakMap<object, number>();
  const markers = (text: string): Marker[] =>
    [...text.matchAll(/:+[ \t]*(?:inline-preview|preview-card)(?![\w$-])/g)].map((m) => ({
      offset: m.index,
      text: m[0],
    }));
  const autoClose = (source: string) => {
    rawTail = source;
    healedTail = autoCloseMarkdown(source, {
      frontmatter: true,
      syntax: true,
      attributes: true,
      dropTrailingOpeners: true,
      ...options,
    });
    return healedTail;
  };
  const plugin: ComarkPlugin = {
    name: 'preview-source-tracker',
    pre(state) {
      markdown = state.markdown;
    },
    post(state) {
      const visit = (node: Node): void => {
        if (typeof node === 'string' || node[0] === null) return;
        const value = node[1][markerAttribute];
        const start =
          typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : trustedNodes.get(node);
        const internal = { ...node[1].$ } as Record<string, unknown>;
        // YAML/author attributes can create $, so never trust its previewStart.
        delete internal.previewStart;
        if (start !== undefined) {
          internal.previewStart = start;
          trustedNodes.set(node, start);
        }
        if (node[1].$ || start !== undefined) node[1].$ = internal;
        delete node[1][markerAttribute];
        for (const child of children(node)) visit(child);
      };
      for (const node of state.tree.nodes) visit(node);
    },
    markdownItPlugins: [
      (md) => {
        md.core.ruler.before('block', 'preview_source_reset', (state: StateCore) => {
          events = [];
          inlineMaps = new WeakMap();
          sourceMap = new Map();
          const source = getSource();
          // Comark's incremental parser passes an exact input suffix to autoClose.
          // Built-in frontmatter removes only a prefix after autoClose. Unknown
          // transforms must not silently authorize source offsets.
          if (!source.endsWith(rawTail) || !healedTail.endsWith(markdown)) return;
          const rawMarkers = markers(rawTail),
            healedMarkers = markers(healedTail);
          if (
            rawMarkers.length !== healedMarkers.length ||
            rawMarkers.some((m, i) => m.text !== healedMarkers[i]?.text)
          )
            return;
          const removedPrefix = healedTail.length - markdown.length;
          const visible = healedMarkers
            .map((m, i) => ({ ...m, raw: rawMarkers[i]!.offset }))
            .filter((m) => m.offset >= removedPrefix);
          const parsedMarkers = markers(state.src);
          if (
            visible.length !== parsedMarkers.length ||
            visible.some((m, i) => m.text !== parsedMarkers[i]?.text)
          )
            return;
          for (let i = 0; i < parsedMarkers.length; i++)
            sourceMap.set(parsedMarkers[i]!.offset, source.length - rawTail.length + visible[i]!.raw);
        });
        const observeBlock: RuleBlock = (state, line, _end, silent) => {
          if (silent) return false;
          // Container and dedent rules adjust bMarks/tShift, not state.src.
          const start = state.bMarks[line]! + state.tShift[line]!;
          if (
            /^:+\s*(?:inline-preview|preview-card)(?=[\s{[]|$)/.test(
              state.src.slice(start, state.eMarks[line]),
            )
          ) {
            events.push({ tokens: state.tokens, index: state.tokens.length, localStart: start });
          }
          return false;
        };
        md.block.ruler.before('comark_block_shorthand', 'preview_source_block', observeBlock);
        md.core.ruler.before('inline', 'preview_source_inline_maps', (state: StateCore) => {
          const lines = state.src.split('\n'),
            starts: number[] = [];
          let offset = 0;
          for (const line of lines) {
            starts.push(offset);
            offset += line.length + 1;
          }
          let row: number | undefined,
            cell = 0;
          const containers: Token[] = [];
          const rowCells = new Map<number, { value: string; map: number[] }[]>();
          for (const token of state.tokens) {
            if (token.nesting < 0) containers.pop();
            if (token.nesting > 0) containers.push(token);
            if (token.type === 'tr_open') {
              row = token.map?.[0];
              cell = 0;
            }
            if (token.type === 'tr_close') row = undefined;
            if (token.type !== 'inline' || !token.children) continue;
            let map: number[] | undefined;
            if (token.map) {
              map = mapInlineLines(token.content, token.map, lines, starts);
            } else if (row !== undefined) {
              let cells = rowCells.get(row);
              if (!cells) {
                cells = splitTableRow(lines[row] ?? '', starts[row] ?? 0);
                rowCells.set(row, cells);
              }
              const selected = cells[cell++];
              if (selected?.value === token.content) map = selected.map;
            } else {
              const parentRange = [...containers].reverse().find((t) => t.map)?.map;
              if (parentRange)
                map = mapInlineLines(
                  token.content,
                  [parentRange[0], parentRange[0] + token.content.split('\n').length],
                  lines,
                  starts,
                );
            }
            if (map) inlineMaps.set(token.children, map);
          }
        });
        const observeInline: RuleInline = (state, silent) => {
          if (silent || !/^:(?:inline-preview|preview-card)(?=[\s{[]|$)/.test(state.src.slice(state.pos)))
            return false;
          if (state.pos > 0 && !' \t\n*_['.includes(state.src[state.pos - 1]!)) return false;
          const localStart = inlineMaps.get(state.tokens)?.[state.pos];
          if (localStart === undefined) return false;
          events.push({
            tokens: state.tokens,
            index: state.tokens.length + (state.pending ? 1 : 0),
            localStart,
          });
          return false;
        };
        md.inline.ruler.before('comark_inline_component', 'preview_source_inline', observeInline);
        md.core.ruler.after('inline', 'preview_source_attach', (state: StateCore) => {
          // Clear author-supplied copies before attaching our trusted observations.
          const scrub = (tokens: Token[]): void => {
            for (const token of tokens) {
              token.attrs =
                token.attrs?.filter(([key]) => key !== markerAttribute && key !== ':' + markerAttribute) ??
                null;
              if (token.children) scrub(token.children);
            }
          };
          scrub(state.tokens);
          for (const event of events) {
            const token = event.tokens[event.index];
            if (
              !token ||
              !/^mdc_(?:block_(?:open|shorthand)|inline_component)$/.test(token.type) ||
              !['inline-preview', 'preview-card'].includes(token.tag)
            )
              continue;
            const start = sourceMap.get(event.localStart);
            if (start === undefined) continue;
            const original = getSource().slice(start);
            if (!/^:+[ \t]*(?:inline-preview|preview-card)(?=[\s{[]|$)/.test(original)) continue;
            // Deliberately not a component prop. Comark serializers/renderers ignore $.
            const value = String(start);
            if (token.type === 'mdc_inline_component' && token.nesting === 1) {
              let depth = 1,
                i = event.index + 1;
              for (; i < event.tokens.length && depth; i++) {
                const next = event.tokens[i]!;
                if (next.type === 'mdc_inline_component') depth += next.nesting;
              }
              const props = event.tokens[i];
              // Explicit preview syntax has attributes; unsupported label-only
              // tokens stay untracked instead of receiving a guessed position.
              if (props?.type === 'mdc_inline_props') props.attrSet(markerAttribute, value);
            } else token.attrSet(markerAttribute, value);
          }
        });
      },
    ],
  };
  return { autoClose, plugin };
}

function mapInlineLines(
  content: string,
  range: [number, number],
  lines: string[],
  starts: number[],
): number[] | undefined {
  const parts = content.split('\n');
  if (parts.length > range[1] - range[0]) return undefined;
  const map: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!,
      lineIndex = range[0] + i,
      line = lines[lineIndex] ?? '';
    const at = line.indexOf(part);
    // Full content lines normally have one occurrence even inside list/quote
    // prefixes; ambiguous container text is rejected rather than guessed.
    if (at < 0 || (part && line.indexOf(part, at + 1) >= 0)) return undefined;
    for (let k = 0; k < part.length; k++) map.push(starts[lineIndex]! + at + k);
    if (i < parts.length - 1) map.push(starts[lineIndex]! + line.length);
  }
  return map;
}

function splitTableRow(line: string, base: number): { value: string; map: number[] }[] {
  // CommonMark/GFM escapedSplit removes one backslash before an escaped pipe.
  // Token content and source character positions are kept in parallel.
  let begin = 0,
    end = line.length;
  while (begin < end && /\s/.test(line[begin]!)) begin++;
  while (end > begin && /\s/.test(line[end - 1]!)) end--;
  // Quote/list prefixes can precede the table row. Only accept a visible pipe
  // after such a prefix; pipe-less rows require already unambiguous contents.
  const initialPipe = line.indexOf('|', begin);
  if (initialPipe >= 0 && /^[>\s\d.*+()-]*$/.test(line.slice(begin, initialPipe))) begin = initialPipe;
  const cells: { value: string; map: number[] }[] = [];
  let value = '',
    map: number[] = [];
  for (let i = begin; i < end; i++) {
    if (line[i] === '|') {
      if (i > begin && line[i - 1] === '\\') {
        value = value.slice(0, -1);
        map.pop();
        value += '|';
        map.push(base + i);
      } else {
        cells.push({ value, map });
        value = '';
        map = [];
      }
    } else {
      value += line[i];
      map.push(base + i);
    }
  }
  cells.push({ value, map });
  if (cells[0]?.value === '') cells.shift();
  if (cells.at(-1)?.value === '') cells.pop();
  return cells.map((cell) => {
    const left = cell.value.length - cell.value.trimStart().length;
    const right = cell.value.trimEnd().length;
    return { value: cell.value.slice(left, right), map: cell.map.slice(left, right) };
  });
}
