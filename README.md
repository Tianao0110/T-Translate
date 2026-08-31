# T-Translate

<p align="right">
  English | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="public/icon.png" width="128" height="128" alt="T-Translate Logo">
</p>

<p align="center">
  <strong>On-demand translation, privacy by default</strong><br>
  Select to translate · Screenshot to translate · Local LLM first · API keys encrypted at rest
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.4.0-green" alt="Version">
  <img src="https://img.shields.io/badge/license-T--Translate%201.0-blue" alt="License">
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey" alt="Platform">
</p>

---

## Features

| Feature                            | Description                                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Selection translator**     | System-wide. Select text in any app to translate. Up to 8 pinned windows                                                               |
| **Screenshot OCR**           | Capture screen regions. 59 recognition languages, 7 OCR engines with automatic fallback                                                |
| **Floating window**          | Transparent overlay. Space-bar to capture-and-translate; auto-refresh & global-hotkey zero-focus capture for live captions / subtitles |
| **Listen mode**              | Live captions for whatever is playing, translated sentence by sentence. Chinese / English / Japanese / Korean / Cantonese, recognized on-device, audio never touches disk; exports SRT |
| **Document translation**     | 9 formats: PDF / DOCX / EPUB / TXT / SRT / VTT / CSV / JSON / Markdown. Segment-by-segment, resumable, with term check; Explorer right-click entry |
| **134 languages**            | Everything Google Translate supports, in a picker with a letter index and a recently-used row; more can be added by hand                |
| **AI actions**               | Summaries of long passages; "Explain mode" in the floating window and per-paragraph explanations in documents; custom actions can be imported (needs an LLM provider) |
| **Glossary**                 | Auto-replace terms after translation, with undo support                                                                                |
| **TTS**                      | Built on Windows offline speech engine                                                                                                 |
| **10 translation providers** | LM Studio, Ollama, OpenAI, Claude, Gemini, DeepSeek, DeepL, Google, Microsoft, Baidu                                                   |
| **3 privacy modes**          | Standard / Incognito / Offline. Offline mode blocks decryption of online API keys                                                      |
| **Migration pack**           | One-file export/import of settings, glossary, favorites and custom languages                                                           |
| **Auto-start**               | Silent tray launch with optional auto-enable for selection translator                                                                  |

---

### Selection translator

Select any text and a translation window pops up automatically. Up to 8 pinned windows can stay open at once. Source language is detected automatically.

<p align="center">
  <img src="docs/screenshots/selection-translate.png" width="600" alt="Selection translator">
</p>

### Screenshot OCR translation

Capture a screen region for text recognition; when an engine is unavailable or cannot read the capture, the chain falls back to the next one. 59 recognition languages: Chinese, English, Japanese and 37 Latin-script languages built in; Korean, Cyrillic, Devanagari, Arabic, Tamil, Telugu and Kannada each need one language pack, covering every language in that script.

<p align="center">
  <img src="docs/screenshots/screenshot-ocr.png" width="600" alt="Screenshot OCR translation">
</p>

### Floating window

Transparent overlay for live translation — drag, resize, pin on top, spawn independent child panes. Space / left-click toggles: with content, clear; without, capture and translate.

**Zero-focus capture**: auto-refresh (2/3/5/10s intervals) and the `Ctrl+Alt+Space` hotkey re-capture without taking focus, so live captions don't vanish.

<p align="center">
  <img src="docs/screenshots/floating-window.png" width="600" alt="Floating window">
</p>

### Listen mode

The waveform icon in the floating window's toolbar, then press ▶: it transcribes whatever your computer is playing and translates it sentence by sentence. For videos with no subtitles, meetings, or streams in a language you're learning.

Recognition runs on your machine. **Audio passes through memory and is never written to disk**, and it is never uploaded. Translation goes through whichever provider you configured — pick a local model and nothing leaves the machine at all.

Chinese, English, Japanese, Korean and Cantonese, picked manually or detected from the first sentence. With the optional draft engine installed, Chinese and English appear while you speak (first characters in under a second) and are corrected when the sentence ends; without it, text appears once the sentence is done.

Subtitles export to SRT (source and translation on separate lines). Listen mode is unavailable in Incognito mode.

**Models are downloaded on demand**: Settings → Listen models. Base model 153 MB (required), draft engine 168 MB (optional). A running session uses about 600-700 MB of memory, released when you stop.

### AI features (Explain / Summarize)

A layer of understanding on top of translation, built on exactly two concepts: **Explain helps you get this passage, Summarize helps you get through a long one.** Summarize turns a long passage into key points — selection card, main panel, and floating window. **Explain mode** (floating window, top-left) explains captures instead of translating them. With a vision model loaded, the model reads the screenshot itself, falling back to the text path when it cannot.

Summaries attach to their translation in history; understanding results get entries of their own. Custom actions can be imported in Settings. **An LLM provider is required** — translate-only sources are marked in Settings.

### Language selection

134 languages — everything Google Translate supports. The picker pins recent languages on top, groups the rest by letter under a clickable index strip, and sorts by the interface language. Languages not in the list can be added at the bottom, with an optional separate name to send the model.

### Document translation

Supports 9 formats: PDF, DOCX, EPUB, TXT, SRT, VTT, CSV, JSON, Markdown — with parallel translation, scanned-PDF OCR and glossary integration. PDF, DOCX and TXT open straight from the Explorer right-click menu ("Translate with T-Translate"). When translation or a document summary finishes with the window in the background, a system notification lets you know.

With an LLM provider, each paragraph can be **explained** under its translation, and a **consolidated note** collects the explanations; both are saved with the progress and come back when you reopen the file. After translating, **term check** replaces glossary terms left untranslated, with per-spot undo.

<p align="center">
  <img src="docs/screenshots/document-translate.png" width="600" alt="Document translation">
</p>

### Privacy modes

Three levels of privacy control. In offline mode, only local LLMs are used. Online API keys are blocked from decryption even if internal code attempts to access them.

Settings → Privacy can export a **migration pack** (settings, glossary, favorites, custom languages) to import on another machine. API keys never travel with the pack — re-enter them on the new machine.

<p align="center">
  <img src="docs/screenshots/privacy-mode-standard.png" width="600" alt="Privacy standard modes">
  <img src="docs/screenshots/privacy-mode-Incognito.png" width="600" alt="Privacy incognito modes">
  <img src="docs/screenshots/privacy-mode-offline.png" width="600" alt="Privacy offline modes">
</p>

### Multi-provider

10 providers: local LLM (LM Studio / Ollama), OpenAI, Anthropic Claude, Gemini, DeepSeek, DeepL, Google Translate, Microsoft Translator, Baidu Translate. Switch freely, drag to reorder, set priority. On failure, falls back to the next available provider automatically.

<p align="center">
  <img src="docs/screenshots/providers.png" width="600" alt="Multi-provider">
</p>

### TTS

Speak translation results aloud using Windows' offline speech engine. Rate adjustable. Voice list reflects locally installed speech packs; with language set to auto, the voice is picked from the script and diacritics of the text.

<p align="center">
  <img src="docs/screenshots/tts.png" width="600" alt="TTS">
</p>

---

## Quick start

Download an installer from [Releases](https://github.com/Tianao0110/T-Translate/releases), or build from source:

```bash
git clone https://github.com/Tianao0110/T-Translate.git
cd T-Translate
npm install
npm run ocr:models   # fetch local OCR base models (one-time, ~19MB)
npm start            # dev mode
npm run dist         # build installer (runs the fetch automatically)
```

---

## Keyboard shortcuts

| Shortcut           | Action                                      |
| ------------------ | ------------------------------------------- |
| `Alt+Q`          | Screenshot translate                        |
| `Ctrl+Shift+W`   | Show / hide main window                     |
| `Ctrl+Alt+G`     | Open floating window                        |
| `Ctrl+Shift+T`   | Toggle selection translator                 |
| `Ctrl+Alt+Space` | Re-capture floating window (no focus steal) |
| `Ctrl+Enter`     | Run translation                             |

*Shortcuts are customizable in Settings.*

---

## Security & Privacy

Privacy is a core design principle:

- **Local-first** — Local LLM is the top priority. Fully usable offline
- **Main-process enforcement** — All translation and online-OCR requests originate from the main process; renderer processes contain no network code. Privacy modes are enforced per request in the main process (incognito writes no caches, offline applies engine allowlists) — no window can bypass them
- **Encrypted at rest** — API keys encrypted via Windows DPAPI. No plaintext fallback. Translation history, favorites and statistics are encrypted on disk the same way
- **Access audit** — Every decryption operation is logged. Abnormal frequency triggers alerts
- **Privacy interlocks** — Offline mode blocks decryption of online API keys
- **Least privilege** — Each window has its own preload script exposing only the APIs it needs
- **No axios** — Unaffected by recent npm supply chain attacks

---

## 📁 Project structure

```
t-translate/
├── electron/               # Main process
│   ├── main.js             # Entry point
│   ├── preloads/           # Preload scripts (per-window isolation)
│   ├── shared/             # Shared constants and config
│   ├── ipc/                # IPC handlers (with secure-storage audit)
│   ├── managers/           # Window / tray / menu managers
│   └── utils/              # Native utilities (Win32 API, state machines)
│
├── src/                    # Renderer code + main-process translation stack sources
│   ├── stack/              # Translation stack (runs in main: 10 providers + OCR chain + cache, bundled by esbuild)
│   ├── components/         # React components
│   ├── assets/             # Static assets (provider icons)
│   ├── services/           # Service layer (stack client, capture pipeline)
│   ├── stores/             # Zustand state management
│   ├── config/             # Config (privacy modes, templates, constants, AI action catalog)
│   └── i18n/               # i18n (zh / en, 1000+ keys each)
│
├── public/                 # HTML entry + static assets
├── resources/              # App resources (bundled OCR base models)
├── scripts/                # Utility scripts
└── docs/                   # Project documentation
```

## 🏗️ Tech stack

| Category           | Technology                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework          | Electron 42 + React 18                                                                                                                                               |
| Build              | Vite 7 (renderer) + esbuild (main-process translation stack)                                                                                                         |
| State              | Zustand + Immer                                                                                                                                                      |
| Styling            | CSS Variables                                                                                                                                                        |
| Secure storage     | Electron safeStorage (Windows DPAPI) + access audit                                                                                                                  |
| OCR                | PP-OCRv6 local (Chinese/English/Japanese/Latin scripts built in, downloadable language packs) / Windows OCR / LLM Vision / OCR.space / Google Vision / Azure / Baidu |
| Local LLM          | LM Studio / Ollama (OpenAI-compatible API)                                                                                                                           |
| Online translation | OpenAI / Claude / Gemini / DeepSeek / DeepL / Google / Microsoft / Baidu                                                                                             |
| Packaging          | electron-builder                                                                                                                                                     |

More docs under `docs/`: [Architecture](docs/ARCHITECTURE.md) · [Development guide](docs/DEVELOPMENT.md) · [FAQ](docs/FAQ.md) · [OCR models](docs/OCR_MODELS.md) · [i18n guide](docs/I18N_GUIDE.md) · [Theme customization](docs/THEME_CUSTOMIZATION.md)

---

## Contributing

Issues and pull requests are welcome.

---

## License

[T-Translate License 1.0](LICENSE) (source-available; the Chinese text prevails) — in three lines:

- **Use and modify freely**: personal / team / commercial use, modification, and distribution are all free of charge
- **Free forever**: the software and any modified version containing its code (including features added by modifiers) may not be monetized in any form — no selling, paid downloads, in-app purchases, pay-to-unlock, or paywalled sharing; for commercial sale, [contact the author](https://github.com/Tianao0110/T-Translate) for a separate license
- **Keep attribution**: modified versions must be marked "modified from T-Translate" with a link to the original project, and may not be claimed as original work

Monetized tutorials/reviews, paid deployment/consulting services, and voluntary donations (not gating features) are all fine. Third-party dependencies remain under their own licenses (see [NOTICE](NOTICE)). Versions up to v0.3.0 were released under MIT and remain unaffected.

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/Tianao0110">Edan Zeng</a>
</p>
