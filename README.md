# T-Translate

<p align="right">
  English | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="public/icon.png" width="128" height="128" alt="T-Translate Logo">
</p>

<p align="center">
  <strong>On-demand translation, privacy by default</strong><br>
  Select to translate · Screenshot to translate · Local model first · API keys encrypted at rest
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.5.1-green" alt="Version">
  <img src="https://img.shields.io/badge/license-T--Translate%201.0-blue" alt="License">
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey" alt="Platform">
</p>

---

T-Translate is a Windows desktop translator: select text in any program and translate it, translate a screenshot, lay a transparent window over a video or game for live translation, turn whatever your computer is playing into captions, and translate PDFs, Word files and e-books end to end.

Privacy comes first: the app ships with its own local model, so one model file in a folder gives you offline translation; every API key is stored with Windows system encryption and never leaves this computer; offline mode sends no network request at all.

## Features

| Feature | Description |
| --- | --- |
| **Select to translate** | Select text in any program and click once; cards can be pinned |
| **Screenshot translate** | Box any screen region to recognize and translate, on any monitor |
| **Floating window** | Transparent overlay; Space to capture; auto refresh follows live captions without stealing focus |
| **Listen mode** | Live captions for whatever is playing, translated sentence by sentence; recognized on this computer, audio never written to disk; captions auto-saved |
| **Document translation** | PDF, Word, EPUB, TXT, Markdown, SRT, VTT, CSV, JSON; paragraph by paragraph, resumable |
| **Local model** | Ships with Qwen3-1.7B: drop the file into a folder and it translates and summarizes, no other software needed |
| **AI actions** | Summaries of long text, paragraph explanations, an explain mode in the floating window; custom actions can be imported |
| **Glossary and style library** | Your term choices are kept automatically; rewrite a translation in the tone of a reference text |
| **Read aloud** | System voices, local neural voice packs or an external server; listen captions can be read line by line |
| **134 languages** | Everything Google Translate supports, plus your own additions |
| **11 translation providers** | Built-in model, LM Studio, Ollama, OpenAI, Claude, Gemini, DeepSeek, DeepL, Google, Microsoft, Baidu |
| **Three privacy modes** | Standard / Incognito / Offline, one click apart |

---

### Select to translate

Select any text, a small icon appears next to it, and one click gives you the translation card. Drag a card to pin it, up to 8 at once; with CapsLock direct mode on, you do not even click the icon.

<p align="center">
  <img src="docs/screenshots/selection-translate.png" width="600" alt="Select to translate">
</p>

### Screenshot translate

Press Alt+Q and box a screen region to recognize and translate. The local engine ships with Chinese, English, Japanese and the Latin-script languages; Korean, Cyrillic, Devanagari, Arabic and more come as downloadable language packs. When one engine cannot read a capture, the next one takes over.

<p align="center">
  <img src="docs/screenshots/screenshot-ocr.png" width="600" alt="Screenshot translate">
</p>

### Floating window

A transparent window over the content you want to read; press Space to translate what is underneath. Translations can sit scattered at their original positions (interfaces, comics) or merge into one passage (articles). Auto refresh keeps translating live captions without ever taking focus; click-through sends your clicks to the program below.

<p align="center">
  <img src="docs/screenshots/floating-window.png" width="600" alt="Floating window">
</p>

### Listen mode

Switch the floating window to "Listen" and the sound your computer is playing turns into captions, translated sentence by sentence. Recognition runs on this computer and the audio only passes through memory. Listen to a single program (Windows 11), and captions are saved as SRT when you stop.

<p align="center">
  <img src="docs/screenshots/Listen.png" width="600" alt="Listen mode">
</p>

### Document translation

Drop in a file and it is translated paragraph by paragraph, with parallel translation, OCR for scanned pages, glossary integration, and resumable progress. Every paragraph can be explained by AI, explained paragraphs can be digested into a summary, and a term check compares the result against your glossary. Right-click a PDF, Word or TXT file in Explorer to open it directly.

<p align="center">
  <img src="docs/screenshots/document-translate.png" width="600" alt="Document translation">
</p>

### Privacy modes

Standard has everything on; Incognito saves nothing; Offline never touches the network, uses only local sources and engines, and does not even decrypt online API keys. A migration pack carries settings, glossary and favorites to another computer.

<p align="center">
  <img src="docs/screenshots/privacy-mode.png" width="600" alt="Privacy modes">
</p>

### Providers

Built-in model, LM Studio, Ollama, OpenAI, Claude, Gemini, DeepSeek, DeepL, Google Translate, Microsoft Translator and Baidu Translate; drag to reorder, and a failing source hands over to the next.

<p align="center">
  <img src="docs/screenshots/providers.png" width="600" alt="Providers">
</p>

### Read aloud

Translations can be read aloud: system voices need no download, neural voice packs synthesize locally and sound more natural, and the external service takes any OpenAI-compatible speech endpoint. Listen captions can be read line by line, with capture paused while speaking.

<p align="center">
  <img src="docs/screenshots/tts.png" width="600" alt="Read aloud">
</p>

---

## Install

Download an installer from [Releases](https://github.com/Tianao0110/T-Translate/releases) (Windows x64). The full user guide is inside the app under Settings → User Guide; the same file is [docs/MANUAL.en.md](docs/MANUAL.en.md).

Build from source:

```bash
git clone https://github.com/Tianao0110/T-Translate.git
cd T-Translate
npm install
npm run ocr:models      # fetch the local OCR base models (one-time, ~19MB)
npm run llama:runtime   # fetch the pinned llama.cpp runtime (one-time, ~34MB)
npm start               # dev mode
npm run dist            # build the installer
```

## Models

The app ships without models. Language packs, listen recognition models and voice packs download with one click on the settings pages. The large files below are not distributed through our servers: download them yourself and put them into the models folder (its location is under Settings → About → Storage):

- Built-in model Qwen3-1.7B (general, 1.8 GB): [official](https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf) · [mirror](https://hf-mirror.com/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf) → `models\llm-models`
- Built-in model Hy-MT2-1.8B (translation only, 1.9 GB): [official](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q8_0.gguf) · [mirror](https://hf-mirror.com/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q8_0.gguf) → `models\llm-models`
- Built-in vision model PaddleOCR-VL-1.6 (two files, 0.9 GB each, needs GPU acceleration): [main model](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/resolve/main/PaddleOCR-VL-1.6-GGUF.gguf) · [image encoder](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/resolve/main/PaddleOCR-VL-1.6-GGUF-mmproj.gguf) → `models\llm-models`
- High-accuracy listen model Qwen3-ASR (806 MB): [download](https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2), extract, and put the whole folder into `models\asr-models`

Mirror links, how to verify a placed file, and fallback download pages are in chapter 5 of the user guide.

## Documentation

| Document | Contents |
| --- | --- |
| [User Guide](docs/MANUAL.en.md) / [使用说明](docs/MANUAL.zh.md) | The complete guide for users, also available inside the app |
| [FAQ](docs/FAQ.md) | Troubleshooting (Chinese) |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Architecture, layout, privacy layering (Chinese) |
| [DEVELOPMENT](docs/DEVELOPMENT.md) | Adding providers / OCR engines / AI actions / languages (Chinese) |
| [T-ENGINE](docs/T-ENGINE.md) | Engine layer maintenance (Chinese) |
| [OCR_MODELS](docs/OCR_MODELS.md) | OCR models and language pack releases (Chinese) |
| [I18N_GUIDE](docs/I18N_GUIDE.md) | Internationalization (Chinese) |
| [THEME_CUSTOMIZATION](docs/THEME_CUSTOMIZATION.md) | Theme customization (Chinese) |
| [MAINTENANCE](docs/MAINTENANCE.md) | Yearly maintenance checklist and model review (Chinese) |
| `docs/design/` | Per-feature design notes and pitfalls (Chinese) |

## Contributing

Issues and pull requests are welcome.

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
