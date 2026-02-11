/**
 * embedder.js - CLIP image embedding via Transformers.js
 *
 * ESM module loading uses Function() constructor to create
 * dynamic import at runtime, avoiding parse-time errors in
 * Eagle's Electron renderer (Chromium 107).
 * If loading fails, plugin continues with pHash only.
 */

var Embedder = {

    _pipeline: null,
    _loading: false,
    _ready: false,
    _RawImage: null,
    _pipelineFn: null,
    _env: null,
    _error: null,

    EMBEDDING_DIM: 512,

    init: async function(cacheDir) {
        if (Embedder._ready) return true;
        if (Embedder._loading) {
            while (Embedder._loading) {
                await new Promise(function(r) { setTimeout(r, 200); });
            }
            return Embedder._ready;
        }

        Embedder._loading = true;
        Embedder._error = null;
        console.log('Embedder: Initializing CLIP model...');

        try {
            // Function constructor avoids parse-time error with import() keyword
            var loadESM = new Function('specifier', 'return import(specifier)');
            var transformers = await loadESM('@xenova/transformers');

            Embedder._pipelineFn = transformers.pipeline;
            Embedder._RawImage = transformers.RawImage;
            Embedder._env = transformers.env;

            if (cacheDir) {
                Embedder._env.cacheDir = cacheDir;
            }

            if (Embedder._env.backends && Embedder._env.backends.onnx) {
                Embedder._env.backends.onnx.wasm.numThreads = 1;
            }

            Embedder._pipeline = await Embedder._pipelineFn(
                'image-feature-extraction',
                'Xenova/clip-vit-base-patch32',
                { dtype: 'fp32' }
            );

            Embedder._ready = true;
            Embedder._loading = false;
            console.log('Embedder: CLIP model ready');
            return true;
        } catch (e) {
            console.warn('Embedder: Failed to initialize:', e.message);
            Embedder._error = e.message;
            Embedder._loading = false;
            return false;
        }
    },

    isReady: function() {
        return Embedder._ready;
    },

    getError: function() {
        return Embedder._error;
    },

    computeEmbedding: async function(filePath) {
        if (!Embedder._ready) {
            throw new Error('Embedder not initialized');
        }

        var fileUrl = Hasher.filePathToURL(filePath);
        var image = await Embedder._RawImage.read(fileUrl);
        var output = await Embedder._pipeline(image, { pooling: 'mean', normalize: true });
        return Array.from(output.data).slice(0, Embedder.EMBEDDING_DIM);
    }
};

window.Embedder = Embedder;
