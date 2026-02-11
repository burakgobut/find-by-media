/**
 * embedder.js - CLIP image embedding via Transformers.js
 * Semantic similarity using vision transformer
 */

const Embedder = {

    _pipeline: null,
    _loading: false,
    _ready: false,
    _RawImage: null,
    _pipelineFn: null,
    _env: null,

    EMBEDDING_DIM: 512,

    /**
     * Initialize the CLIP pipeline (lazy - called on first use)
     * Model downloads on first run (~87MB), cached afterwards
     */
    async init(cacheDir) {
        if (Embedder._ready) return true;
        if (Embedder._loading) {
            // Wait for existing init to complete
            while (Embedder._loading) {
                await new Promise(r => setTimeout(r, 200));
            }
            return Embedder._ready;
        }

        Embedder._loading = true;
        console.log('Embedder: Initializing CLIP model...');

        try {
            // Dynamic import for ESM module
            const transformers = await import('@huggingface/transformers');
            Embedder._pipelineFn = transformers.pipeline;
            Embedder._RawImage = transformers.RawImage;
            Embedder._env = transformers.env;

            // Configure cache directory
            if (cacheDir) {
                Embedder._env.cacheDir = cacheDir;
            }

            // Use WASM backend (works in Electron renderer)
            Embedder._env.backends.onnx.wasm.numThreads = 1;

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
            console.error('Embedder: Failed to initialize:', e.message);
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
     * Compute CLIP embedding for an image file
     * Returns Float32Array of 512 dimensions
     */
    async computeEmbedding(filePath) {
        if (!Embedder._ready) {
            throw new Error('Embedder not initialized');
        }

        // Load image using RawImage (supports file paths)
        const fileUrl = Hasher.filePathToURL(filePath);
        const image = await Embedder._RawImage.read(fileUrl);

        // Get embedding
        const output = await Embedder._pipeline(image, { pooling: 'mean', normalize: true });

        // Extract the embedding vector
        const embedding = Array.from(output.data).slice(0, Embedder.EMBEDDING_DIM);
        return embedding;
    },

    /**
     * Cosine similarity between two embedding vectors (already normalized = dot product)
     */
    cosineSimilarity(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
        }
        // Clamp to [-1, 1] (floating point errors)
        return Math.max(-1, Math.min(1, dot));
    }
};

window.Embedder = Embedder;
