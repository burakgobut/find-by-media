# Find by Media

Visual similarity search inspector plugin for [Eagle](https://eagle.cool) content manager.

Select any image in Eagle and instantly see visually similar images from your library — powered by perceptual hashing, color analysis, and neural network embeddings.

## Features

- **Automatic similarity search** — select an image, similar results appear instantly
- **Neural search (v1.1.0)** — MobileNet V2 via ONNX Runtime WebGL for semantic understanding
- **Hybrid scoring** — combines pHash (25%) + color histogram (15%) + neural embeddings (60%)
- **Pixel-level fallback** — works without AI using pHash + color histogram (60/40)
- **Adjustable controls** — result count slider, similarity threshold slider, auto-search toggle
- **Persistent cache** — indexes once, reuses on every session
- **Dark/light theme** — adapts to Eagle's theme automatically
- **Zero cloud dependency** — everything runs locally, no API keys needed

## How It Works

### v1.0.0 — Pixel-Level Similarity
- **pHash**: Perceptual hash via blockhash-core (256-bit, Hamming distance)
- **Color Histogram**: 4x4x4 RGB bins (64-dim), cosine similarity
- Combined score: 60% pHash + 40% color

### v1.1.0 — Neural Similarity (Current)
- **MobileNet V2**: 1000-dim embedding vectors via ONNX Runtime WebGL backend
- **WebGL GPU acceleration**: ~100-300ms per image inference
- **Hybrid mode**: 25% pHash + 15% color + 60% neural embedding
- Graceful fallback to pixel mode if neural model fails to load

## Installation

1. Download or clone this repository
2. Place the `find_by_media` folder in your Eagle plugins directory
3. Run `npm install` inside the folder
4. Download the MobileNet V2 model:
   ```
   mkdir models
   curl -L -o models/mobilenetv2-7.onnx https://github.com/onnx/models/raw/main/validated/vision/classification/mobilenet/model/mobilenetv2-7.onnx
   ```
5. Reload Eagle — the plugin appears in the inspector panel when you select an image

## Supported Formats

jpg, jpeg, png, gif, bmp, webp, svg, tiff, tif, ico

## Architecture

```
find_by_media/
├── manifest.json        # Eagle inspector plugin config
├── package.json         # Dependencies: onnxruntime-web, blockhash-core
├── index.html           # UI with inline settings loader
├── css/style.css        # Theme-aware responsive styles
├── js/
│   ├── hasher.js        # Canvas-based pHash + color histogram
│   ├── embedder.js      # ONNX Runtime WebGL + MobileNet V2 inference
│   ├── similarity.js    # Multi-mode scoring engine (phash/neural/hybrid)
│   ├── cache.js         # JSON file-backed persistent cache
│   ├── indexer.js       # 2-phase chunked async indexer
│   ├── ui.js            # Grid rendering, preview overlay, progress
│   └── main.js          # Orchestrator, Eagle API, polling, drag & drop
└── models/
    └── mobilenetv2-7.onnx  # ~14MB neural network model (not in git)
```

## Technical Details

- **Runtime**: Eagle's Electron (Chromium 107, Node 16)
- **Selection detection**: 500ms polling via `eagle.item.getSelected()` (no event API)
- **Indexing**: Phase 1 (pHash, chunks of 10) + Phase 2 (neural, chunks of 3)
- **Cache**: JSON file per library, auto-saves with 3s debounce
- **WebGL backend**: Avoids WASM/SharedArrayBuffer issues in Eagle's Chromium
- **No native addons**: Pure JS + WebGL, zero ABI compatibility risk

## Changelog

### v1.1.0 — Neural Similarity Search
- Added MobileNet V2 neural embeddings via ONNX Runtime WebGL
- Hybrid search mode: pHash + color + neural (25/15/60 weights)
- Replaced @xenova/transformers with direct onnxruntime-web (~200MB size reduction)
- Phase 2 indexing for neural embeddings (one-time, cached)
- Graceful fallback to pixel mode if model unavailable

### v1.0.0 — Initial Release
- Perceptual hash (pHash) via blockhash-core
- Color histogram similarity (4x4x4 RGB bins)
- Auto-search on selection, adjustable sliders
- Persistent JSON cache per library
- Dark/light theme support
- Preview overlay (click to view, double-click to navigate)

## License

Private project.
