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
    const PLAYBACK_SNAPSHOT_KEY = 'refleksi-ambient-audio-playback-snapshot';
    const SNAPSHOT_INTERVAL_MS = 15000;
    const RECOVERY_CHECK_INTERVAL_MS = 10000;
    const RECOVERY_BASE_DELAY_MS = 2000;
    const RECOVERY_MAX_DELAY_MS = 30000;
    let player = null;
    let playerReady = false;
    let apiLoading = false;
    let pendingPlay = false;
    let pendingRestoreSnapshot = null;
    let snapshotIntervalId = null;
    let recoveryIntervalId = null;
    let recoveryTimerId = null;
    let recoveryAttemptCount = 0;
    let watchdogPreviousTime = null;
    let watchdogStuckCount = 0;
    let trackListRenderToken = 0;
    let sourceConfig = getInitialSourceConfig();
    let playbackSettings = getInitialPlaybackSettings();
    const trackTitleCache = Object.create(null);
    const trackTitleRequests = Object.create(null);

    const host = document.createElement('div');
    host.id = 'ambient-audio-widget';
    host.innerHTML = `
        <div class="ambient-audio-topbar" aria-hidden="true">
            <div class="ambient-audio-topbar-brand">
                <span class="ambient-audio-topbar-title">RETRO AMBIENT DECK</span>
                <span class="ambient-audio-topbar-subtitle">Background audio console</span>
            </div>
            <div class="ambient-audio-topbar-status">
                <span class="ambient-audio-status-dot"></span>
                <span>ON AIR</span>
            </div>
        </div>
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
            --retro-bg: #17120d;
            --retro-panel: #221913;
            --retro-panel-soft: rgba(255, 229, 186, 0.08);
            --retro-border: #e6a43a;
            --retro-border-soft: rgba(230, 164, 58, 0.38);
            --retro-accent: #f4b23a;
            --retro-accent-2: #48d6c5;
            --retro-text: #f8f0db;
            --retro-muted: #d8c6a0;
            --retro-shadow: rgba(0, 0, 0, 0.45);
            position: fixed;
            right: 18px;
            bottom: 18px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
            padding: 12px;
            border: 3px solid var(--retro-border);
            border-radius: 18px;
            background:
                radial-gradient(circle at top left, rgba(244, 178, 58, 0.14), transparent 30%),
                radial-gradient(circle at bottom right, rgba(72, 214, 197, 0.1), transparent 28%),
                linear-gradient(145deg, #281c15, #17120d 65%, #120e0a);
            box-shadow:
                0 0 0 1px rgba(255, 255, 255, 0.04) inset,
                0 0 0 3px rgba(0, 0, 0, 0.35) inset,
                0 20px 48px var(--retro-shadow),
                0 0 24px rgba(244, 178, 58, 0.18);
            color: var(--retro-text);
            width: min(520px, calc(100vw - 24px));
            overflow: hidden;
            isolation: isolate;
            font-family: 'Courier New', 'Lucida Console', monospace;
        }

        #ambient-audio-widget::before {
            content: '';
            position: absolute;
            inset: 0;
            background: repeating-linear-gradient(
                180deg,
                rgba(255, 255, 255, 0.06) 0,
                rgba(255, 255, 255, 0.06) 1px,
                transparent 1px,
                transparent 4px
            );
            opacity: 0.14;
            pointer-events: none;
        }

        #ambient-audio-widget::after {
            content: '';
            position: absolute;
            inset: 8px;
            border: 1px solid rgba(255, 229, 186, 0.08);
            border-radius: 14px;
            pointer-events: none;
        }

        .ambient-audio-topbar {
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 2px 4px 0;
            text-transform: uppercase;
            letter-spacing: 0.16em;
        }

        .ambient-audio-topbar-brand {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
        }

        .ambient-audio-topbar-title {
            font: 900 0.84rem/1 'Courier New', monospace;
            color: var(--retro-accent);
            text-shadow: 0 0 10px rgba(244, 178, 58, 0.28);
            white-space: nowrap;
        }

        .ambient-audio-topbar-subtitle {
            font: 600 0.58rem/1.2 'Courier New', monospace;
            color: var(--retro-muted);
            letter-spacing: 0.22em;
            white-space: nowrap;
        }

        .ambient-audio-topbar-status {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            border: 1px solid var(--retro-border-soft);
            border-radius: 999px;
            background: rgba(0, 0, 0, 0.24);
            color: var(--retro-text);
            font: 700 0.62rem/1 'Courier New', monospace;
            letter-spacing: 0.18em;
            white-space: nowrap;
        }

        .ambient-audio-status-dot {
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: radial-gradient(circle, #7ef0d8 0, #2dd4bf 55%, #0f766e 100%);
            box-shadow:
                0 0 0 4px rgba(45, 212, 191, 0.12),
                0 0 14px rgba(45, 212, 191, 0.8);
            animation: ambient-led-pulse 2.2s ease-in-out infinite;
        }

        @keyframes ambient-led-pulse {
            0%, 100% { transform: scale(1); opacity: 0.85; }
            50% { transform: scale(1.16); opacity: 1; }
        }

        .ambient-audio-main-row {
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .ambient-audio-toggle {
            flex: 0 0 auto;
            border: 2px solid var(--retro-border);
            border-bottom-width: 4px;
            border-radius: 12px;
            padding: 12px 16px;
            background: linear-gradient(180deg, #ffcf77 0%, #f4b23a 45%, #c77a14 100%);
            color: #261700;
            font: 900 0.82rem/1 'Courier New', monospace;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            cursor: pointer;
            box-shadow:
                0 6px 0 #7d4d0f,
                0 16px 24px rgba(0, 0, 0, 0.34);
            margin-top: 0;
            width: auto;
            min-width: 140px;
        }

        .ambient-audio-toggle:hover {
            transform: translateY(-1px);
            filter: saturate(1.05);
        }

        .ambient-audio-toggle:active {
            transform: translateY(2px);
            box-shadow:
                0 3px 0 #7d4d0f,
                0 10px 18px rgba(0, 0, 0, 0.3);
        }

        .ambient-audio-toggle[aria-pressed='true'] {
            background: linear-gradient(180deg, #7ef0d8 0%, #48d6c5 45%, #0f766e 100%);
            color: #052b28;
            box-shadow:
                0 6px 0 #0b4f48,
                0 16px 24px rgba(0, 0, 0, 0.34);
        }

        .ambient-audio-marquee {
            position: relative;
            z-index: 1;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            border-radius: 12px;
            border: 2px solid rgba(230, 164, 58, 0.6);
            background: linear-gradient(180deg, rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.22));
            padding: 8px 0;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }

        .ambient-audio-marquee::before {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(90deg, transparent, rgba(72, 214, 197, 0.1), transparent);
            opacity: 0.42;
            pointer-events: none;
        }

        .ambient-audio-controls {
            position: relative;
            z-index: 1;
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto auto auto;
            gap: 8px;
            padding: 4px;
            border: 1px solid rgba(230, 164, 58, 0.22);
            border-radius: 14px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.16));
        }

        .ambient-audio-track-list {
            border: 1px solid rgba(230, 164, 58, 0.45);
            border-radius: 10px;
            background: linear-gradient(180deg, rgba(25, 18, 12, 0.98), rgba(15, 10, 8, 0.96));
            color: #f9eecf;
            font: 700 0.75rem 'Courier New', monospace;
            letter-spacing: 0.04em;
            padding: 9px 10px;
            min-width: 0;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }

        .ambient-audio-track-list option {
            background: #f9eecf;
            color: #17120d;
        }

        .ambient-audio-track-list option:checked,
        .ambient-audio-track-list option:hover {
            background: #f4b23a;
            color: #261700;
        }

        .ambient-audio-track-list:disabled {
            opacity: 0.75;
            color: #d8c6a0;
        }

        .ambient-audio-mini-btn {
            border: 1px solid rgba(230, 164, 58, 0.4);
            border-bottom-width: 3px;
            border-radius: 10px;
            background: linear-gradient(180deg, rgba(55, 40, 27, 0.98), rgba(31, 22, 15, 0.98));
            color: #f8f0db;
            font: 700 0.64rem/1 'Courier New', monospace;
            letter-spacing: 0.14em;
            padding: 8px 10px;
            text-transform: uppercase;
            white-space: nowrap;
            cursor: pointer;
            box-shadow: 0 4px 0 rgba(0, 0, 0, 0.38);
        }

        .ambient-audio-mini-btn:disabled {
            opacity: 0.45;
            cursor: not-allowed;
            color: #c7b58b;
            border-color: rgba(230, 164, 58, 0.16);
            box-shadow: none;
            transform: none;
        }

        .ambient-audio-mini-btn:hover {
            transform: translateY(-1px);
            border-color: rgba(72, 214, 197, 0.55);
            color: #7ef0d8;
        }

        .ambient-audio-mini-btn:active {
            transform: translateY(1px);
            box-shadow: 0 2px 0 rgba(0, 0, 0, 0.38);
        }

        .ambient-audio-mini-btn.is-active {
            background: linear-gradient(180deg, #f4b23a, #c77a14);
            color: #261700;
            border-color: transparent;
            box-shadow: 0 4px 0 #7d4d0f;
        }

        .ambient-audio-repeat-one.is-active {
            background: linear-gradient(180deg, #7ef0d8, #48d6c5);
            color: #052b28;
            box-shadow: 0 4px 0 #0b4f48;
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
            font: 700 0.76rem/1 'Courier New', monospace;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: #fff3cc;
            text-shadow: 0 0 8px rgba(244, 178, 58, 0.28), 1px 1px 0 rgba(0, 0, 0, 0.6);
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

        @media (max-width: 680px) {
            #ambient-audio-widget {
                left: 12px;
                right: 12px;
                bottom: 12px;
                width: auto;
                padding: 8px;
                border-radius: 16px;
                gap: 8px;
            }

            .ambient-audio-topbar {
                gap: 8px;
                padding: 1px 2px 0;
            }

            .ambient-audio-topbar-title {
                font-size: 0.72rem;
                letter-spacing: 0.12em;
            }

            .ambient-audio-topbar-subtitle {
                font-size: 0.5rem;
                letter-spacing: 0.18em;
            }

            .ambient-audio-topbar-status {
                padding: 5px 8px;
                font-size: 0.55rem;
                letter-spacing: 0.14em;
            }

            .ambient-audio-main-row {
                gap: 8px;
            }

            .ambient-audio-toggle {
                min-width: 112px;
                padding: 10px 12px;
                font-size: 0.72rem;
                letter-spacing: 0.12em;
            }

            .ambient-audio-controls {
                grid-template-columns: minmax(0, 1fr) auto auto auto;
                gap: 6px;
            }

            .ambient-audio-track-list {
                padding: 8px 9px;
                font-size: 0.68rem;
            }

            .ambient-audio-mini-btn {
                padding: 7px 8px;
                font-size: 0.58rem;
                letter-spacing: 0.12em;
            }

            .ambient-audio-text {
                font-size: 0.68rem;
                letter-spacing: 0.14em;
                padding-right: 30px;
            }
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
            shuffle: repeatMode === 'one' ? false : !!(settings && settings.shuffle),
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

    function readStoredPlaybackSnapshot() {
        try {
            const raw = localStorage.getItem(PLAYBACK_SNAPSHOT_KEY);
            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }

            return parsed;
        } catch (error) {
            return null;
        }
    }

    function persistPlaybackSnapshot() {
        if (!player || !playerReady) {
            return;
        }

        const playerState = typeof player.getPlayerState === 'function'
            ? player.getPlayerState()
            : -1;
        const isPlaying = playerState === window.YT.PlayerState.PLAYING;
        const currentTime = typeof player.getCurrentTime === 'function'
            ? Number(player.getCurrentTime()) || 0
            : 0;
        const playlistIndex = sourceConfig.mode === 'playlist' && typeof player.getPlaylistIndex === 'function'
            ? Number(player.getPlaylistIndex()) || 0
            : 0;

        const snapshot = {
            mode: sourceConfig.mode,
            sourceId: sourceConfig.id,
            currentTime: Math.max(0, currentTime),
            playlistIndex: Math.max(0, playlistIndex),
            isPlaying: isPlaying,
            updatedAt: Date.now()
        };

        try {
            localStorage.setItem(PLAYBACK_SNAPSHOT_KEY, JSON.stringify(snapshot));
        } catch (error) {
            // ignore
        }
    }

    function clearSnapshotInterval() {
        if (snapshotIntervalId) {
            window.clearInterval(snapshotIntervalId);
            snapshotIntervalId = null;
        }
    }

    function startSnapshotInterval() {
        clearSnapshotInterval();
        snapshotIntervalId = window.setInterval(function () {
            persistPlaybackSnapshot();
        }, SNAPSHOT_INTERVAL_MS);
    }

    function shouldMaintainPlayback() {
        return localStorage.getItem(STORAGE_KEY) === 'playing';
    }

    function clearRecoveryTimer() {
        if (recoveryTimerId) {
            window.clearTimeout(recoveryTimerId);
            recoveryTimerId = null;
        }
    }

    function resetRecoveryState() {
        clearRecoveryTimer();
        recoveryAttemptCount = 0;
    }

    function attemptPlaybackRecovery() {
        recoveryTimerId = null;

        if (!shouldMaintainPlayback()) {
            resetRecoveryState();
            return;
        }

        if (!player || !playerReady) {
            playAudio();
            return;
        }

        let currentState = -1;
        try {
            if (typeof player.getPlayerState === 'function') {
                currentState = player.getPlayerState();
            }
        } catch (error) {
            currentState = -1;
        }

        if (currentState === window.YT.PlayerState.PLAYING) {
            resetRecoveryState();
            return;
        }

        try {
            player.playVideo();
            recoveryAttemptCount += 1;
        } catch (error) {
            recoveryAttemptCount += 1;
        }

        const nextDelay = Math.min(
            RECOVERY_BASE_DELAY_MS * Math.max(1, recoveryAttemptCount),
            RECOVERY_MAX_DELAY_MS
        );

        clearRecoveryTimer();
        recoveryTimerId = window.setTimeout(function () {
            attemptPlaybackRecovery();
        }, nextDelay);
    }

    function schedulePlaybackRecovery(delayMs) {
        if (!shouldMaintainPlayback()) {
            resetRecoveryState();
            return;
        }

        clearRecoveryTimer();
        recoveryTimerId = window.setTimeout(function () {
            attemptPlaybackRecovery();
        }, Math.max(0, Number(delayMs) || 0));
    }

    function clearRecoveryInterval() {
        if (recoveryIntervalId) {
            window.clearInterval(recoveryIntervalId);
            recoveryIntervalId = null;
        }
    }

    function startRecoveryWatchdog() {
        clearRecoveryInterval();
        recoveryIntervalId = window.setInterval(function () {
            if (!player || !playerReady) {
                return;
            }

            if (!shouldMaintainPlayback()) {
                watchdogPreviousTime = null;
                watchdogStuckCount = 0;
                resetRecoveryState();
                return;
            }

            let state = -1;
            let currentTime = 0;

            try {
                state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
                currentTime = typeof player.getCurrentTime === 'function' ? Number(player.getCurrentTime()) || 0 : 0;
            } catch (error) {
                schedulePlaybackRecovery(RECOVERY_BASE_DELAY_MS);
                return;
            }

            if (state === window.YT.PlayerState.PLAYING) {
                if (watchdogPreviousTime !== null && Math.abs(currentTime - watchdogPreviousTime) < 0.1) {
                    watchdogStuckCount += 1;
                    if (watchdogStuckCount >= 2) {
                        schedulePlaybackRecovery(RECOVERY_BASE_DELAY_MS);
                    }
                } else {
                    watchdogStuckCount = 0;
                }

                watchdogPreviousTime = currentTime;
                resetRecoveryState();
                return;
            }

            watchdogPreviousTime = null;
            watchdogStuckCount = 0;

            if (state === window.YT.PlayerState.BUFFERING) {
                return;
            }

            schedulePlaybackRecovery(RECOVERY_BASE_DELAY_MS);
        }, RECOVERY_CHECK_INTERVAL_MS);
    }

    function getPlaylistIdsFromPlayer() {
        if (sourceConfig.mode === 'video') {
            return [sourceConfig.id];
        }

        if (!player || !playerReady || typeof player.getPlaylist !== 'function') {
            return [];
        }

        const playlistIds = player.getPlaylist();
        return Array.isArray(playlistIds) ? playlistIds : [];
    }

    function getCurrentPlaylistIndex() {
        if (sourceConfig.mode === 'video') {
            return 0;
        }

        if (!player || !playerReady || typeof player.getPlaylistIndex !== 'function') {
            return 0;
        }

        const currentIndex = Number(player.getPlaylistIndex());
        return Number.isFinite(currentIndex) && currentIndex >= 0 ? currentIndex : 0;
    }

    function getCurrentVideoId() {
        if (!player || !playerReady || typeof player.getVideoData !== 'function') {
            return '';
        }

        const videoData = player.getVideoData();
        return videoData && typeof videoData.video_id === 'string' ? videoData.video_id : '';
    }

    function restartCurrentTrack() {
        if (!player || !playerReady) {
            return false;
        }

        try {
            if (sourceConfig.mode === 'video') {
                if (typeof player.loadVideoById === 'function') {
                    player.loadVideoById(sourceConfig.id, 0);
                    return true;
                }

                if (typeof player.seekTo === 'function') {
                    player.seekTo(0, true);
                }
                player.playVideo();
                return true;
            }

            const currentVideoId = getCurrentVideoId();
            if (currentVideoId && typeof player.loadVideoById === 'function') {
                player.loadVideoById(currentVideoId, 0);
                return true;
            }

            const playlistIds = getPlaylistIdsFromPlayer();
            const currentIndex = getCurrentPlaylistIndex();

            if (playlistIds.length && typeof player.loadPlaylist === 'function') {
                player.loadPlaylist(playlistIds, currentIndex);
                return true;
            }

            if (typeof player.playVideoAt === 'function') {
                player.playVideoAt(currentIndex);
                return true;
            }
        } catch (error) {
            // ignore
        }

        return false;
    }

    function playNextTrack() {
        if (!player || !playerReady) {
            return false;
        }

        if (sourceConfig.mode === 'video') {
            return restartCurrentTrack();
        }

        const playlistIds = getPlaylistIdsFromPlayer();
        if (!playlistIds.length) {
            return restartCurrentTrack();
        }

        const currentIndex = getCurrentPlaylistIndex();
        const nextIndex = (currentIndex + 1) % playlistIds.length;

        try {
            if (typeof player.loadPlaylist === 'function') {
                player.loadPlaylist(playlistIds, nextIndex);
                return true;
            }

            if (typeof player.playVideoAt === 'function') {
                player.playVideoAt(nextIndex);
                return true;
            }
        } catch (error) {
            // ignore
        }

        return restartCurrentTrack();
    }

    function handleRepeatEnded() {
        if (playbackSettings.repeatMode === 'one') {
            return restartCurrentTrack();
        }

        return playNextTrack();
    }

    function applyRestoreSnapshot(snapshot) {
        if (!snapshot || !player || !playerReady) {
            return;
        }

        if (snapshot.mode !== sourceConfig.mode || snapshot.sourceId !== sourceConfig.id) {
            return;
        }

        const safeTime = Math.max(0, Number(snapshot.currentTime) || 0);
        const shouldPlay = !!snapshot.isPlaying;

        if (sourceConfig.mode === 'playlist') {
            const index = Math.max(0, Number(snapshot.playlistIndex) || 0);
            try {
                if (typeof player.playVideoAt === 'function') {
                    player.playVideoAt(index);
                }
            } catch (error) {
                // ignore
            }
        }

        try {
            player.seekTo(safeTime, true);
        } catch (error) {
            // ignore
        }

        if (shouldPlay) {
            playAudio();
        } else {
            pauseAudio();
        }
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

    function setPlayingState(isPlaying, options) {
        const persist = !options || options.persist !== false;
        const button = host.querySelector('.ambient-audio-toggle');
        button.textContent = isPlaying ? '⏸ Jeda Audio' : '▶ Putar Audio';
        button.setAttribute('aria-pressed', String(isPlaying));

        if (persist) {
            localStorage.setItem(STORAGE_KEY, isPlaying ? 'playing' : 'paused');
        }
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
        const shuffleAllowed = playbackSettings.repeatMode !== 'one';

        if (shuffleButton) {
            shuffleButton.textContent = playbackSettings.shuffle && shuffleAllowed ? 'Acak: On' : 'Acak: Off';
            shuffleButton.setAttribute('aria-pressed', String(playbackSettings.shuffle && shuffleAllowed));
            shuffleButton.classList.toggle('is-active', playbackSettings.shuffle && shuffleAllowed);
            shuffleButton.disabled = !shuffleAllowed;
            shuffleButton.setAttribute('aria-disabled', String(!shuffleAllowed));
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
                player.setShuffle(playbackSettings.repeatMode === 'one' ? false : playbackSettings.shuffle);
            }
        } catch (error) {
            // ignore
        }
    }

    function setShuffle(enabled) {
        playbackSettings.shuffle = playbackSettings.repeatMode === 'one' ? false : !!enabled;
        savePlaybackSettings(playbackSettings);
        applyPlaybackSettingsToUi();
        applyPlaybackSettingsToPlayer();
        populateTrackListFromPlayer();
    }

    function setRepeatMode(mode) {
        playbackSettings.repeatMode = mode === 'one' ? 'one' : 'all';
        if (playbackSettings.repeatMode === 'one') {
            playbackSettings.shuffle = false;
        }
        savePlaybackSettings(playbackSettings);
        applyPlaybackSettingsToUi();
        applyPlaybackSettingsToPlayer();
        populateTrackListFromPlayer();
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
            origin: window.location.origin,
            widget_referrer: window.location.href,
            playsinline: 1,
            iv_load_policy: 3,
            fs: 0,
            disablekb: 1
        };

        const playerOptions = {
            height: '1',
            width: '1',
            host: 'https://www.youtube-nocookie.com',
            playerVars: basePlayerVars,
            events: {
                onReady: function () {
                    playerReady = true;
                    startSnapshotInterval();
                    startRecoveryWatchdog();
                    applyPlaybackSettingsToPlayer();
                    populateTrackListFromPlayer();
                    const videoData = player.getVideoData ? player.getVideoData() : null;
                    updateMarqueeTitle(videoData && videoData.title ? videoData.title : '');
                    if (pendingRestoreSnapshot) {
                        applyRestoreSnapshot(pendingRestoreSnapshot);
                        pendingRestoreSnapshot = null;
                    }
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
                        persistPlaybackSnapshot();
                        resetRecoveryState();
                    } else if (event.data === window.YT.PlayerState.ENDED) {
                        persistPlaybackSnapshot();
                        if (handleRepeatEnded()) {
                            setPlayingState(true, { persist: false });
                            resetRecoveryState();
                            return;
                        }
                        if (shouldMaintainPlayback()) {
                            setPlayingState(true, { persist: false });
                            schedulePlaybackRecovery(RECOVERY_BASE_DELAY_MS);
                            return;
                        }
                        resetRecoveryState();
                        setPlayingState(false);
                    } else if (event.data === window.YT.PlayerState.PAUSED) {
                        persistPlaybackSnapshot();
                        if (shouldMaintainPlayback()) {
                            setPlayingState(true, { persist: false });
                            attemptPlaybackRecovery();
                        } else {
                            setPlayingState(false);
                        }
                    } else if (event.data === window.YT.PlayerState.CUED || event.data === window.YT.PlayerState.UNSTARTED) {
                        if (shouldMaintainPlayback()) {
                            setPlayingState(true, { persist: false });
                            schedulePlaybackRecovery(RECOVERY_BASE_DELAY_MS);
                        }
                    }
                }
            }
        };

        if (sourceConfig.mode === 'video') {
            playerOptions.videoId = sourceConfig.id;
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

        clearSnapshotInterval();
        clearRecoveryInterval();
        resetRecoveryState();
        watchdogPreviousTime = null;
        watchdogStuckCount = 0;

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
                schedulePlaybackRecovery(RECOVERY_BASE_DELAY_MS);
            } catch (error) {
                pendingPlay = true;
                schedulePlaybackRecovery(RECOVERY_BASE_DELAY_MS);
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
        pendingPlay = false;
        resetRecoveryState();
        setPlayingState(false);
        persistPlaybackSnapshot();
    }

    function isPlayerActuallyPlaying() {
        if (!player || !playerReady || typeof player.getPlayerState !== 'function') {
            return localStorage.getItem(STORAGE_KEY) === 'playing';
        }

        try {
            const state = player.getPlayerState();
            if (state === window.YT.PlayerState.PLAYING) {
                return true;
            }

            if (state === window.YT.PlayerState.BUFFERING) {
                return localStorage.getItem(STORAGE_KEY) === 'playing';
            }
        } catch (error) {
            return localStorage.getItem(STORAGE_KEY) === 'playing';
        }

        return false;
    }

    const button = host.querySelector('.ambient-audio-toggle');
    const trackSelect = host.querySelector('.ambient-audio-track-list');
    const shuffleButton = host.querySelector('.ambient-audio-shuffle');
    const repeatAllButton = host.querySelector('.ambient-audio-repeat-all');
    const repeatOneButton = host.querySelector('.ambient-audio-repeat-one');

    button.addEventListener('click', function () {
        if (isPlayerActuallyPlaying()) {
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
                restartCurrentTrack();
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

        const snapshot = readStoredPlaybackSnapshot();
        if (snapshot && snapshot.mode === sourceConfig.mode && snapshot.sourceId === sourceConfig.id) {
            pendingRestoreSnapshot = snapshot;
            if (snapshot.isPlaying) {
                pendingPlay = true;
            }
        }

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
