import type { ElementNode, Node } from 'comark';
export function children(node: ElementNode): Node[] {
  const [, , ...content] = node;
  return content;
}
export function sourceStart(node: ElementNode): number | undefined {
  const metadata = node[1].$;
  if (
    metadata &&
    'previewStart' in metadata &&
    typeof metadata.previewStart === 'number' &&
    Number.isSafeInteger(metadata.previewStart) &&
    metadata.previewStart >= 0
  )
    return metadata.previewStart;
  return undefined;
}
