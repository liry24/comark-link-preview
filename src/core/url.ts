/* eslint-disable no-control-regex -- Deliberate URL and terminal control-character rejection. */
export function safeUrl(input: string, media = false): URL | undefined {
  if (typeof input !== 'string' || input.length > 8192 || /[\u0000-\u0020\u007f]/u.test(input))
    return undefined;
  try {
    const url = new URL(input);
    if (media ? url.protocol !== 'https:' : !['https:', 'http:'].includes(url.protocol)) return undefined;
    if (url.username || url.password || !url.hostname) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function fetchIdentity(url: string): string {
  const parsed = safeUrl(url);
  if (!parsed) throw new TypeError('A public HTTP(S) URL is required');
  parsed.hash = '';
  return parsed.href;
}

export function safeText(value: unknown, limit = 2048): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, '')
    .trim()
    .slice(0, limit);
  return text || undefined;
}
