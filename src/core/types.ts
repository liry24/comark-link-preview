/** Full snapshots replace previous fields. Partial metadata is never a cache entry. */
export interface PreviewMetadata {
  title?: string;
  description?: string;
  siteName?: string;
  favicon?: string;
  images?: PreviewImage[];
}
export interface PreviewImage {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}
export interface PreviewSnapshot {
  state: 'pending' | 'ready' | 'failed';
  metadata: PreviewMetadata;
}
export interface ResolveOptions {
  signal: AbortSignal;
  emit: (snapshot: PreviewSnapshot) => void;
  /** Charged after decompression, separately from each request's own limit. */
  consumeBytes?: (bytes: number) => void;
  authorizeRedirect?: (url: URL, from: URL) => Promise<void>;
}
export type PreviewResolver = (url: string, options: ResolveOptions) => Promise<PreviewMetadata>;
export type DiagnosticCode =
  | 'denied'
  | 'invalid-url'
  | 'network'
  | 'timeout'
  | 'limit'
  | 'content-type'
  | 'encoding'
  | 'http'
  | 'parse';
export type PreviewLogger = (event: { code: DiagnosticCode }) => void;
export interface TransportResponse {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}
/** One fresh GET without implicit redirects. The application owns network egress policy. */
export type PreviewTransport = (url: URL, signal: AbortSignal) => Promise<TransportResponse>;
export interface ResolverLimits {
  deadlineMs: number;
  maxBytes: number;
  maxRedirects: number;
  maxFieldLength: number;
  maxImages: number;
}
export class PreviewError extends Error {
  constructor(public readonly code: DiagnosticCode) {
    super(code);
    this.name = 'PreviewError';
  }
}
