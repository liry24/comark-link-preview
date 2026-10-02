import { Parser } from 'htmlparser2';
import type { PreviewImage, PreviewMetadata } from '../core/types.ts';
import { safeText, safeUrl } from '../core/url.ts';

interface Candidate {
  rank: number;
  value: string;
}
interface RawImage {
  url: string;
  secureUrl?: string;
  alt?: string;
  width?: number;
  height?: number;
}
export interface MetadataParserOptions {
  url: string;
  maxFieldLength?: number;
  maxImages?: number;
  emit?: (data: PreviewMetadata) => void;
}
/** Bounded head-only SAX extraction. Media is withheld until the first base is final. */
export function createMetadataParser(options: MetadataParserOptions) {
  const maxField = options.maxFieldLength ?? 2048;
  const maxImages = options.maxImages ?? 8;
  const fields: Partial<Record<'title' | 'description' | 'siteName', Candidate>> = {};
  const images: RawImage[] = [];
  let twitterImage: string | undefined;
  const favicons: string[] = [];
  let currentImage: RawImage | undefined;
  let base: string | undefined;
  let baseSeen = false;
  let titleDepth = 0;
  let title = '';
  let ignoredDepth = 0;
  let done = false;
  let last = '';
  function field(name: keyof typeof fields, value: unknown, rank: number) {
    const clean = safeText(value, maxField);
    if (clean && (!fields[name] || fields[name].rank < rank)) fields[name] = { rank, value: clean };
  }
  function media(value: string): string | undefined {
    try {
      return safeUrl(new URL(value, base ?? options.url).href, true)?.href;
    } catch {
      return undefined;
    }
  }
  function snapshot(): PreviewMetadata {
    const result: PreviewMetadata = {};
    for (const name of ['title', 'description', 'siteName'] as const) {
      const value = fields[name]?.value;
      if (value) result[name] = value;
    }
    if (done || baseSeen) {
      const icon = favicons.map(media).find(Boolean);
      if (icon) result.favicon = icon;
      const resolved: PreviewImage[] = [];
      for (const image of images) {
        const url = (image.secureUrl && media(image.secureUrl)) || media(image.url);
        if (url) {
          const { secureUrl: _secureUrl, ...rest } = image;
          resolved.push({ ...rest, url });
        }
      }
      if (!resolved.length && twitterImage) {
        const url = media(twitterImage);
        if (url) resolved.push({ url });
      }
      if (resolved.length) result.images = resolved;
    }
    return result;
  }
  function notify() {
    const data = snapshot();
    const key = JSON.stringify(data);
    if (key !== last) {
      last = key;
      options.emit?.(data);
    }
  }
  function finish() {
    if (!done) {
      done = true;
      notify();
    }
  }
  const headTags = new Set([
    'html',
    'head',
    'title',
    'base',
    'link',
    'meta',
    'style',
    'script',
    'noscript',
    'template',
  ]);
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (done) return;
        if (ignoredDepth) {
          ignoredDepth++;
          return;
        }
        if (name === 'template') {
          ignoredDepth = 1;
          return;
        }
        if (!headTags.has(name)) {
          finish();
          return;
        }
        if (name === 'title') {
          titleDepth++;
          return;
        }
        if (name === 'base' && !baseSeen && attrs.href !== undefined) {
          baseSeen = true;
          try {
            base = new URL(attrs.href, options.url).href;
          } catch {
            base = options.url;
          }
        }
        if (
          name === 'link' &&
          favicons.length < 8 &&
          (attrs.rel ?? '').toLowerCase().split(/\s+/u).includes('icon')
        ) {
          const candidate = safeText(attrs.href, 8192);
          if (candidate) favicons.push(candidate);
        }
        if (name === 'meta') {
          const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
          const value = attrs.content;
          if (key === 'og:title') field('title', value, 3);
          if (key === 'twitter:title') field('title', value, 2);
          if (key === 'og:description') field('description', value, 3);
          if (key === 'twitter:description') field('description', value, 2);
          if (key === 'description') field('description', value, 1);
          if (key === 'og:site_name') field('siteName', value, 3);
          if (key === 'twitter:image' && !twitterImage) twitterImage = safeText(value, 8192);
          if (key === 'og:image' || key === 'og:image:url') {
            currentImage = undefined;
            const url = safeText(value, 8192);
            if (url && images.length < maxImages) {
              currentImage = { url };
              images.push(currentImage);
            }
          }
          const image = currentImage;
          if (image && key === 'og:image:secure_url' && !image.secureUrl) {
            const secureUrl = safeText(value, 8192);
            if (secureUrl) image.secureUrl = secureUrl;
          }
          if (image && key === 'og:image:alt' && !image.alt) {
            const alt = safeText(value, maxField);
            if (alt) image.alt = alt;
          }
          if (
            image &&
            (key === 'og:image:width' || key === 'og:image:height') &&
            value &&
            /^\d{1,6}$/u.test(value)
          ) {
            const dimension = key.endsWith('width') ? 'width' : 'height';
            if (!image[dimension] && Number(value) > 0) image[dimension] = Number(value);
          }
        }
        notify();
      },
      ontext(text) {
        if (!done && titleDepth && !ignoredDepth) title = (title + text).slice(0, maxField);
      },
      onclosetag(name) {
        if (done) return;
        if (ignoredDepth) {
          ignoredDepth--;
          return;
        }
        if (name === 'title' && titleDepth) {
          titleDepth--;
          field('title', title, 1);
          notify();
        }
        if (name === 'head') finish();
      },
    },
    { decodeEntities: true },
  );
  return {
    write(chunk: string) {
      if (!done) parser.write(chunk);
      return snapshot();
    },
    end() {
      if (!done) {
        parser.end();
        if (title) field('title', title, 1);
        finish();
      }
      return snapshot();
    },
    get done() {
      return done;
    },
    snapshot,
  };
}
