(function () {
    if (window.__REFLEKSI_AMBIENT_AUDIO_INIT__) {
        return;
    }
    window.__REFLEKSI_AMBIENT_AUDIO_INIT__ = true;

    const DEFAULT_PLAYLIST_ID = 'PLrAXtmRdnEQy6nuRPGh_C7pRFQWtxL5UI';
    const DEFAULT_VIDEO_ID = 'clXNZw73AAE';
    const STORAGE_KEY = 'refleksi-ambient-audio-state';
    const SOURCE_CONFIG_KEY = 'refleksi-ambient-audio-source-config';
    const PLAYBACK_SETTINGS_KEY = 'refleksi-ambient-audio-playback-settings';
    let player = null;
    let playerReady = false;
    let apiLoading = false;
    let pendingPlay = false;
    let trackListRenderToken = 0;
    let sourceConfig = getInitialSourceConfig();
    let playbackSettings = getInitialPlaybackSettings();
    const trackTitleCache = Object.create(null);
    const trackTitleRequests = Object.create(null);

    const host = document.createElement('div');
    host.id = 'ambient-audio-widget';
    host.innerHTML = `
        <div class="ambient-audio-main-row">
            <button type="button" class="ambient-audio-toggle" aria-pressed="false">▶ Putar Audio</button>
            <div class="ambient-audio-marquee" aria-label="Judul audio berjalan">
                <div class="ambient-audio-track">
                    <span class="ambient-audio-text">Memuat judul audio...</span>
                    <span class="ambient-audio-text" aria-hidden="true">Memuat judul audio...</span>
                </div>
            </div>
        </div>
        <div class="ambient-audio-controls" aria-label="Kontrol playlist">
            <select class="ambient-audio-track-list" aria-label="Daftar konten playlist">
                <option value="" selected>Memuat daftar konten...</option>
            </select>
            <button type="button" class="ambient-audio-mini-btn ambient-audio-shuffle" aria-pressed="false">Acak: Off</button>
            <button type="button" class="ambient-audio-mini-btn ambient-audio-repeat-all" aria-pressed="true">Ulangi Semua</button>
            <button type="button" class="ambient-audio-mini-btn ambient-audio-repeat-one" aria-pressed="false">Ulangi Satu</button>
        </div>
        <div id="ambient-audio-frame" class="ambient-audio-frame" aria-hidden="true"></div>
    `;

    const style = document.createElement('style');
    style.textContent = `
        #ambient-audio-widget {
            position: fixed;
            right: 18px;
            bottom: 18px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
            padding: 10px;
            border: 2px solid rgba(15, 23, 42, 0.18);
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.92);
            backdrop-filter: blur(10px);
            box-shadow: 0 14px 30px rgba(15, 23, 42, 0.18);
            color: #0f172a;
            width: min(460px, calc(100vw - 24px));
        }

        .ambient-audio-main-row {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .ambient-audio-toggle {
            border: 0;
            border-radius: 999px;
            padding: 10px 16px;
            background: linear-gradient(135deg, #0f172a, #1d4ed8);
            color: #ffffff;
            font: 600 0.95rem 'Space Grotesk', sans-serif;
            cursor: pointer;
            box-shadow: none;
            margin-top: 0;
            width: auto;
            min-width: 0;
        }

        .ambient-audio-toggle:hover {
            transform: translateY(-1px);
        }

        .ambient-audio-marquee {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            border-radius: 10px;
            border: 1px solid rgba(15, 23, 42, 0.2);
            background: rgba(255, 255, 255, 0.75);
            padding: 3px 0;
        }

        .ambient-audio-controls {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto auto auto;
            gap: 6px;
        }

        .ambient-audio-track-list {
            border: 1px solid rgba(15, 23, 42, 0.22);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.85);
            color: #0f172a;
            font: 600 0.75rem 'Space Grotesk', sans-serif;
            padding: 7px 8px;
            min-width: 0;
        }

        .ambient-audio-mini-btn {
            border: 1px solid rgba(15, 23, 42, 0.2);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.84);
            color: #0f172a;
            font: 700 0.68rem 'Courier New', monospace;
            letter-spacing: 0.02em;
            padding: 7px 9px;
            white-space: nowrap;
            cursor: pointer;
        }

        .ambient-audio-mini-btn.is-active {
            background: linear-gradient(135deg, #0f172a, #1d4ed8);
            color: #ffffff;
            border-color: transparent;
        }

        .ambient-audio-track {
            display: inline-flex;
            align-items: center;
            width: max-content;
            min-width: 100%;
            animation: ambient-marquee 13s steps(38, end) infinite;
        }

        .ambient-audio-text {
            flex: 0 0 auto;
            padding-right: 38px;
            font: 700 0.76rem 'Courier New', monospace;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #0f172a;
            text-shadow: 1px 1px 0 rgba(30, 64, 175, 0.25);
            white-space: nowrap;
        }

        @keyframes ambient-marquee {
            from { transform: translateX(0); }
            to { transform: translateX(-50%); }
        }

        .ambient-audio-frame {
            position: fixed;
            left: -9999px;
            top: -9999px;
            width: 1px;
            height: 1px;
            overflow: hidden;
        }

    `;

    document.head.appendChild(style);

    function getDefaultTitle() {
        return sourceConfig.mode === 'video' ? 'Video YouTube' : 'Playlist YouTube';
    }

    function normalizeSourceConfig(config) {
        const mode = config && config.mode === 'video' ? 'video' : 'playlist';
        const rawId = config && typeof config.id === 'string' ? config.id.trim() : '';
        const fallbackId = mode === 'video' ? DEFAULT_VIDEO_ID : DEFAULT_PLAYLIST_ID;

        return {
            mode: mode,
            id: rawId || fallbackId
        };
    }

    function readStoredSourceConfig() {
        try {
            const raw = localStorage.getItem(SOURCE_CONFIG_KEY);
            if (!raw) {
                return null;
            }
            return JSON.parse(raw);
        } catch (error) {
            return null;
        }
    }

    function saveSourceConfig(config) {
        localStorage.setItem(SOURCE_CONFIG_KEY, JSON.stringify(config));
    }

    function normalizePlaybackSettings(settings) {
        const repeatMode = settings && settings.repeatMode === 'one' ? 'one' : 'all';
        return {
            shuffle: !!(settings && settings.shuffle),
            repeatMode: repeatMode
        };
    }

    function readStoredPlaybackSettings() {
        try {
            const raw = localStorage.getItem(PLAYBACK_SETTINGS_KEY);
            if (!raw) {
                return null;
            }
            return JSON.parse(raw);
        } catch (error) {
            return null;
        }
    }

    function savePlaybackSettings(settings) {
        localStorage.setItem(PLAYBACK_SETTINGS_KEY, JSON.stringify(settings));
    }

    function getInitialPlaybackSettings() {
        const stored = readStoredPlaybackSettings();
        if (stored) {
            return normalizePlaybackSettings(stored);
        }
        return normalizePlaybackSettings(null);
    }

    function getInitialSourceConfig() {
        const fromWindow = window.__REFLEKSI_AMBIENT_AUDIO_CONFIG__;
        if (fromWindow && typeof fromWindow === 'object') {
            return normalizeSourceConfig(fromWindow);
        }

        const fromStorage = readStoredSourceConfig();
        if (fromStorage) {
            return normalizeSourceConfig(fromStorage);
        }

        return normalizeSourceConfig(null);
    }

    function updateMarqueeTitle(rawTitle) {
        const title = (rawTitle || '').trim() || getDefaultTitle();
        const decorated = 'Now Playing: ' + title + ' // ';
        const textNodes = host.querySelectorAll('.ambient-audio-text');
        textNodes.forEach(function (node) {
            node.textContent = decorated;
        });
    }

    function setPlayingState(isPlaying) {
        const button = host.querySelector('.ambient-audio-toggle');
        button.textContent = isPlaying ? '⏸ Jeda Audio' : '▶ Putar Audio';
        button.setAttribute('aria-pressed', String(isPlaying));
        localStorage.setItem(STORAGE_KEY, isPlaying ? 'playing' : 'paused');
    }

    function renderTrackListPlaceholder(message) {
        const trackSelect = host.querySelector('.ambient-audio-track-list');
        if (!trackSelect) {
            return;
        }

        trackListRenderToken += 1;

        trackSelect.innerHTML = '';
        const option = document.createElement('option');
        option.value = '';
        option.textContent = message;
        trackSelect.appendChild(option);
        trackSelect.value = '';
        trackSelect.disabled = true;
    }

    function buildTrackOptionLabel(index, videoId, title) {
        const safeTitle = (title || '').trim() || 'Memuat judul...';
        return String(index + 1) + '. ' + videoId + ' | ' + safeTitle;
    }

    function fetchVideoTitle(videoId) {
        if (!videoId) {
            return Promise.resolve('Judul tidak tersedia');
        }

        if (trackTitleCache[videoId]) {
            return Promise.resolve(trackTitleCache[videoId]);
        }

        if (trackTitleRequests[videoId]) {
            return trackTitleRequests[videoId];
        }

        const videoUrl = 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId);
        const oembedUrl = 'https://www.youtube.com/oembed?url=' + encodeURIComponent(videoUrl) + '&format=json';

        trackTitleRequests[videoId] = fetch(oembedUrl)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('oEmbed request failed');
                }
                return response.json();
            })
            .then(function (payload) {
                const title = payload && typeof payload.title === 'string' ? payload.title.trim() : '';
                trackTitleCache[videoId] = title || 'Judul tidak tersedia';
                return trackTitleCache[videoId];
            })
            .catch(function () {
                trackTitleCache[videoId] = 'Judul tidak tersedia';
                return trackTitleCache[videoId];
            })
            .finally(function () {
                delete trackTitleRequests[videoId];
            });

        return trackTitleRequests[videoId];
    }

    function updateTrackOptionTitle(renderToken, index, videoId, title) {
        if (renderToken !== trackListRenderToken) {
            return;
        }

        const trackSelect = host.querySelector('.ambient-audio-track-list');
        if (!trackSelect || !trackSelect.options || !trackSelect.options[index]) {
            return;
        }

        const option = trackSelect.options[index];
        if (option.dataset.videoId !== videoId) {
            return;
        }

        option.textContent = buildTrackOptionLabel(index, videoId, title);
    }

    function populateTrackListFromPlayer() {
        const trackSelect = host.querySelector('.ambient-audio-track-list');
        if (!trackSelect) {
            return;
        }

        trackListRenderToken += 1;
        const currentRenderToken = trackListRenderToken;

        if (!player || !playerReady) {
            renderTrackListPlaceholder('Memuat daftar konten...');
            return;
        }

        if (sourceConfig.mode === 'video') {
            trackSelect.innerHTML = '';
            const onlyOption = document.createElement('option');
            onlyOption.value = '0';
            onlyOption.dataset.videoId = sourceConfig.id;
            onlyOption.textContent = buildTrackOptionLabel(0, sourceConfig.id, trackTitleCache[sourceConfig.id]);
            trackSelect.appendChild(onlyOption);
            trackSelect.value = '0';
            trackSelect.disabled = true;

            if (!trackTitleCache[sourceConfig.id]) {
                fetchVideoTitle(sourceConfig.id).then(function (title) {
                    updateTrackOptionTitle(currentRenderToken, 0, sourceConfig.id, title);
                });
            }
            return;
        }

        const playlistIds = typeof player.getPlaylist === 'function' ? player.getPlaylist() : null;
        if (!playlistIds || !playlistIds.length) {
            renderTrackListPlaceholder('Konten playlist belum tersedia');
            return;
        }

        const activeIndex = typeof player.getPlaylistIndex === 'function' ? player.getPlaylistIndex() : 0;
        trackSelect.innerHTML = '';

        playlistIds.forEach(function (videoId, index) {
            const option = document.createElement('option');
            option.value = String(index);
            option.dataset.videoId = videoId;
            option.textContent = buildTrackOptionLabel(index, videoId, trackTitleCache[videoId]);
            trackSelect.appendChild(option);

            if (!trackTitleCache[videoId]) {
                fetchVideoTitle(videoId).then(function (title) {
                    updateTrackOptionTitle(currentRenderToken, index, videoId, title);
                });
            }
        });

        const safeIndex = activeIndex >= 0 && activeIndex < playlistIds.length ? activeIndex : 0;
        trackSelect.value = String(safeIndex);
        trackSelect.disabled = false;
    }

    function applyPlaybackSettingsToUi() {
        const shuffleButton = host.querySelector('.ambient-audio-shuffle');
        const repeatAllButton = host.querySelector('.ambient-audio-repeat-all');
        const repeatOneButton = host.querySelector('.ambient-audio-repeat-one');

        if (shuffleButton) {
            shuffleButton.textContent = playbackSettings.shuffle ? 'Acak: On' : 'Acak: Off';
            shuffleButton.setAttribute('aria-pressed', String(playbackSettings.shuffle));
            shuffleButton.classList.toggle('is-active', playbackSettings.shuffle);
        }

        if (repeatAllButton) {
            const activeAll = playbackSettings.repeatMode === 'all';
            repeatAllButton.setAttribute('aria-pressed', String(activeAll));
            repeatAllButton.classList.toggle('is-active', activeAll);
        }

        if (repeatOneButton) {
            const activeOne = playbackSettings.repeatMode === 'one';
            repeatOneButton.setAttribute('aria-pressed', String(activeOne));
            repeatOneButton.classList.toggle('is-active', activeOne);
        }
    }

    function applyPlaybackSettingsToPlayer() {
        if (!player || !playerReady) {
            return;
        }

        try {
            if (typeof player.setShuffle === 'function') {
                player.setShuffle(playbackSettings.shuffle);
            }

            if (typeof player.setLoop === 'function') {
                player.setLoop(playbackSettings.repeatMode === 'all');
            }
        } catch (error) {
            // ignore
        }
    }

    function setShuffle(enabled) {
        playbackSettings.shuffle = !!enabled;
        savePlaybackSettings(playbackSettings);
        applyPlaybackSettingsToUi();
        applyPlaybackSettingsToPlayer();
        populateTrackListFromPlayer();
    }

    function setRepeatMode(mode) {
        playbackSettings.repeatMode = mode === 'one' ? 'one' : 'all';
        savePlaybackSettings(playbackSettings);
        applyPlaybackSettingsToUi();
        applyPlaybackSettingsToPlayer();
    }

    function createPlayer() {
        if (player) {
            return player;
        }

        const basePlayerVars = {
            autoplay: 0,
            controls: 0,
            rel: 0,
            modestbranding: 1,
            loop: 1,
            playsinline: 1,
            iv_load_policy: 3,
            fs: 0,
            disablekb: 1
        };

        const playerOptions = {
            height: '1',
            width: '1',
            playerVars: basePlayerVars,
            events: {
                onReady: function () {
                    playerReady = true;
                    applyPlaybackSettingsToPlayer();
                    populateTrackListFromPlayer();
                    const videoData = player.getVideoData ? player.getVideoData() : null;
                    updateMarqueeTitle(videoData && videoData.title ? videoData.title : '');
                    const savedState = localStorage.getItem(STORAGE_KEY) || 'paused';
                    if (pendingPlay || savedState === 'playing') {
                        pendingPlay = false;
                        playAudio();
                    }
                },
                onStateChange: function (event) {
                    const videoData = player.getVideoData ? player.getVideoData() : null;
                    if (videoData && videoData.title) {
                        updateMarqueeTitle(videoData.title);
                    }
                    if (event.data === window.YT.PlayerState.PLAYING || event.data === window.YT.PlayerState.CUED) {
                        populateTrackListFromPlayer();
                    }
                    if (event.data === window.YT.PlayerState.PLAYING) {
                        setPlayingState(true);
                    } else if (event.data === window.YT.PlayerState.ENDED) {
                        if (playbackSettings.repeatMode === 'one' && player && playerReady) {
                            try {
                                player.seekTo(0, true);
                                player.playVideo();
                                return;
                            } catch (error) {
                                // ignore
                            }
                        }
                        setPlayingState(false);
                    } else if (event.data === window.YT.PlayerState.PAUSED) {
                        setPlayingState(false);
                    }
                }
            }
        };

        if (sourceConfig.mode === 'video') {
            playerOptions.videoId = sourceConfig.id;
            playerOptions.playerVars.playlist = sourceConfig.id;
        } else {
            playerOptions.playerVars.listType = 'playlist';
            playerOptions.playerVars.list = sourceConfig.id;
        }

        player = new window.YT.Player('ambient-audio-frame', playerOptions);

        return player;
    }

    function resetPlayer() {
        if (!player) {
            return;
        }

        try {
            player.destroy();
        } catch (error) {
            // ignore
        }

        player = null;
        playerReady = false;
    }

    function applySourceConfig(nextConfig) {
        const normalized = normalizeSourceConfig(nextConfig);
        const hasChanged = normalized.mode !== sourceConfig.mode || normalized.id !== sourceConfig.id;

        sourceConfig = normalized;
        saveSourceConfig(sourceConfig);
        renderTrackListPlaceholder('Memuat daftar konten...');

        if (!hasChanged) {
            return;
        }

        updateMarqueeTitle('');

        const shouldResume = localStorage.getItem(STORAGE_KEY) === 'playing';
        pendingPlay = shouldResume;
        resetPlayer();

        if (window.YT && window.YT.Player) {
            createPlayer();
            applyPlaybackSettingsToPlayer();
        } else if (shouldResume) {
            playAudio();
        }
    }

    function loadApi() {
        if (window.YT && window.YT.Player) {
            createPlayer();
            return;
        }

        if (apiLoading) {
            return;
        }

        apiLoading = true;
        const existing = document.querySelector('script[data-ambient-audio-api]');
        if (existing) {
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.dataset.ambientAudioApi = 'true';
        document.head.appendChild(script);

        window.onYouTubeIframeAPIReady = function () {
            createPlayer();
        };
    }

    function playAudio() {
        loadApi();
        if (!window.YT || !window.YT.Player) {
            pendingPlay = true;
            return;
        }

        if (!player) {
            createPlayer();
        }

        if (playerReady) {
            try {
                player.playVideo();
                setPlayingState(true);
            } catch (error) {
                pendingPlay = true;
            }
        } else {
            pendingPlay = true;
        }
    }

    function pauseAudio() {
        if (player && playerReady) {
            try {
                player.pauseVideo();
            } catch (error) {
                // ignore
            }
        }
        setPlayingState(false);
    }

    const button = host.querySelector('.ambient-audio-toggle');
    const trackSelect = host.querySelector('.ambient-audio-track-list');
    const shuffleButton = host.querySelector('.ambient-audio-shuffle');
    const repeatAllButton = host.querySelector('.ambient-audio-repeat-all');
    const repeatOneButton = host.querySelector('.ambient-audio-repeat-one');

    button.addEventListener('click', function () {
        const isPlaying = localStorage.getItem(STORAGE_KEY) === 'playing';
        if (isPlaying) {
            pauseAudio();
        } else {
            playAudio();
        }
    });

    trackSelect.addEventListener('change', function () {
        const selectedIndex = parseInt(trackSelect.value, 10);
        if (Number.isNaN(selectedIndex) || selectedIndex < 0) {
            return;
        }

        if (!player || !playerReady) {
            return;
        }

        if (sourceConfig.mode === 'video') {
            try {
                player.seekTo(0, true);
                player.playVideo();
            } catch (error) {
                // ignore
            }
            return;
        }

        try {
            if (typeof player.playVideoAt === 'function') {
                player.playVideoAt(selectedIndex);
            }
        } catch (error) {
            // ignore
        }
    });

    shuffleButton.addEventListener('click', function () {
        setShuffle(!playbackSettings.shuffle);
    });

    repeatAllButton.addEventListener('click', function () {
        setRepeatMode('all');
    });

    repeatOneButton.addEventListener('click', function () {
        setRepeatMode('one');
    });

    window.addEventListener('refleksi:ambient-audio-config-updated', function (event) {
        const config = event && event.detail ? event.detail : null;
        applySourceConfig(config);
    });

    function mountWidget() {
        if (!document.body.contains(host)) {
            document.body.appendChild(host);
        }

        renderTrackListPlaceholder('Memuat daftar konten...');
        applyPlaybackSettingsToUi();
        savePlaybackSettings(playbackSettings);
        updateMarqueeTitle('');
        saveSourceConfig(sourceConfig);

        const savedState = localStorage.getItem(STORAGE_KEY) || 'paused';
        setPlayingState(savedState === 'playing');
        if (savedState === 'playing') {
            playAudio();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountWidget);
    } else {
        mountWidget();
    }
})();
