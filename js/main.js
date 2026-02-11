/**
 * main.js - Entry point and orchestrator
 * Eagle API integration, selection polling, search coordination, drag & drop
 *
 * Search mode is automatic:
 * - CLIP not ready → pHash mode (pixel-level)
 * - CLIP ready → hybrid mode (AI + pixel)
 */

const nodePath = require('path');

const App = {

    // State
    pluginPath: '',
    libraryPath: '',
    libraryName: '',
    autoSearchEnabled: true,
    resultCount: 20,
    threshold: 70,
    lastSelectedId: null,
    lastSearchedId: null,
    allItems: [],
    isSearching: false,
    indexingDone: false,
    clipReady: false,
    _lastResults: null,

    POLL_INTERVAL: 500,

    /**
     * Get current search mode automatically
     */
    getSearchMode() {
        return App.clipReady ? 'hybrid' : 'phash';
    },

    async init(plugin) {
        App.pluginPath = plugin.path;
        App._loadSettings();

        // Theme
        try {
            const theme = await eagle.app.theme;
            UI.updateTheme(theme);
        } catch (e) {}
        eagle.onThemeChanged((theme) => UI.updateTheme(theme));

        // UI
        UI.initPreviewOverlay();
        App._initControls();
        App._initDropZone();

        // Library + cache
        try {
            const lib = await eagle.library.info();
            App.libraryPath = lib.path || '';
            App.libraryName = lib.name || 'default';
            Cache.init(App.pluginPath, App.libraryPath, App.libraryName);
        } catch (e) {
            Cache.init(App.pluginPath, '', 'default');
        }

        console.log(`App: Cache has ${Cache.getCachedCount()} items from disk`);

        // Get all library items
        try {
            App.allItems = await eagle.item.list({ limit: 999999 });
        } catch (e) {
            try { App.allItems = await eagle.item.getAll(); } catch (e2) { App.allItems = []; }
        }

        if (App.allItems && App.allItems.length > 0) {
            UI.setItemsMap(App.allItems);
            App._startIndexing();
        }

        // Start CLIP model loading in background (non-blocking, won't break anything)
        App._initClip();

        // Start polling
        App._pollSelection();
        UI.showEmptyState('Select an image to find similar items');
    },

    /**
     * Initialize CLIP model in background
     * If it fails, the plugin continues with pHash only
     */
    async _initClip() {
        const statusEl = document.getElementById('clip-status');
        const aiBadge = document.getElementById('ai-badge');

        try {
            // Show loading status
            statusEl.classList.remove('hidden');
            document.getElementById('clip-status-text').textContent = 'Loading AI model (first run only)...';

            const modelCacheDir = nodePath.join(App.pluginPath, 'models');
            const ok = await Embedder.init(modelCacheDir);

            if (ok) {
                App.clipReady = true;
                document.getElementById('clip-status-text').textContent = 'AI model ready ✓';
                statusEl.classList.add('ready');
                if (aiBadge) aiBadge.classList.remove('hidden');
                setTimeout(() => statusEl.classList.add('hidden'), 3000);

                // If phash indexing is done, start CLIP indexing
                if (App.indexingDone && App.allItems.length > 0) {
                    App._startClipIndexing();
                }

                // Re-search with AI if we already have results
                if (App.lastSelectedId && App._lastResults) {
                    const item = App.allItems.find(i => i.id === App.lastSelectedId);
                    if (item) {
                        App.lastSearchedId = null;
                        App.performSearch(item);
                    }
                }
            } else {
                const errMsg = Embedder.getError() || 'unknown error';
                console.warn('App: CLIP not available:', errMsg);
                document.getElementById('clip-status-text').textContent = 'AI not available (using pixel mode)';
                setTimeout(() => statusEl.classList.add('hidden'), 5000);
            }
        } catch (e) {
            console.warn('App: CLIP init error:', e.message);
            statusEl.classList.add('hidden');
        }
    },

    /**
     * Start CLIP embedding indexing (phase 2)
     */
    async _startClipIndexing() {
        if (!App.clipReady || Indexer.isRunning()) return;

        Indexer._isRunning = true;
        Indexer._shouldStop = false;
        Indexer._phase = 'clip';

        await Indexer._indexClip(App.allItems, (processed, total, phase) => {
            UI.showIndexingProgress(processed, total, phase);
        });

        Indexer._isRunning = false;
        Indexer._phase = null;
        UI.hideIndexingProgress();
    },

    /**
     * Start phase 1 indexing (pHash + color histogram)
     */
    async _startIndexing() {
        const totalImages = App.allItems.filter(item => Indexer.isImageType(item.ext)).length;
        const cachedCount = Cache.getCachedCount();

        if (cachedCount >= totalImages) {
            App.indexingDone = true;
            console.log('App: pHash fully indexed');
            if (App.autoSearchEnabled && App.lastSelectedId && !App.lastSearchedId) {
                const item = App.allItems.find(i => i.id === App.lastSelectedId);
                if (item) App.performSearch(item);
            }
            if (App.clipReady) App._startClipIndexing();
            return;
        }

        UI.showIndexingProgress(cachedCount, totalImages, 'phash');

        Indexer._isRunning = true;
        Indexer._shouldStop = false;
        Indexer._phase = 'phash';

        await Indexer._indexPhash(App.allItems, (processed, total, phase) => {
            UI.showIndexingProgress(processed, total, phase);
        });

        Indexer._isRunning = false;
        Indexer._phase = null;
        App.indexingDone = true;
        UI.hideIndexingProgress();

        if (App.autoSearchEnabled && App.lastSelectedId) {
            const item = App.allItems.find(i => i.id === App.lastSelectedId);
            if (item) App.performSearch(item);
        }

        if (App.clipReady) App._startClipIndexing();
    },

    async _pollSelection() {
        try {
            const selected = await eagle.item.getSelected();
            if (selected && selected.length === 1) {
                const item = selected[0];
                if (item.id !== App.lastSelectedId) {
                    App.lastSelectedId = item.id;
                    if (App.autoSearchEnabled) App.performSearch(item);
                }
            }
        } catch (e) {}
        setTimeout(() => App._pollSelection(), App.POLL_INTERVAL);
    },

    async performSearch(item) {
        if (App.isSearching) return;
        App.isSearching = true;
        UI.showLoading('Searching...');

        try {
            const hashPath = Indexer.getHashPath(item);
            if (!hashPath) {
                UI.showEmptyState('Cannot access image file');
                App.isSearching = false;
                UI.hideLoading();
                return;
            }

            const searchMode = App.getSearchMode();
            const queryData = {};

            // Always compute pHash (fast, needed for phash and hybrid)
            const hashes = await Hasher.computeHashes(hashPath);
            queryData.pHash = hashes.pHash;
            queryData.colorHistogram = hashes.colorHistogram;

            // Compute CLIP embedding if available (for hybrid mode)
            if (App.clipReady) {
                try {
                    queryData.embedding = await Embedder.computeEmbedding(hashPath);
                } catch (e) {
                    console.warn('App: CLIP embedding failed for query:', e.message);
                }
            }

            const cacheItems = Cache.getAllItems();
            const results = Similarity.findSimilar(
                queryData, cacheItems, App.threshold, App.resultCount, item.id, searchMode
            );

            App._lastResults = { queryData, excludeId: item.id, searchMode };
            App.lastSearchedId = item.id;
            UI.hideLoading();
            UI.renderResults(results);

        } catch (e) {
            console.warn('App: Search failed:', e.message);
            UI.hideLoading();
            UI.showEmptyState('Search failed: ' + e.message);
        }

        App.isSearching = false;
    },

    _refilterResults() {
        if (!App._lastResults) return;
        const { queryData, excludeId, searchMode } = App._lastResults;
        const mode = searchMode || App.getSearchMode();
        const cacheItems = Cache.getAllItems();
        const results = Similarity.findSimilar(
            queryData, cacheItems, App.threshold, App.resultCount, excludeId, mode
        );
        UI.renderResults(results);
    },

    _initControls() {
        // Auto-toggle
        const toggleBtn = document.getElementById('auto-toggle');
        toggleBtn.addEventListener('click', () => {
            App.autoSearchEnabled = !App.autoSearchEnabled;
            toggleBtn.textContent = App.autoSearchEnabled ? 'ON' : 'OFF';
            toggleBtn.classList.toggle('active', App.autoSearchEnabled);
            App._saveSettings();
            if (App.autoSearchEnabled && App.lastSelectedId) {
                const item = App.allItems.find(i => i.id === App.lastSelectedId);
                if (item) App.performSearch(item);
            }
        });
        toggleBtn.textContent = App.autoSearchEnabled ? 'ON' : 'OFF';
        toggleBtn.classList.toggle('active', App.autoSearchEnabled);

        // Result count
        const resultSlider = document.getElementById('result-count');
        const resultLabel = document.getElementById('result-count-label');
        resultSlider.value = App.resultCount;
        resultLabel.textContent = App.resultCount;
        resultSlider.addEventListener('input', () => {
            App.resultCount = parseInt(resultSlider.value);
            resultLabel.textContent = App.resultCount;
        });
        resultSlider.addEventListener('change', () => {
            App._saveSettings();
            App._refilterResults();
        });

        // Threshold
        const thresholdSlider = document.getElementById('threshold');
        const thresholdLabel = document.getElementById('threshold-label');
        thresholdSlider.value = App.threshold;
        thresholdLabel.textContent = App.threshold;
        thresholdSlider.addEventListener('input', () => {
            App.threshold = parseInt(thresholdSlider.value);
            thresholdLabel.textContent = App.threshold;
            App._refilterResults();
        });
        thresholdSlider.addEventListener('change', () => App._saveSettings());

        // Search button
        document.getElementById('search-btn').addEventListener('click', async () => {
            try {
                const selected = await eagle.item.getSelected();
                if (selected && selected.length >= 1) {
                    App.lastSearchedId = null;
                    App.performSearch(selected[0]);
                }
            } catch (e) {}
        });
    },

    _initDropZone() {
        const body = document.body;
        const dropZone = document.getElementById('drop-zone');
        let dragCounter = 0;

        body.addEventListener('dragenter', (e) => {
            e.preventDefault(); dragCounter++;
            dropZone.classList.remove('hidden');
            dropZone.classList.add('drag-over');
        });
        body.addEventListener('dragleave', (e) => {
            e.preventDefault(); dragCounter--;
            if (dragCounter <= 0) { dragCounter = 0; dropZone.classList.remove('drag-over'); dropZone.classList.add('hidden'); }
        });
        body.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        body.addEventListener('drop', async (e) => {
            e.preventDefault(); dragCounter = 0;
            dropZone.classList.remove('drag-over'); dropZone.classList.add('hidden');
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                const f = files[0];
                const isImg = (f.type && f.type.startsWith('image/')) || Indexer.isImageType(f.name.split('.').pop().toLowerCase());
                if (isImg) App._searchByExternalFile(f.path);
            }
        });
    },

    async _searchByExternalFile(filePath) {
        if (App.isSearching || !filePath) return;
        App.isSearching = true;
        UI.showLoading('Searching by dropped image...');
        try {
            const searchMode = App.getSearchMode();
            const queryData = {};

            const h = await Hasher.computeHashes(filePath);
            queryData.pHash = h.pHash;
            queryData.colorHistogram = h.colorHistogram;

            if (App.clipReady) {
                try { queryData.embedding = await Embedder.computeEmbedding(filePath); } catch (e) {}
            }

            const results = Similarity.findSimilar(queryData, Cache.getAllItems(), App.threshold, App.resultCount, null, searchMode);
            App._lastResults = { queryData, excludeId: null, searchMode };
            UI.hideLoading();
            UI.renderResults(results);
        } catch (e) {
            UI.hideLoading();
            UI.showEmptyState('Failed to process dropped image');
        }
        App.isSearching = false;
    },

    _saveSettings() {
        try {
            localStorage.setItem('fbm_settings', JSON.stringify({
                autoSearchEnabled: App.autoSearchEnabled,
                resultCount: App.resultCount,
                threshold: App.threshold
            }));
        } catch (e) {}
    },

    _loadSettings() {
        try {
            const s = JSON.parse(localStorage.getItem('fbm_settings') || '{}');
            if (typeof s.autoSearchEnabled === 'boolean') App.autoSearchEnabled = s.autoSearchEnabled;
            if (typeof s.resultCount === 'number') App.resultCount = s.resultCount;
            if (typeof s.threshold === 'number') App.threshold = s.threshold;
        } catch (e) {}
    }
};

// Lifecycle
eagle.onPluginCreate(async (plugin) => { console.log('Find by Media: init'); await App.init(plugin); });
eagle.onPluginRun(() => {});
eagle.onPluginShow(() => {});
eagle.onPluginHide(() => Cache.flush());
