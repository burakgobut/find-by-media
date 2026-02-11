/**
 * cache.js - Hash cache management
 * JSON file-backed persistent cache with incremental indexing
 */

const fs = require('fs');
const nodePath = require('path');

const Cache = {

    CACHE_VERSION: 3,
    SAVE_DEBOUNCE_MS: 3000,

    _data: null,
    _cacheDir: '',
    _cacheFile: '',
    _saveTimer: null,
    _dirty: false,

    /**
     * Initialize cache for a given library
     */
    init(pluginPath, libraryPath, libraryName) {
        Cache._cacheDir = nodePath.join(pluginPath, 'cache');
        const safeName = (libraryName || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
        Cache._cacheFile = nodePath.join(Cache._cacheDir, `${safeName}.json`);

        // Ensure cache directory exists
        try {
            if (!fs.existsSync(Cache._cacheDir)) {
                fs.mkdirSync(Cache._cacheDir, { recursive: true });
            }
        } catch (e) {
            console.warn('Cache: Failed to create cache dir:', e.message);
        }

        Cache._load(libraryPath);
    },

    /**
     * Load cache from disk
     */
    _load(libraryPath) {
        try {
            if (fs.existsSync(Cache._cacheFile)) {
                const raw = fs.readFileSync(Cache._cacheFile, 'utf-8');
                const parsed = JSON.parse(raw);

                if (parsed.version === Cache.CACHE_VERSION && parsed.libraryPath === libraryPath) {
                    Cache._data = parsed;
                    console.log(`Cache: Loaded ${Object.keys(Cache._data.items).length} items from disk`);
                    return;
                }
                console.log('Cache: Version mismatch or library changed, resetting');
            }
        } catch (e) {
            console.warn('Cache: Failed to load, starting fresh:', e.message);
        }

        Cache._data = {
            version: Cache.CACHE_VERSION,
            libraryPath: libraryPath,
            items: {}
        };
    },

    /**
     * Save cache to disk (debounced)
     */
    save(immediate) {
        Cache._dirty = true;

        if (immediate) {
            Cache._doSave();
            return;
        }

        if (!Cache._saveTimer) {
            Cache._saveTimer = setTimeout(() => {
                Cache._doSave();
            }, Cache.SAVE_DEBOUNCE_MS);
        }
    },

    _doSave() {
        if (Cache._saveTimer) {
            clearTimeout(Cache._saveTimer);
            Cache._saveTimer = null;
        }

        if (!Cache._dirty || !Cache._data) return;

        try {
            const json = JSON.stringify(Cache._data);
            fs.writeFileSync(Cache._cacheFile, json, 'utf-8');
            Cache._dirty = false;
            console.log(`Cache: Saved ${Object.keys(Cache._data.items).length} items to disk`);
        } catch (e) {
            console.warn('Cache: Failed to save:', e.message);
        }
    },

    /**
     * Get hash data for an item
     */
    getHash(itemId) {
        if (!Cache._data) return null;
        return Cache._data.items[itemId] || null;
    },

    /**
     * Check if an item has a valid cached hash (regardless of mtime)
     */
    hasValidHash(itemId) {
        if (!Cache._data) return false;
        const cached = Cache._data.items[itemId];
        if (!cached) return false;
        // Must have both hash components
        return !!(cached.pHash && cached.colorHistogram && cached.colorHistogram.length > 0);
    },

    /**
     * Store hash data for an item
     */
    setHash(itemId, hashData) {
        if (!Cache._data) return;
        Cache._data.items[itemId] = hashData;
        Cache.save();
    },

    /**
     * Get all cached items (the items map)
     */
    getAllItems() {
        if (!Cache._data) return {};
        return Cache._data.items;
    },

    /**
     * Remove orphaned entries (items no longer in library)
     */
    removeOrphans(validIds) {
        if (!Cache._data) return;
        const validSet = new Set(validIds);
        const cacheIds = Object.keys(Cache._data.items);
        let removed = 0;

        for (const id of cacheIds) {
            if (!validSet.has(id)) {
                delete Cache._data.items[id];
                removed++;
            }
        }

        if (removed > 0) {
            console.log(`Cache: Removed ${removed} orphaned entries`);
            Cache.save();
        }
    },

    /**
     * Get count of cached items
     */
    getCachedCount() {
        if (!Cache._data) return 0;
        return Object.keys(Cache._data.items).length;
    },

    /**
     * Clear entire cache
     */
    clear() {
        if (Cache._data) {
            Cache._data.items = {};
            Cache.save(true);
        }
    },

    /**
     * Flush any pending saves
     */
    flush() {
        Cache._doSave();
    }
};

window.Cache = Cache;
