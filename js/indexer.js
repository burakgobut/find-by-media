/**
 * indexer.js - Chunked async library indexing
 * Phase 1: pHash + color histogram (fast)
 * Phase 2: CLIP embeddings (slower, AI-based)
 */

const IMAGE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg',
    'tiff', 'tif', 'ico', 'avif'
]);

const Indexer = {

    CHUNK_SIZE: 10,
    CHUNK_DELAY: 30,
    EMBED_CHUNK_SIZE: 1,   // CLIP is heavy, one at a time
    EMBED_CHUNK_DELAY: 10,

    _isRunning: false,
    _shouldStop: false,
    _phase: null,  // 'phash' or 'clip'

    isImageType(ext) {
        if (!ext) return false;
        return IMAGE_EXTENSIONS.has(ext.toLowerCase());
    },

    getHashPath(item) {
        if (item.thumbnailPath) return item.thumbnailPath;
        if (item.filePath) return item.filePath;
        return null;
    },

    /**
     * Full indexing: Phase 1 (pHash) then Phase 2 (CLIP)
     */
    async indexLibrary(items, onProgress) {
        if (Indexer._isRunning) {
            console.log('Indexer: Already running');
            return;
        }

        Indexer._isRunning = true;
        Indexer._shouldStop = false;

        // Phase 1: pHash + color histogram
        Indexer._phase = 'phash';
        await Indexer._indexPhash(items, onProgress);

        // Phase 2: CLIP embeddings (only if model is ready or can be loaded)
        if (!Indexer._shouldStop) {
            Indexer._phase = 'clip';
            await Indexer._indexClip(items, onProgress);
        }

        Indexer._isRunning = false;
        Indexer._phase = null;
        console.log('Indexer: All phases complete');
    },

    /**
     * Phase 1: Index pHash + color histogram
     */
    async _indexPhash(items, onProgress) {
        const toIndex = items.filter(item => {
            if (!Indexer.isImageType(item.ext)) return false;
            return !Cache.hasValidHash(item.id);
        });

        const totalImages = items.filter(item => Indexer.isImageType(item.ext)).length;

        if (toIndex.length === 0) {
            console.log('Indexer: Phase 1 (pHash) - all indexed');
            return;
        }

        console.log(`Indexer: Phase 1 - ${toIndex.length} items need pHash`);

        const validIds = items.map(item => item.id);
        Cache.removeOrphans(validIds);

        let processed = 0;
        const alreadyCached = totalImages - toIndex.length;

        if (onProgress) onProgress(alreadyCached, totalImages, 'phash');

        for (let i = 0; i < toIndex.length; i += Indexer.CHUNK_SIZE) {
            if (Indexer._shouldStop) break;

            const chunk = toIndex.slice(i, i + Indexer.CHUNK_SIZE);
            await Promise.all(chunk.map(async (item) => {
                try {
                    const hashPath = Indexer.getHashPath(item);
                    if (!hashPath) return;
                    const hashes = await Hasher.computeHashes(hashPath);
                    Cache.setHash(item.id, {
                        pHash: hashes.pHash,
                        colorHistogram: hashes.colorHistogram,
                        ext: item.ext
                    });
                } catch (err) {}
            }));

            processed += chunk.length;
            if (onProgress) onProgress(alreadyCached + processed, totalImages, 'phash');
            await new Promise(r => setTimeout(r, Indexer.CHUNK_DELAY));
        }

        Cache.flush();
        console.log('Indexer: Phase 1 complete');
    },

    /**
     * Phase 2: Index CLIP embeddings
     */
    async _indexClip(items, onProgress) {
        // Check if CLIP is available
        if (!Embedder.isReady()) {
            console.log('Indexer: Phase 2 - CLIP model not loaded yet, skipping');
            return;
        }

        const toEmbed = items.filter(item => {
            if (!Indexer.isImageType(item.ext)) return false;
            const cached = Cache.getHash(item.id);
            return cached && !cached.embedding;
        });

        const totalImages = items.filter(item => Indexer.isImageType(item.ext)).length;

        if (toEmbed.length === 0) {
            console.log('Indexer: Phase 2 (CLIP) - all embedded');
            return;
        }

        console.log(`Indexer: Phase 2 - ${toEmbed.length} items need CLIP embedding`);

        let processed = 0;
        const alreadyEmbedded = totalImages - toEmbed.length;

        if (onProgress) onProgress(alreadyEmbedded, totalImages, 'clip');

        for (let i = 0; i < toEmbed.length; i += Indexer.EMBED_CHUNK_SIZE) {
            if (Indexer._shouldStop) break;

            const item = toEmbed[i];
            try {
                const hashPath = Indexer.getHashPath(item);
                if (!hashPath) continue;

                const embedding = await Embedder.computeEmbedding(hashPath);
                const existing = Cache.getHash(item.id) || {};
                Cache.setHash(item.id, {
                    ...existing,
                    embedding: embedding
                });
            } catch (err) {
                // Skip items that fail
            }

            processed++;
            if (onProgress) onProgress(alreadyEmbedded + processed, totalImages, 'clip');
            await new Promise(r => setTimeout(r, Indexer.EMBED_CHUNK_DELAY));
        }

        Cache.flush();
        console.log('Indexer: Phase 2 complete');
    },

    stop() {
        Indexer._shouldStop = true;
    },

    isRunning() {
        return Indexer._isRunning;
    },

    getPhase() {
        return Indexer._phase;
    }
};

window.Indexer = Indexer;
