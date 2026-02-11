/**
 * embedder.js - CLIP image embedding via Transformers.js
 * Semantic similarity using vision transformer
 *
 * IMPORTANT: This module uses dynamic import() for ESM compatibility.
 * All imports happen lazily inside init() with full error handling.
 * If the module fails to load, the plugin continues with pHash only.
 */

const Embedder = {

    _pipeline: null,
    _loading: false,
    _ready: false,
    _RawImage: null,
    _pipelineFn: null,
    _env: null,
    _error: null,

    EMBEDDING_DIM: 512,

    /**
     * Initialize the CLIP pipeline (lazy - called on first use)
     * Model downloads on first run (~87MB), cached afterwards
     */
    async init(cacheDir) {
        if (Embedder._ready) return true;
        if (Embedder._loading) {
            while (Embedder._loading) {
                await new Promise(r => setTimeout(r, 200));
            }
            return Embedder._ready;
        }

        Embedder._loading = true;
        Embedder._error = null;
        console.log('Embedder: Initializing CLIP model...');

        try {
            // Dynamic import for ESM module - may fail in older Electron
            let transformers;
            try {
                transformers = await import('@huggingface/transformers');
            } catch (importErr) {
                // Try require as fallback
                try {
                    transformers = require('@huggingface/transformers');
                } catch (requireErr) {
                    throw new Error('Cannot load @huggingface/transformers: ' + importErr.message);
                }
            }

            Embedder._pipelineFn = transformers.pipeline;
            Embedder._RawImage = transformers.RawImage;
            Embedder._env = transformers.env;

            // Configure cache directory
            if (cacheDir) {
                Embedder._env.cacheDir = cacheDir;
            }

            // Use WASM backend (works in Electron renderer)
            if (Embedder._env.backends && Embedder._env.backends.onnx) {
                Embedder._env.backends.onnx.wasm.numThreads = 1;
            }

            // Load the model
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

    /**
     * Check if the model is ready
     */
    isReady() {
        return Embedder._ready;
    },

    /**
     * Get error message if init failed
     */
    getError() {
        return Embedder._error;
    },

    /**
     * Compute CLIP embedding for an image file
     * Returns Array of 512 floats
     */
    async computeEmbedding(filePath) {
        if (!Embedder._ready) {
            throw new Error('Embedder not initialized');
        }

        const fileUrl = Hasher.filePathToURL(filePath);
        const image = await Embedder._RawImage.read(fileUrl);
        const output = await Embedder._pipeline(image, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data).slice(0, Embedder.EMBEDDING_DIM);
        return embedding;
    }
};

window.Embedder = Embedder;
