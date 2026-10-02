/** Original-input boundary checks only. Values come from Comark, never this scanner. */
export function attributesEnd(source: string, start: number): number | undefined {
  if (source[start] !== '{') return undefined;
  const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
  const stack = ['}'];
  let quote: string | undefined;
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i]!;
    if (char === '\\') {
      i++;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if ('"\'`'.includes(char)) {
      quote = char;
      continue;
    }
    if (pairs[char]) {
      stack.push(pairs[char]);
      continue;
    }
    if (char === stack.at(-1)) {
      stack.pop();
      if (!stack.length) return i + 1;
    }
  }
  return undefined;
}
export function isInputConfirmed(source: string, start: number, ended: boolean): boolean {
  const head = /^(:+)(inline-preview|preview-card)(?=[{\s]|$)/u.exec(source.slice(start));
  if (!head) return false;
  let pos = start + head[0].length;
  while (source[pos] === ' ' || source[pos] === '\t') pos++;
  if (source[pos] === '{') {
    const end = attributesEnd(source, pos);
    if (end === undefined) return false;
    pos = end;
  } else if (head[1] === ':') return false;
  if (head[1] === ':') return true;
  const newline = source.indexOf('\n', pos);
  if (newline < 0) return false;
  const lines = source.slice(newline + 1).split('\n');
  let propsFence: string | undefined;
  let codeFence: string | undefined;
  let body = false;
  let closedProps = false;
  let nesting = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/^(?:\s*>\s*)+/u, '').trim();
    const complete = i < lines.length - 1 || ended;
    if (propsFence) {
      if (line === propsFence && complete) {
        propsFence = undefined;
        closedProps = true;
      }
      continue;
    }
    if (codeFence) {
      if (line.startsWith(codeFence) && /^(`+|~+)\s*$/u.test(line) && complete) codeFence = undefined;
      continue;
    }
    const yaml = /^(`{3,}|~{3,})(?:yaml|yml)\s+\[props\]$/u.exec(line);
    if ((i === 0 && line === '---') || yaml) {
      if (!complete) return false;
      propsFence = yaml?.[1] ?? '---';
      closedProps = false;
      continue;
    }
    const fence = /^(`{3,}|~{3,})/u.exec(line);
    if (fence) {
      codeFence = fence[1];
      body = true;
      continue;
    }
    if (/^:{2,}\s*[a-z]/iu.test(line)) {
      nesting++;
      body = true;
      continue;
    }
    if (line === head[1] && complete) {
      if (nesting) {
        nesting--;
        continue;
      }
      return true;
    }
    if (!line) continue;
    if (
      !complete &&
      ['---', '```yaml [props]', '```yml [props]', '~~~yaml [props]', '~~~yml [props]', head[1]!].some(
        (value) => value.startsWith(line),
      )
    )
      return false;
    body = true;
  }
  return !propsFence && (body || closedProps);
}
