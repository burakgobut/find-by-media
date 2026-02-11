/**
 * similarity.js - Combined similarity scoring
 * Supports: pHash, Color Histogram, CLIP Embedding, and hybrid modes
 */

const Similarity = {

    // Search modes
    MODE_PHASH: 'phash',           // pHash + color histogram (fast, pixel-level)
    MODE_CLIP: 'clip',             // CLIP embedding only (semantic, AI-based)
    MODE_HYBRID: 'hybrid',         // All three combined (best quality)

    // Weights for hybrid mode
    PHASH_WEIGHT: 0.25,
    COLOR_WEIGHT: 0.15,
    CLIP_WEIGHT: 0.60,

    MAX_HAMMING_BITS: 256,

    /**
     * Compute Hamming distance between two hex hash strings
     */
    hammingDistance(hash1, hash2) {
        if (!hash1 || !hash2 || hash1.length !== hash2.length) {
            return Similarity.MAX_HAMMING_BITS;
        }
        let distance = 0;
        for (let i = 0; i < hash1.length; i++) {
            const n1 = parseInt(hash1[i], 16);
            const n2 = parseInt(hash2[i], 16);
            let xor = n1 ^ n2;
            while (xor) {
                distance += xor & 1;
                xor >>= 1;
            }
        }
        return distance;
    },

    /**
     * pHash similarity score (0 to 1)
     */
    pHashScore(hash1, hash2) {
        const dist = Similarity.hammingDistance(hash1, hash2);
        return 1 - (dist / Similarity.MAX_HAMMING_BITS);
    },

    /**
     * Cosine similarity between two histogram vectors (0 to 1)
     */
    histogramSimilarity(hist1, hist2) {
        if (!hist1 || !hist2 || hist1.length !== hist2.length) return 0;
        let dot = 0, mag1 = 0, mag2 = 0;
        for (let i = 0; i < hist1.length; i++) {
            dot += hist1[i] * hist2[i];
            mag1 += hist1[i] * hist1[i];
            mag2 += hist2[i] * hist2[i];
        }
        mag1 = Math.sqrt(mag1);
        mag2 = Math.sqrt(mag2);
        if (mag1 === 0 || mag2 === 0) return 0;
        return dot / (mag1 * mag2);
    },

    /**
     * CLIP embedding similarity (cosine, already normalized = dot product)
     * Returns 0 to 1 (remapped from [-1,1] range)
     */
    clipSimilarity(emb1, emb2) {
        if (!emb1 || !emb2 || emb1.length !== emb2.length) return 0;
        let dot = 0;
        for (let i = 0; i < emb1.length; i++) {
            dot += emb1[i] * emb2[i];
        }
        // Remap from [-1, 1] to [0, 1]
        return (Math.max(-1, Math.min(1, dot)) + 1) / 2;
    },

    /**
     * Combined score based on search mode
     */
    combinedScore(queryData, candidateData, mode) {
        if (mode === Similarity.MODE_CLIP) {
            // CLIP only
            if (!queryData.embedding || !candidateData.embedding) return 0;
            return Similarity.clipSimilarity(queryData.embedding, candidateData.embedding);
        }

        if (mode === Similarity.MODE_PHASH) {
            // pHash + color only
            const pScore = Similarity.pHashScore(queryData.pHash, candidateData.pHash);
            const cScore = Similarity.histogramSimilarity(queryData.colorHistogram, candidateData.colorHistogram);
            return 0.6 * pScore + 0.4 * cScore;
        }

        // Hybrid mode: all three
        const pScore = (queryData.pHash && candidateData.pHash)
            ? Similarity.pHashScore(queryData.pHash, candidateData.pHash) : 0;
        const cScore = (queryData.colorHistogram && candidateData.colorHistogram)
            ? Similarity.histogramSimilarity(queryData.colorHistogram, candidateData.colorHistogram) : 0;
        const eScore = (queryData.embedding && candidateData.embedding)
            ? Similarity.clipSimilarity(queryData.embedding, candidateData.embedding) : 0;

        // If CLIP embedding is not available, fall back to pHash mode
        if (!queryData.embedding || !candidateData.embedding) {
            return 0.6 * pScore + 0.4 * cScore;
        }

        return Similarity.PHASH_WEIGHT * pScore +
               Similarity.COLOR_WEIGHT * cScore +
               Similarity.CLIP_WEIGHT * eScore;
    },

    /**
     * Find similar items from cache
     */
    findSimilar(queryData, cacheItems, threshold, maxResults, excludeId, mode) {
        const results = [];
        const thresholdNorm = threshold / 100;
        const searchMode = mode || Similarity.MODE_PHASH;

        const ids = Object.keys(cacheItems);
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            if (id === excludeId) continue;

            const candidate = cacheItems[id];
            if (!candidate) continue;

            // Skip items without required data for the mode
            if (searchMode === Similarity.MODE_CLIP && !candidate.embedding) continue;
            if (searchMode === Similarity.MODE_PHASH && !candidate.pHash) continue;

            const score = Similarity.combinedScore(queryData, candidate, searchMode);
            if (score >= thresholdNorm) {
                results.push({ id, score });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, maxResults);
    }
};

window.Similarity = Similarity;
