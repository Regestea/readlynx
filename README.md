# ReadLynx

**Create, translate, and read — all in one place.**

ReadLynx is a free, source-available desktop reading and writing app for Windows, macOS, and Linux. It brings your library, a distraction-free reader, a long-form editor, and AI-powered translation together in a single offline-first window.

## Why ReadLynx?

Most reading apps are either a browser tab, an ebook viewer, or an AI wrapper. ReadLynx is all three, sharing one library and one set of preferences:

- **Your books stay on your machine.** Everything lives in a local database and local files. No account, no cloud sync, no tracking.
- **Read what you have.** Import PDFs, EPUBs, and Markdown files — or open them straight from your file manager with a double-click.
- **Read what you can't.** Translate a book into your own language with AI, and read it in the same app, in the same layout you already like.
- **Write your own.** A proper rich-text editor with real page layout for drafting, notes, and manuscripts.

## Features

### Library

A shelf for everything you've imported. Search it, pin favorites, edit metadata, and delete what you don't want. Covers are captured automatically from the first page in the background.

### Reading

- **PDF**, **EPUB**, and **Markdown** viewers with font, size, spacing, width, and color controls
- Fullscreen reading mode, light/dark themes, and an optional daily reading goal
- Reading statistics — daily streaks and a weekly summary, recorded locally
- Selection toolbar for copy and for asking AI about the passage you just highlighted

### Translate

Turn a PDF, EPUB, or Markdown file into another language, using a model you choose and pay for yourself.

- **Multi-model failover** — queue several models and ReadLynx automatically falls back to the next one on rate limits or failures
- **OCR or vision** — scanned PDFs are recognized with OCR; illustrated pages are handled by vision models, preserving figures in place
- **Smart region detection** — repeated headers and footers are trimmed so your translation reads cleanly
- **Language repair pass** — a final check that forces the output into the target language
- **Fully cached** — translations are stored locally and reused, so re-opening a book is instant and costs nothing

### Create

A long-form editor with proper page layout — for drafting, documentation, and notes.

- Headings, lists, tables, code blocks, images, math equations, and Mermaid diagrams
- Custom blocks, callouts, and manual page breaks
- Find and replace, inline AI editing, and autosave
- Reusable **custom instructions** you can layer onto any AI action

### AI Chat

Ask questions about a selection in a book, or about a region of a PDF page. Answers understand Mermaid diagrams and are saved with the book.

### Export

Export both your original books and their translations to **PDF**, **DOCX**, **EPUB**, **HTML**, or **Markdown**, with a live preview and your own margins, page size, and themes.

### Also included

- **File associations** — double-click any `.pdf`, `.epub`, or `.md` to import it
- **Detachable tabs** — split a book into its own window and read side by side
- **Backup & Restore** — one `.zip` file containing your entire library, covers, and translations
- **In-app updates** — checksum-verified installers pulled from GitHub Releases

## Requirements

- Windows 10+, macOS 12+, or a recent Linux distribution
- Disk space for your library — translated books store page images locally

## Getting Started

1. Download the installer for your platform from the [Releases page](https://github.com/Regestea/readlynx/releases).
2. Install and launch ReadLynx.
3. Pick a starting point on the home screen:
   - **Read Book** — import a PDF, EPUB, or Markdown file
   - **Translate Book** — import a book and choose a target language
   - **Create Book** — start writing
4. For AI features (translation, chat, inline editing), open **Settings → AI Models** and add a provider. ReadLynx works with any OpenAI-compatible endpoint, including Google Gemini, OpenRouter, OpenAI, and custom URLs.

Your API keys are stored locally and are only ever sent to the provider you configured.

## Privacy

ReadLynx has no server component.

- Your library, reading history, settings, and translations are stored in a local SQLite database on your device.
- No accounts, no telemetry, no analytics.
- Data leaves your machine only when you trigger an AI action, and then only to the model provider you configured.
- OCR language data and app updates are downloaded from jsDelivr and GitHub respectively.

## Contributing

Issues and pull requests are welcome. Please run the checks below before submitting:

```bash
npm install
npm run typecheck
npm run lint
npm run lint:css
npm run dev
```

## License

ReadLynx is licensed under the **Business Source License 1.1 (BUSL-1.1)**. See [`LICENSE`](./LICENSE) for the full text and [`NOTICE`](./NOTICE) for attribution terms.

In plain terms:

- **Free to use.** Personal, educational, research, and internal use costs nothing. You may run it, modify it, and redistribute it freely.
- **No monetization without permission.** You may not build, sell, license, or offer for subscription any paid product or service from this work — unless ReadLynx is credited as the origin *and* Regestea has given you written permission.
- **Attribution required.** Keep the license and copyright notices intact in anything you redistribute, and credit ReadLynx as the origin.
- **Naming is fine.** Referring to ReadLynx by name, for attribution or to state compatibility, is explicitly allowed.
- **Ownership stays with the author.** All rights — source, design, interface, icons, and trademarks — remain the property of Regestea.
- **Change date: 2028-10-10.** After that date the terms may change under the Regestea Commercial License.

This is a *source-available* license, not an OSI-approved open source license. If you need a different arrangement, contact the author.

## Acknowledgements

Built on the shoulders of excellent open-source projects, including Electron, React, Vite, Lexical, pdf.js, epub.js, Tesseract.js, KaTeX, Mermaid, and Paged.js.
