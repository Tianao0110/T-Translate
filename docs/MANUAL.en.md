# T-Translate User Guide

This guide ships with the app and can be read offline under Settings → User Guide. The copy on GitHub is the same file.

## 0. Getting started

### 0.1 Install and first launch

- Double-click the installer. You can pick the install folder.
- Uninstalling keeps your settings, history and downloaded models; they are back after a reinstall.
- After installing, right-clicking a .pdf, .docx or .txt file shows "Translate with T-Translate", which opens the file for translation straight away.
- The first launch shows a one-page tour. Click "Get started" to enter the main window.
- Google Translate works right away and needs the internet. To translate without the internet, put the built-in model file into the models folder (chapter 5), or run LM Studio or Ollama on this computer. If the translation panel says no translation source is available, click "Set up".
- The settings page shows only the common items at first; click "Full" at the bottom left to see everything.
- The close button in the main window minimizes the app to the tray. To quit for real, right-click the tray icon and choose "Quit".

### 0.2 Tray icon

- Single click: turn select-to-translate on or off. When it is on, the tooltip shows a ✓.
- Double click: open the main window.
- Right-click menu: Screenshot Translate, Floating Window, Selection Translate, Settings, Quit.
- To start the app with Windows: Settings → Appearance → Startup, turn on "Launch at startup". Turn on "Enable selection translate on startup" as well and you can select text right after boot without touching the tray.

### 0.3 Global shortcuts

These five work in any program:

- **Alt+Q**: screenshot translate
- **Ctrl+Shift+W**: show / hide the main window
- **Ctrl+Alt+G**: open / close the floating window
- **Ctrl+Shift+T**: turn select-to-translate on or off
- **Ctrl+Alt+Space**: make the floating window capture again

All of them can be changed under Settings → Appearance → Shortcuts. If the app reports at startup that a shortcut is taken by another program, pick a different combination. The full list is in chapter 6.

### 0.4 The three privacy modes

Switch under Settings → Privacy:

- **Standard**: everything on, history saved automatically.
- **Incognito**: nothing is saved; closing the window clears everything.
- **Offline**: no network at all; only translation sources and recognition engines on this computer are used.

For a feature-by-feature comparison, click "Details" on the Privacy page.

## 1. Main window

The main window has five pages: Translate, History, Favorites, Settings, Documents. Click the icons or press Ctrl+1 to Ctrl+5.

### 1.1 Translation panel

**Languages**

- Source language on the left, target on the right. Leave the source on "Auto Detect" and the app works it out.
- The swap button in the middle exchanges the two.
- The language list is grouped by first letter with an index strip on the right; recently used languages sit at the top.

**Tone**

Three tone buttons under the languages: Natural (everyday), Precise (technical, academic), Formal (business, official). Pick one and translations follow it.

**Source box**

- Type or paste text. Press Ctrl+Enter or click "Translate".
- With "Auto Translate" on (Settings → Translation), translation starts shortly after you stop typing.
- Buttons above the box: screenshot OCR, import image, paste, clear, read the source aloud.
- You can also drop an image or a .txt / .md file onto the box: images are recognized first, text files are read in.
- If the clipboard holds an image, "Paste" recognizes the text in it.

**Translation box**

- The translation can be edited in place. After an edit, a version switch appears at the top right so you can flip between the original translation and your edit.
- Buttons above the box: copy, style rewrite, favorite, read aloud. When the text is long enough, "Summarize" appears too (see 1.5).
- **Style rewrite**: pick a reference text from the style library and have the model rewrite the translation in that tone, with a strength setting. The style library is maintained on the Favorites page, see 1.3.
- **Favorite**: opens a dialog for tags and notes; with a chat-capable source the app suggests tags and a summary. Tick "Mark as style reference" to save it into the style library.

**Terms**

- When the glossary has a term and the translation did not use it, a hint appears under the translation: apply it, ignore this time, or never remind for this term.
- If the translation still contains a glossary word untranslated, it is replaced with your rendering; a toast at the bottom offers "Undo".

### 1.2 History

- Every translation is saved here automatically; nothing is saved in incognito mode.
- Search at the top, filter by time (today / this week / this month) and by origin (main window / selection / screenshot / floating window).
- Card view and table view; the table sorts by time, language and length.
- Click an entry to flip between source and translation, double-click for details. Entries with AI results are marked and show them in the details.
- Each entry can be copied (source or translation), favorited, restored into the translation panel for editing, or deleted.
- "Select" enters multi-select: Space selects, Esc leaves, and you can delete in bulk.
- "Export" saves history to a file, "Import" reads it back; import is off in incognito mode.
- In search results, ↑↓ move and Enter copies the translation.
- To clear old entries automatically, set the days under Settings → Privacy → Data management → "Auto-delete history after".

### 1.3 Favorites

- Click the star in the translation panel, in history, on a selection card or in the floating window.
- Folders on the left: Work, Study and Life by default, which you can add to or delete; two fixed ones: **Glossary** and **Style library**.
- Each favorite can have tags and notes, can be moved between folders, and tags can be generated by AI.
- Tags sit at the bottom left, one row only. Click the arrow next to them and all tags fill the left sidebar; pick one and the right side shows only the favorites that carry it, pick the same tag again to clear the filter. Click the arrow or press Esc to close.
- **Glossary**: stores "original word → your rendering". After a translation, if the result still contains the original word untranslated, it is replaced with your rendering. This works in the main window, documents, selection, the floating window and listen captions. If the model already translated the word another way, nothing is changed; the main window shows a hint under the translation instead (see 1.1).
- A term only applies when translating into the language it was saved for, so the same word can have one rendering for Chinese and another for French. Terms brought in with "Import Terms" count as the current target language.
- English terms match whole words only. Save phrases rather than very short words such as `token`.
- "Import Terms" and "Export Terms" support JSON, CSV and TBX. The document translator's "Check terms" uses the same entries.
- **Style library**: the reference texts for "Style rewrite" in the translation panel. Tick "Mark as style reference" when saving, or toggle it on the favorite card.

### 1.4 Document translation

- Nine formats: plain text, Markdown, SRT subtitles, WebVTT subtitles, PDF, Word (.docx), CSV, JSON, EPUB. One file up to 20 MB.
- Drop a file in or click to choose. Right-clicking a .pdf / .docx / .txt in Explorer and choosing "Translate with T-Translate" opens it here too.
- Encrypted PDFs ask for the password. Scanned PDFs have no text layer, so the app runs OCR page by page; set up an OCR engine in Settings first.
- The document is shown paragraph by paragraph, stacked or side by side. The outline on the left jumps to headings.
- "Start translation" translates paragraph by paragraph; you can pause, resume and stop. Failed paragraphs can be retried one at a time or all at once with "Retry Failed".
- Every translated paragraph can be edited, retranslated or copied.
- The "Parallel" switch at the bottom translates several paragraphs at once; turn it off if a local model is unstable.
- The "Glossary" switch at the bottom controls whether glossary terms are applied.
- Closing the app mid-way is fine: opening the same file again offers to restore the previous progress.
- **Export**: bilingual or translation-only TXT, Markdown and Word; PDF through the print dialog; subtitles as SRT or VTT.
- **Explain and summarize**: each paragraph has "Explain this paragraph"; after two or more explanations you can summarize the explained paragraphs; the whole-document "Summarize" button explains every paragraph first and then summarizes, which takes a while on long documents and is billed per use on online APIs.
- **Check terms**: checks the whole document against the glossary, lists what can be replaced, and lets you undo one at a time. No model is involved.
- The statistics button at the bottom right shows paragraph counts, characters and time; when a document finishes while the window is in the background, a system notification appears.

### 1.5 AI actions

AI actions add a layer of understanding on top of translation, such as summarizing a passage into key points or explaining a block of content.

- Two built in: **Summarize** (translation panel, selection card, floating window; only when the text is long enough) and **Explain** (the floating window's explain mode and every paragraph of a document).
- They need a chat-capable source: the built-in general model, LM Studio, Ollama, OpenAI, DeepSeek, Gemini, Claude and the like. Traditional sources such as Google Translate, DeepL, Baidu and Microsoft cannot do them; their cards say "No AI actions".
- Results show under the translation and can be folded; they are also attached to the matching history entry and visible in its details.
- With a vision model set up, screenshot content is handed to the vision model as an image; the button says so.
- The length threshold for "Summarize" and importing more actions are under Settings → AI Actions.

### 1.6 Title bar and window behavior

- Minimize, maximize and close sit at the right of the title bar. Close only minimizes to the tray; the app keeps running.
- Drag the title bar to move the window; F11 for full screen.
- The status bar at the bottom shows the current state (ready / translating), the language pair, today's translation count and the version.
- Every page keeps its content when you switch, so a running document translation survives a trip to History and back.

## 2. Select to translate

Select text in any program and translate it.

**Turning it on and off**

- Single-click the tray icon, press Ctrl+Shift+T, or turn on "Enable Selection Translation" under Settings → Selection. When it is on, the tray tooltip shows a ✓.
- It is off when the app starts. To have it on after boot, see 0.2.

**How it works**

1. Drag to select text, or double- or triple-click a word or paragraph.
2. Release the mouse and a small icon appears next to it. It disappears after a few seconds if you do not click it (the time is a setting).
3. Click the icon and the translation card pops up.
4. Buttons on the card: show source, copy translation, read aloud, close. Right-clicking the card also closes it. "Summarize" appears when the text is long enough.
5. The card disappears after a while; keeping the mouse on it keeps it open.

**Pinning a card**

- Drag a card and it stays pinned; the next selection opens a new card. Pinned cards close with a right click; up to 8 can be pinned at once.

**CapsLock direct mode**

- With "CapsLock Direct Mode" on under Settings → Selection, selecting text pops the card up directly while the CapsLock light is on, no icon click needed. Turn CapsLock off to get the normal flow back; typing capitals is unaffected.
- In terminal programs (Windows Terminal, Command Prompt and the like) the icon still comes first.

**Related settings** (Settings → Selection)

- Button auto-hide time, show source by default, close after copy.
- Character limits: selections that are too short or too long are not translated; the default is 2 to 2000 characters.
- Window opacity, Rainbow selection window (a colorful alternative look).
- Screenshot output: whether screenshot results appear in a bubble window or the main window, see 3.2.

## 3. Floating window

The floating window is a transparent window you lay over what you want to read; it translates the text underneath. Open it with Ctrl+Alt+G or "Floating Window" in the tray menu.

### 3.1 Glass, always on top, scattered vs unified

**The window itself**

- Drag the strip at the top to move it, drag the edges to resize it. It always stays above other windows.
- Click the small bar at the top to adjust opacity; the default opacity is under Settings → Floating Window.
- Three modes at the top: Screenshot translate, Explain, Listen. Listen needs a recognition model first (see 3.3).
- By default the floating window is invisible to screenshot and recording tools. To include it, turn on "Allow the overlay in screenshots and recordings" under Settings → Floating Window.

**Capture**

- Place the window over the content, press Space or click the camera button, and the app recognizes and translates the text underneath. Press Space again to clear.
- Two layouts: **scattered** puts each block of translation at the position of the original text, good for interfaces, word lists and comics; **unified** merges everything into one translation, good for articles. "Auto" decides by content; fix it under Settings → Floating Window → Display mode. A small badge at the bottom right tells you which one was used.
- In scattered mode every block can be dragged; double-click a block to turn it into its own small window that outlives the floating window.

**Auto refresh**

- Click the auto-refresh button and pick an interval (2, 3, 5 or 10 seconds); the app keeps capturing the same area and does nothing while the content is unchanged. Good for live captions and meeting subtitles.
- Moving the window, a manual capture or closing the window stops it.

**Click-through**

- Click the click-through button and clicks on the content area go to the program underneath, for example to turn comic pages; the top strip stays clickable, Esc exits.
- Holding Alt is a temporary click-through; release to restore.

**Explain mode**

- Switch to "Explain" and a capture is explained instead of translated, with the result in the window. Needs a chat-capable source, see 1.5.

**Other**

- Ctrl+H opens recent translations.
- The floating window uses the engine chosen under Settings → OCR by default; you can pick a different one under Settings → Floating Window.

### 3.2 Screenshot OCR

- Press Alt+Q, or use "Screenshot Translate" in the tray menu or the screenshot button in the translation panel. The screen dims; drag out a box. Any monitor works.
- By default you confirm with ✓ or Enter and cancel with Esc. To skip the confirmation, turn off "Show Screenshot Confirm Buttons" under Settings → OCR.
- Where the result goes is set under Settings → Selection → Screenshot output: **bubble window** shows a translation card next to the box, like the selection card; **main window** fills the recognized text into the translation panel and translates it.
- If the chosen OCR engine cannot run (for example the vision model is not installed yet), the app falls back to local recognition and says so in the result.

### 3.3 Live captions (listen mode)

Turns the sound playing on this computer into captions and translates them in real time. Audio is processed in memory only and never saved.

**Preparation**

- Download the "Base model" under Settings → Audio → Listen. For text that appears while speech is still going, add the "Draft engine"; for better accuracy with music or noise, add the "High-accuracy final engine" and switch the final tier to high accuracy.

**Use**

1. Switch to "Listen" at the top of the floating window.
2. Pick the sound source: all sound, or one program only (needs Windows 11).
3. Pick the recognition language (auto works) and the translation target (or no translation).
4. Click start. Captions appear: a line for what is being said, which turns into a final line, followed by its translation. The small bar at the top left moves with the sound so you can see audio is arriving.
5. Hover a line to read it aloud; capture pauses while it speaks and resumes afterwards.
6. Click stop to finish.

**Subtitle files**

- On stop or when switching sources, captions are saved as an .srt file under `data\listen` in the app folder; the newest 20 are kept. The folder button at the top opens it. Nothing is saved in incognito mode.
- To turn auto-save off, use Settings → Audio → Listen.

**Hints**

- "No sound detected": check whether the system volume is muted.
- "Sound, but no clear speech recognized for a while": try another recognition language.
- When the chosen program exits, capture switches back to all sound.

## 4. Settings

Click "Settings" in the main window, or press Ctrl+4 / Ctrl+,. Pages are on the left; the box at the top searches settings. The catalog starts in simple mode with the common pages only; click "Full" at the bottom left for everything.

Most settings need "Save Changes" at the bottom right; theme, language, shortcuts and opacity apply immediately and need no save.

### 4.1 Providers

- The upper part lists enabled sources; they are tried in order and the first success wins. Drag cards to reorder.
- On each card: the switch on the right enables or disables it; the gear opens its configuration (API address, key, model name) with "Test Connection" and a "Get API Key" link.
- The lower part lists disabled sources; click "Enable" to add one.
- The tag on a card gives its type: AI model, professional API, traditional. Cards marked "No AI actions" only translate; they cannot summarize or explain.
- The built-in model's card shows whether it runs on the GPU or the CPU, whether it is loaded and how fast it is, with self-test and unload buttons.
- Keys are stored encrypted on this computer; the settings file never holds them in plain text.

### 4.2 Translation

- Auto translate: starts after you stop typing; the delay is adjustable below.
- Streaming output: the translation appears word by word.
- When the content is already in the target language: show the source, or translate back into your source language. Applies to selection and the floating window.
- Custom languages: languages added at the bottom of the language picker are listed here and can be removed. Google Translate does not support them; whether they translate depends on the model in use.
- Translation cache: repeated text returns the cached result; clear it here.

### 4.3 Selection

See "Related settings" in chapter 2.

### 4.4 Floating Window

- Default opacity.
- Display mode: auto / scattered / unified, see 3.1.
- OCR engine: follows the OCR page by default, or pick one just for the floating window.
- Allow the overlay in screenshots and recordings: off by default.

### 4.5 Documents

- Max characters per segment: longer paragraphs are split at this size.
- Segments at once: how many paragraphs parallel mode translates together. 1 to 2 for local models; online APIs can go higher.
- Smart filter: skip short paragraphs (with a minimum length), skip number-only paragraphs such as page numbers, keep code blocks untranslated, skip paragraphs already in the target language.
- Default display style: stacked or side by side.
- The supported file formats are listed below.

### 4.6 AI Actions

- Built-in actions: Summarize, Explain. Adjust the length threshold for "Summarize" here; lower it if the button does not show when you expect it.
- Imported actions: "Import a config file" takes a JSON file with one action or a set; save to apply. Invalid files are rejected with a reason.
- Imported actions can be removed.

### 4.7 Local model

The model that ships with the app; you download the files yourself and put them into the models folder, see chapter 5.

- Model: which one to use. The general model translates and runs AI actions; the translation-only model only translates, and AI actions automatically move to another AI source while it is selected.
- Model files: one card per file showing installed / not installed / file mismatch, with official and mirror download links. After placing a file, click "Rescan", or "Open folder" to look.
- Custom models (developer): when on, other GGUF files in the folder become selectable and can be probed, with a trial report. These are unverified; judge the results yourself.

### 4.8 OCR

- Recognition language: auto by default. Chinese, English, Japanese and most Latin-script languages are built in; Korean, Cyrillic, Devanagari, Arabic and others need a language pack downloaded below.
- Screenshot options: show confirm buttons; enlarge small images for better recognition of small text.
- Engines come in three groups; click "Use" to make one the default:
- **Local engines**: Local OCR (built in, milliseconds) and Windows OCR (ships with Windows, no download, modest quality). Local OCR has a model tier (standard / high accuracy, the latter better on blurry photos and stylized text, about 95 MB to download), the language pack list, and an engine recheck.
- **Vision models**: the built-in vision model (two files you download yourself, usable only with GPU acceleration on; simple captures still go to local OCR, large images, columns and tables go to the vision model) and LLM Vision (the LM Studio / Ollama address and a vision model name).
- **Online services**: OCR.space, Google Vision, Azure, Baidu OCR, each with its key. Disabled automatically in privacy modes.

### 4.9 Audio · Listen

- From the "Audio" page, click "Listen".
- Recognition model list: base recognition model (required), draft engine (optional, text while speech is still going), high-accuracy final engine (optional, too large to download here; fetch it from the link and place it in the given folder). Download, update and uninstall live here.
- Final tier: standard / high accuracy.
- Auto-save captions on stop or switch: on by default.

### 4.10 Audio · Speak

- From the "Audio" page, click "Speak".
- Enable Text-to-Speech: when off, no read-aloud buttons are shown anywhere.
- Engine: system voices (no download), neural voices (voice packs required, more natural), external service (appears once an address is filled in).
- Now speaking: what is actually in use, with a preview. If the chosen engine cannot speak, system voices take over automatically.
- Voices: neural voices are chosen per language (Chinese, English) through a picker with search and preview; system voices can be fixed to one, or chosen automatically by text language.
- External speech service: address, key, model and voice, then "Test and listen". Not available in offline mode.
- Rate, pitch and volume sliders. Pitch only affects system voices.
- Voice packs: download and uninstall on the "Voice packs" tab.

### 4.11 Appearance

- Interface language: 中文 / English.
- Theme: Default, Fresh, Dark.
- Startup: launch at startup, enable selection translate on startup.
- Notifications: system notification when a long task finishes.
- Shortcuts: the five global shortcuts; click one and press a new combination, or reset to defaults.

### 4.12 Privacy

- Three modes at the top: standard / incognito / offline, with each feature's state in the current mode below and "Details" for the full comparison.
- Data management: how much history, favorites, cache, document progress, settings and logs take up; clear history, clear cache, or clear all data; "Auto-delete history" in days, 0 means never.
- Migration: "Export Migration Pack" bundles settings, glossary, favorites and custom languages into one file; "Import Migration Pack" on another computer lets you pick which parts to take. API keys and model files are never included.

### 4.13 About

- Version and "Check for Updates". A new version can be downloaded and installed from here, or fetched from GitHub by hand.
- Storage: where the data and models folders are, with buttons to open them. Models left elsewhere by an older version can be moved into the app folder, and the old folder cleaned afterwards.
- GPU acceleration: one switch. When on, local OCR, neural voices, the local model and the built-in vision model run on the GPU; each engine self-tests first and stays on the CPU if it cannot, no restart needed. Listen recognition always stays on the CPU.
- Engine status: where each engine runs, its self-test result and speed.
- Open the log folder, reset all settings (API keys are kept).

## 5. Models and downloads

The app ships without models. Small ones download with one click on the settings pages; large ones (hundreds of MB to 2 GB) are not distributed through our servers: download them from the links below and place them in the models folder. Every model runs on this computer; once downloaded, nothing goes online.

The models folder is shown under Settings → About → Storage and can be opened from there. By default it is `models` inside the install folder, with four subfolders:

- `llm-models`: the built-in model and the built-in vision model
- `ocr-models`: OCR language packs and the high-accuracy model
- `asr-models`: listen recognition models
- `tts-models`: neural voice packs

### 5.1 Built-in models (manual download)

Put the file into `models\llm-models`, keep the original file name, then click "Rescan" under Settings → Local model. The app verifies the file and only uses it after a successful check; "File mismatch" means an incomplete download or a different version, so download it again.

**Qwen3-1.7B** (general, default): translation plus every AI action. File `Qwen3-1.7B-Q8_0.gguf`, about 1.8 GB, needs 8 GB of RAM.

- Official: https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf
- Mirror: https://hf-mirror.com/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf

**Hy-MT2-1.8B** (translation only): translates well and fast, but cannot summarize or explain. File `Hy-MT2-1.8B-Q8_0.gguf`, about 1.9 GB, needs 8 GB of RAM.

- Official: https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q8_0.gguf
- Mirror: https://hf-mirror.com/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q8_0.gguf

**PaddleOCR-VL-1.6** (built-in vision model): both files are needed, the main model about 0.9 GB and the image encoder about 0.9 GB. Usable only with GPU acceleration on. After placing them, click "Re-detect" under Settings → OCR → Vision models.

- Main model, official: https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/resolve/main/PaddleOCR-VL-1.6-GGUF.gguf
- Main model, mirror: https://hf-mirror.com/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/resolve/main/PaddleOCR-VL-1.6-GGUF.gguf
- Image encoder, official: https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/resolve/main/PaddleOCR-VL-1.6-GGUF-mmproj.gguf
- Image encoder, mirror: https://hf-mirror.com/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/resolve/main/PaddleOCR-VL-1.6-GGUF-mmproj.gguf

The same links are on the Local model and OCR settings pages and open in your browser. All three models are Apache-2.0.

### 5.2 High-accuracy listen model (manual download)

More accurate with music or noise, 30 languages. About 806 MB, 1 to 1.6 GB of RAM while running; 16 GB of RAM recommended.

1. Download: https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2
2. Extract it; you get a folder named `sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25`.
3. Put the whole folder into `models\asr-models`.
4. Under Settings → Audio → Listen, click "Placed, check again", then switch the final tier to "High accuracy".

### 5.3 Models downloaded inside the app

Click "Download" on the settings pages. Downloads are blocked in offline mode.

- **OCR language packs** (Settings → OCR): Korean, Cyrillic, Devanagari, Arabic, Tamil, Telugu, Kannada; one pack covers every language written in that script. Plus the high-accuracy model, about 95 MB.
- **Listen recognition models** (Settings → Audio → Listen): the base recognition model, about 153 MB, required; the draft engine, about 168 MB, optional.
- **Neural voice packs** (Settings → Audio → Speak → Voice packs): Kokoro (103 Chinese and English voices) and MeloTTS (one female voice that reads mixed Chinese and English most naturally).

If a download fails inside the app, fetch the archive from the release page by hand:

- OCR language packs: https://github.com/Tianao0110/T-Translate/releases/tag/ocr-models
- Listen models and voice packs: https://github.com/Tianao0110/T-Translate/releases/tag/audio-models

Extract the archive into a folder, put it into the matching subfolder (`ocr-models`, `asr-models` or `tts-models`), and click "Refresh" on the settings page.

### 5.4 Local model servers

Besides the built-in model, the app can use LM Studio or Ollama running on this computer: install the software, load a model, and enable the matching source under Settings → Providers. The address is prefilled; change it only if you use a different port. Vision models (the LLM Vision engine) use the same address.

## 6. All shortcuts

### 6.1 Global

Work in any program; change them under Settings → Appearance → Shortcuts:

- **Alt+Q**: screenshot translate
- **Ctrl+Shift+W**: show / hide the main window
- **Ctrl+Alt+G**: open / close the floating window
- **Ctrl+Shift+T**: turn select-to-translate on or off
- **Ctrl+Alt+Space**: make the floating window capture again

### 6.2 Main window

- **Ctrl+1 to Ctrl+5**: switch to Translate, History, Favorites, Settings, Documents
- **Ctrl+Enter**: translate the text in the source box
- **Ctrl+F**: search on the History, Favorites and Documents pages
- **Ctrl+,**: open Settings
- **F11**: full screen on / off
- **Ctrl+Q**: quit

### 6.3 Floating window

- **Space**: capture once; with a result showing, press again to clear
- **Esc**: close the window. If click-through is on it exits that first; if the history panel is open it closes that; if scattered panes are showing it clears them
- **Hold Alt**: temporary click-through; clicks reach the program underneath, release to restore
- **Ctrl+H**: open / close recent translations
- **Double-click a scattered pane**: turn it into its own small window

### 6.4 Selection

- **CapsLock**: with "CapsLock Direct Mode" on under Settings → Selection, selecting text pops the translation up directly while the CapsLock light is on. Turn the light off for the normal flow.

## 7. Where your data lives, and backups

### 7.1 Two folders

Everything the app owns sits in two folders under the install folder; their locations are shown under Settings → About → Storage, with buttons to open them:

- `data`: settings, history, favorites, translation cache, logs, auto-saved captions.
- `models`: downloaded and hand-placed models, see chapter 5.

If the install folder is not writable (for example under Program Files), the app uses the user profile folder instead, and the About page says so.

The common items in `data`:

- `config.json`: all settings. API keys are in there too, but encrypted; there is no plain text to read.
- `translation-data.enc`: history, favorites and statistics, encrypted.
- `cache\`: the translation cache, safe to clear at any time.
- `logs\`: logs, for troubleshooting.
- `listen\`: captions auto-saved by listen mode.

### 7.2 Backup and moving

- **Uninstalling and upgrading keep your data**: both folders are preserved and picked up again after a reinstall.
- **Moving to another computer**: do not copy the `data` folder. History and API keys are encrypted with this computer's system key and cannot be opened elsewhere. Use the three exports instead:
- Settings → Privacy → Migration: "Export Migration Pack" writes a JSON file with settings, glossary, favorites and custom languages; "Import Migration Pack" on the new computer. API keys are not included and must be entered again.
- "Export" on the History page writes history to JSON; "Import" on the new computer.
- "Export Terms" on the Favorites page backs up the glossary on its own.
- **Models**: the `models` folder can be copied as a whole to the same location on the new computer to skip the downloads.
- **Reinstalling Windows on the same computer**: besides the exports above, you can also back up `data` and `models` as a whole; whether the encrypted parts open afterwards depends on the system key surviving, so the exported files are the reliable backup.

### 7.3 Cleaning up

- Settings → Privacy → Data management clears history, the cache, or all data.
- Settings → About resets all settings (API keys are kept) and cleans up folders left by older versions.
- Models you no longer need: click "Uninstall" on the matching settings page; hand-placed files can simply be deleted from the folder.

## 8. FAQ

Only how-to questions. For errors and connection problems, see the [FAQ on GitHub](https://github.com/Tianao0110/T-Translate/blob/main/docs/FAQ.md).

**How do I use it fully offline?**
Put the built-in model into the models folder (chapter 5), use a local OCR engine, then switch to "Offline" under Settings → Privacy. Translation, screenshot OCR, listen mode and read-aloud then all run on this computer.

**Which features need the internet?**
Google Translate and the other online sources, online OCR, the external speech service, model downloads, and checking for updates. Nothing else.

**What is the difference between the built-in model and LM Studio / Ollama?**
The built-in model is loaded by the app itself, with no other software. LM Studio and Ollama are servers you run yourself that the app connects to. The built-in model is the easy path; use LM Studio or Ollama when you want a bigger model.

**Why is there no "Summarize" button?**
Either the text is not long enough (the threshold is under Settings → AI Actions), or the current source cannot chat (any card marked "No AI actions").

**How do I make a word always translate my way?**
Save it into the glossary (Favorites → Glossary). Later, when a translation still contains the original word, it is replaced with your rendering; when the model translated it another way, the main window shows a hint under the translation that you can apply with one click.

**The floating window covers what I want to click.**
Click the click-through button and clicks on the content area go to the program underneath; hold Alt for a moment of it.

**Which mode for video subtitles?**
Subtitles on screen: lay the floating window over the subtitle area and turn on auto refresh. Sound without subtitles: use listen mode in the floating window.

**I want screenshot results in the main window.**
Settings → Selection → Screenshot output, choose "Main Window".

**Should I turn on GPU acceleration?**
With a discrete graphics card, yes: Settings → About → GPU acceleration. Each engine self-tests and stays on the CPU if it cannot use the GPU; nothing breaks.

**A shortcut clashes with another program.**
Settings → Appearance → Shortcuts, click the entry and press a new combination.

**Are my API keys safe?**
Keys are stored encrypted on this computer, never enter the migration pack, and are never sent to us. In offline mode they are not even decrypted.

**How do I take everything to another computer?**
See 7.2: export the migration pack, export history, copy the models folder. Do not copy the data folder.