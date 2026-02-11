# Find by Media — Development Log

Project development report covering architecture decisions, tools used, challenges faced, and solutions implemented.

## Project Overview

**Goal**: Build a visual similarity search plugin for Eagle content manager that works like Samsung Gallery / Google Lens — select an image and instantly see similar images from the library.

**Developer**: burakgobut
**AI Assistant**: Claude (Anthropic) via Claude Code CLI
**Timeline**: v1.0.0 (pixel-level) + v1.1.0 (neural search)
**Library Size**: ~14,909 image files across ~29,211 total assets

---

## Phase 1: v1.0.0 — Pixel-Level Similarity

### Goal
Get a working similarity search using perceptual hashing and color analysis. No AI, no external APIs, pure local processing.

### Architecture Decisions

| Decision | Reasoning |
|----------|-----------|
| Inspector plugin (not window/toolbar) | Appears in Eagle's right panel per-file, perfect for "show similar" |
| Canvas-based image processing | Zero native addon risk, no Electron ABI issues |
| blockhash-core (not sharp) | Pure JS perceptual hash, works in any Electron version |
| 500ms polling for selection | Eagle has no `onSelectionChanged` event, polling is the only option |
| JSON cache per library | Simple, readable, ~5MB for 15k items, fast enough |
| pHash 60% + Color 40% weights | Structure similarity primary, color complementary |

### Technical Challenges Solved

#### 1. Global Scope Conflict
**Problem**: Both `cache.js` and `main.js` declared `const nodePath = require('path')`. Eagle loads all scripts via `<script>` tags sharing one global scope.
**Error**: `Uncaught SyntaxError: Identifier 'nodePath' has already been declared`
**Solution**: Removed duplicate declaration from `main.js`, added comment referencing `cache.js`.

#### 2. Slider Flicker on Selection Change
**Problem**: Eagle reloads the entire HTML for each selection. Hardcoded slider values flash briefly (defaults) before JavaScript sets saved values from localStorage.
**Solution**: CSS `visibility: hidden` on `#controls` + inline `<script>` before other scripts that reads localStorage and sets values, then reveals controls.

#### 3. Eagle Plugin Quirks
- No `onSelectionChanged` event — must poll `eagle.item.getSelected()` at 500ms
- HTML reloads on every selection change
- `devTools: true` in manifest.json essential for debugging
- Inspector height limited, must be compact UI

### Tools & Libraries Used
- **blockhash-core**: bmvbhash() for perceptual hashing (256-bit)
- **Canvas API**: Image loading (32x32 for pHash, 64x64 for histogram)
- **Node.js fs/path**: Cache file I/O
- **localStorage**: UI settings persistence across reloads

### Files Created
- `manifest.json` — Plugin configuration
- `package.json` — Dependencies
- `index.html` — UI with inline settings loader
- `css/style.css` — Theme-aware responsive styles
- `js/hasher.js` — pHash + color histogram computation
- `js/similarity.js` — Hamming distance + cosine similarity + combined scoring
- `js/cache.js` — JSON file cache management
- `js/indexer.js` — Chunked async library indexer
- `js/ui.js` — Grid rendering, preview, progress
- `js/main.js` — Orchestrator, Eagle API, polling

### Result
Working pixel-level similarity search. Finds near-duplicates and color-similar images effectively. Tagged as `v1.0.0` and pushed to GitHub.

---

## Phase 2: v1.1.0 — Neural Similarity Search

### Goal
Add semantic understanding — "cat finds cats", "beach finds beaches" — not just pixel-level matching.

### The CLIP Journey (Failed Attempts)

We tried 5 different approaches to get CLIP (Xenova/clip-vit-base-patch32) working in Eagle's Electron:

#### Attempt 1: `import('@xenova/transformers')`
**Error**: `Failed to resolve module specifier '@xenova/transformers'`
**Reason**: Bare ESM specifiers not supported in Chromium renderer.

#### Attempt 2: `require.resolve()` + `file://` URL + `import()` of `src/transformers.js`
**Error**: `Failed to resolve module specifier '@huggingface/jinja'`
**Reason**: Internal ESM dependency chain broken in renderer context.

#### Attempt 3: `require()` of `dist/transformers.min.js`
**Error**: `require() of ES Module not supported`
**Reason**: The dist bundle has `"type": "module"` in its package.json.

#### Attempt 4: `new Function('u', 'return import(u)')` with `file://` URL of dist bundle
**Result**: Module loaded! Model config downloaded from HuggingFace!
**Error**: `Cannot read properties of undefined (reading 'create')` at ONNX InferenceSession
**Reason**: ONNX WASM backend can't initialize in Eagle's Chromium 107. Likely SharedArrayBuffer or WASM loading restrictions with `file://` protocol.

#### Attempt 5: Added wasmPaths, localModelPath, cacheDir, numThreads=1
**Error**: Same ONNX "create" error.
**Conclusion**: ONNX WASM backend is fundamentally incompatible with Eagle's Chromium 107 + file:// protocol.

### The Solution: WebGL Backend

**Key Insight**: ONNX Runtime Web has a **WebGL backend** that bypasses WASM entirely. Chromium 107 supports WebGL 2.0. No SharedArrayBuffer needed, no WASM files needed.

**Constraint**: CLIP's Vision Transformer uses `LayerNormalization`, `Erf`, and `Gelu` ops — NOT present in onnxruntime-web 1.14.0's WebGL op set.

**Alternative**: MobileNet V2 uses only `Conv`, `BatchNorm`, `Clip/Relu6`, `GlobalAveragePool`, `Reshape`, `Add` — ALL present in the WebGL op set.

### Architecture Decisions

| Decision | Reasoning |
|----------|-----------|
| WebGL backend (not WASM) | WASM fails in Eagle, WebGL works in Chromium 107 |
| MobileNet V2 (not CLIP) | CLIP's ops not in WebGL backend; MobileNet fully supported |
| onnxruntime-web (not TensorFlow.js) | Already installed as transitive dep, lighter, ONNX ecosystem |
| 1000-dim logit embeddings | Full classification output; similar images produce similar logit distributions |
| Script tag injection for ORT | Load `ort.webgl.min.js` dynamically; if fails, graceful fallback to pHash |
| Ship model in `models/` dir | No network dependency, no first-run download wait |

### Technical Challenges Solved

#### 1. require.resolve Path Mismatch
**Problem**: `require.resolve('onnxruntime-web')` returns `dist/ort-web.node.js`, not `lib/index.js`. Our regex to find the package root failed, producing double-path: `.../dist/ort-web.node.js/dist/ort.webgl.min.js`.
**Solution**: Changed regex to `/(\/onnxruntime-web\/).*$/` which strips everything after the package name.

#### 2. Image Preprocessing for MobileNet V2
**Details**: Canvas loads RGBA uint8 pixels. MobileNet expects [1, 3, 224, 224] CHW float32 tensor with ImageNet normalization (mean=[0.485,0.456,0.406], std=[0.229,0.224,0.225]).
**Solution**: Custom `_preprocessImage()` that reuses Hasher's `filePathToURL()` pattern, resizes to 224x224 via Canvas, converts RGBA to CHW float32 with normalization.

#### 3. Cache Version Migration
**Problem**: Old cache has 512-dim CLIP embeddings (null/empty). New embeddings are 1000-dim MobileNet.
**Solution**: Bumped `CACHE_VERSION` from 2 to 3. Cache auto-resets on version mismatch, forces clean re-index.

### Tools & Libraries Used
- **onnxruntime-web 1.14.0**: ONNX Runtime with WebGL backend
- **mobilenetv2-7.onnx**: MobileNet V2 ONNX model (~14MB, opset 7)
- **Canvas API**: Image preprocessing (224x224, CHW conversion, normalization)
- **WebGL 2.0**: GPU-accelerated neural inference in Chromium 107

### Files Modified
- `js/embedder.js` — Full rewrite: ORT WebGL + MobileNet V2
- `js/cache.js` — Cache version 2 to 3
- `js/indexer.js` — Chunk size tuning, proper Phase 2 chunking
- `js/main.js` — Status messages
- `package.json` — Removed @xenova/transformers, added onnxruntime-web direct

### Result
Working neural similarity search. Finds semantically similar images:
- Cars find other cars
- Round objects find round objects
- Landscapes find similar landscapes
- Color matching is generally consistent

Limitation: Human face matching is weak — MobileNet V2 is a general classifier, not a face recognition model. Future improvement: add face-api.js for face-specific matching.

---

## Development Tools & Workflow

### AI-Assisted Development
- **Claude Code CLI**: Primary development tool for all coding, debugging, research
- **Plan Mode**: Used for architectural decisions before major changes
- **Security Audits**: Automated checks before every push (API keys, PII, XSS, injection)

### Git Workflow
- **Private repo**: github.com/burakgobut/find-by-media
- **Version tags**: v1.0.0, v1.1.0
- **Pre-push security**: Check for secrets, credentials, sensitive data before every push
- **Commit messages**: Descriptive, focused on "why" not "what"

### Key Learnings
1. Eagle's Chromium 107 is a constrained environment — many modern JS features don't work
2. WASM in Electron with file:// protocol is unreliable
3. WebGL is a viable alternative to WASM for neural inference
4. `require.resolve()` path handling varies between Node versions
5. Script tag injection is safer than `import()` for loading browser bundles in Electron
6. Always test feasibility before committing to an approach (10-minute test pattern)

---

## Future Roadmap

- **Face Recognition**: face-api.js for person-specific matching
- **CLIP via TensorFlow.js**: If future ORT versions add LayerNormalization to WebGL
- **Binary cache format**: MessagePack or raw binary for faster I/O with large libraries
- **Batch embedding**: Process multiple images per GPU call for faster Phase 2
- **Drag & drop search**: External image similarity search (partially implemented)
