// Ambient module declarations for untyped dependencies.
// This file must stay a global script (no top-level imports/exports)
// so `declare module` acts as an ambient declaration, not an augmentation.

declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdfParse(filePath: string | Buffer): PdfParseResult;
  export default pdfParse;
}

declare module 'cookie-parser' {
  import type { RequestHandler } from 'express';
  function cookieParser(): RequestHandler;
  export default cookieParser;
}