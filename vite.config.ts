import { cpSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Folders pdf.js loads next to the document at runtime instead of bundling:
 *  the WebAssembly decoders (JPEG 2000, JBIG2), CMaps, the standard fonts,
 *  and ICC profiles. Serve them from `public/pdfjs/` so `wasmUrl`,
 *  `cMapUrl`, … can point at them in both dev and the packaged build. */
const PDFJS_ASSET_DIRS = ['wasm', 'cmaps', 'standard_fonts', 'iccs']

function pdfjsAssets(): Plugin {
  const source = resolve(import.meta.dirname, 'node_modules/pdfjs-dist')
  const target = resolve(import.meta.dirname, 'public/pdfjs')
  return {
    name: 'pdfjs-assets',
    buildStart() {
      rmSync(target, { recursive: true, force: true })
      for (const dir of PDFJS_ASSET_DIRS) {
        cpSync(resolve(source, dir), resolve(target, dir), { recursive: true })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react(), pdfjsAssets()],
  build: {
    rolldownOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
