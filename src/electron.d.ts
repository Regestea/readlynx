export {};

declare global {
  interface Window {
    readlynx?: {
      exportPdf(options: {
        defaultPath: string;
        pageSize: { width: number; height: number };
        margins: { top: number; bottom: number; left: number; right: number };
      }): Promise<string | null>;
    };
  }
}
