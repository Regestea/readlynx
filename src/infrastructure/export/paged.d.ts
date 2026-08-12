/**
 * Ambient typings for Paged.js (no published `.d.ts`).
 * The package ships a single `Previewer` used directly by PaginationService.
 */

declare module "pagedjs" {
  export interface PagedUnit {
    value: number;
    unit: string;
  }

  /** Promise returned from `Previewer.preview(...)`. */
  export interface PagedFlow {
    pages: HTMLElement[];
    pageSize: {
      width: PagedUnit;
      height: PagedUnit;
      format?: string;
      orientation?: string;
    };
    performance: number;
    [key: string]: unknown;
  }

  export class Previewer {
    constructor(options?: Record<string, unknown>);
    preview(
      content: string | DocumentFragment,
      stylesheets?: (string | Record<string, string>)[],
      renderTo?: HTMLElement,
    ): Promise<PagedFlow>;
    registerHandlers(...handlers: Handler[]): void;
    /** Polisher owning the `data-pagedjs-inserted-styles` nodes. */
    polisher: {
      inserted: HTMLStyleElement[];
      destroy: () => void;
    };
  }

  export class Handler {
    constructor(chunker: unknown, polisher: unknown, caller: unknown);
  }

  export function registerHandlers(...handlers: Handler[]): void;
  export function initializeHandlers(chunker: unknown, polisher: unknown, caller: unknown): unknown;
}