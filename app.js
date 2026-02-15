/* ========================================
   YTLooper - Application Logic
   ======================================== */

(function () {
  'use strict';

  // ---- Constants ----
  const POLL_INTERVAL_MS = 100;
  const STORAGE_PREFIX = 'ytlooper_sections_';
  const DEFAULT_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  // ---- State ----
  let player = null;
  let apiReady = false;
  let pendingVideoId = null;
  let currentVideoId = null;
  let duration = 0;
  let pollInterval = null;
  let isPlaying = false;

  // AB Loop state
  let pointA = 0;
  let pointB = 0;
  let loopEnabled = false;

  // Section playlist state
  let sections = [];
  let activeSectionId = null;

  // Timeline drag state
  let draggingHandle = null; // 'a', 'b', or null

  // Available speed rates (populated from player or defaults)
  let availableRates = DEFAULT_SPEEDS;
  let currentRate = 1;

  // ---- DOM References ----
  const urlInput = document.getElementById('url-input');
  const loadBtn = document.getElementById('load-btn');
  const urlError = document.getElementById('url-error');
  const videoWrapper = document.getElementById('video-wrapper');
  const playerPlaceholder = document.getElementById('player-placeholder');
  const playPauseBtn = document.getElementById('play-pause-btn');
  const playIcon = document.getElementById('play-icon');
  const pauseIcon = document.getElementById('pause-icon');
  const timeDisplay = document.getElementById('time-display');
  const speedButtonsContainer = document.getElementById('speed-buttons');
  const loopToggleBtn = document.getElementById('loop-toggle-btn');
  const setABtn = document.getElementById('set-a-btn');
  const setBBtn = document.getElementById('set-b-btn');
  const resetABBtn = document.getElementById('reset-ab-btn');
  const aTimeDisplay = document.getElementById('a-time-display');
  const bTimeDisplay = document.getElementById('b-time-display');
  const timelineTrack = document.getElementById('timeline-track');
  const loopRegion = document.getElementById('loop-region');
  const playhead = document.getElementById('playhead');
  const handleA = document.getElementById('handle-a');
  const handleB = document.getElementById('handle-b');
  const controlsBar = document.getElementById('controls-bar');
  const timelineSection = document.getElementById('timeline-section');
  const sectionsPanel = document.getElementById('sections-panel');
  const addSectionBtn = document.getElementById('add-section-btn');
  const addSectionForm = document.getElementById('add-section-form');
  const sectionNameInput = document.getElementById('section-name-input');
  const saveSectionBtn = document.getElementById('save-section-btn');
  const cancelSectionBtn = document.getElementById('cancel-section-btn');
  const sectionList = document.getElementById('section-list');
  const noSectionsMsg = document.getElementById('no-sections-msg');
  const importBtn = document.getElementById('import-btn');
  const exportBtn = document.getElementById('export-btn');
  const importFileInput = document.getElementById('import-file-input');
  const shortcutsBtn = document.getElementById('shortcuts-btn');
  const shortcutsModal = document.getElementById('shortcuts-modal');
  const closeModalBtn = document.getElementById('close-modal-btn');

  // ---- YouTube IFrame API ----

  function loadYouTubeAPI() {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript.parentNode.insertBefore(tag, firstScript);
  }

  window.onYouTubeIframeAPIReady = function () {
    apiReady = true;
    if (pendingVideoId) {
      createPlayer(pendingVideoId);
      pendingVideoId = null;
    }
  };

  // ---- URL Parsing ----

  function extractVideoId(input) {
    input = input.trim();
    const patterns = [
      /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  // ---- Player Management ----

  function loadVideo(videoId) {
    currentVideoId = videoId;
    urlError.textContent = '';
    duration = 0;
    activeSectionId = null;

    // Update URL hash
    history.replaceState(null, '', '#' + videoId);

    if (!apiReady) {
      pendingVideoId = videoId;
      return;
    }

    if (player && typeof player.loadVideoById === 'function') {
      player.loadVideoById(videoId);
      // onPlayerReady won't fire for loadVideoById, so load sections now
      // Duration will be picked up by the polling loop or state change handler
      loadSections();
      showControls();
    } else {
      createPlayer(videoId);
    }
  }

  function createPlayer(videoId) {
    playerPlaceholder.style.display = 'none';

    // YouTube API needs pixel dimensions; compute from the wrapper
    var rect = videoWrapper.getBoundingClientRect();
    var w = Math.round(rect.width);
    var h = Math.round(rect.height);

    player = new YT.Player('yt-player', {
      width: w,
      height: h,
      videoId: videoId,
      playerVars: {
        autoplay: 1,
        controls: 1,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError
      }
    });
  }

  function onPlayerReady() {
    duration = player.getDuration();

    // Get available playback rates
    try {
      const rates = player.getAvailablePlaybackRates();
      if (rates && rates.length) {
        availableRates = rates;
      }
    } catch (e) {
      // Use defaults
    }

    renderSpeedButtons();
    resetAB();
    loadSections();
    showControls();
    startPolling();
  }

  function onPlayerStateChange(event) {
    switch (event.data) {
      case YT.PlayerState.PLAYING:
        isPlaying = true;
        updatePlayPauseIcon();
        startPolling();
        // Update duration in case it wasn't available before
        if (!duration || duration <= 0) {
          duration = player.getDuration();
          resetAB();
        }
        break;
      case YT.PlayerState.PAUSED:
        isPlaying = false;
        updatePlayPauseIcon();
        break;
      case YT.PlayerState.ENDED:
        isPlaying = false;
        updatePlayPauseIcon();
        if (loopEnabled) {
          player.seekTo(pointA, true);
          player.playVideo();
        }
        break;
    }
  }

  function onPlayerError(event) {
    const errors = {
      2: 'Invalid video ID.',
      5: 'This video cannot be played in an embedded player.',
      100: 'Video not found or removed.',
      101: 'The video owner does not allow embedded playback.',
      150: 'The video owner does not allow embedded playback.'
    };
    urlError.textContent = errors[event.data] || 'An error occurred loading the video.';
  }

  function showControls() {
    controlsBar.style.display = '';
    timelineSection.style.display = '';
    sectionsPanel.style.display = '';
  }

  // ---- Polling Loop ----

  function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(pollCallback, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function pollCallback() {
    if (!player || typeof player.getCurrentTime !== 'function') return;

    const currentTime = player.getCurrentTime();
    if (!duration || duration <= 0) {
      duration = player.getDuration();
    }

    // Update UI
    updatePlayhead(currentTime);
    updateTimeDisplay(currentTime);

    // AB loop enforcement
    if (loopEnabled && pointB > pointA && currentTime >= pointB) {
      player.seekTo(pointA, true);
    }
  }

  // ---- Playback Controls ----

  function togglePlayPause() {
    if (!player || typeof player.getPlayerState !== 'function') return;
    const state = player.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  }

  function updatePlayPauseIcon() {
    if (isPlaying) {
      playIcon.style.display = 'none';
      pauseIcon.style.display = '';
    } else {
      playIcon.style.display = '';
      pauseIcon.style.display = 'none';
    }
  }

  // ---- Speed Control ----

  function renderSpeedButtons() {
    speedButtonsContainer.innerHTML = '';
    availableRates.forEach(function (rate) {
      const btn = document.createElement('button');
      btn.className = 'speed-btn' + (rate === currentRate ? ' active' : '');
      btn.textContent = rate + 'x';
      btn.title = 'Speed ' + rate + 'x';
      btn.addEventListener('click', function () {
        setSpeed(rate);
      });
      speedButtonsContainer.appendChild(btn);
    });
  }

  function setSpeed(rate) {
    if (!player || typeof player.setPlaybackRate !== 'function') return;
    player.setPlaybackRate(rate);
    currentRate = rate;
    highlightActiveSpeed();
  }

  function highlightActiveSpeed() {
    var buttons = speedButtonsContainer.querySelectorAll('.speed-btn');
    buttons.forEach(function (btn) {
      var rate = parseFloat(btn.textContent);
      btn.classList.toggle('active', rate === currentRate);
    });
  }

  function changeSpeedStep(delta) {
    var idx = availableRates.indexOf(currentRate);
    if (idx === -1) idx = availableRates.indexOf(1);
    var newIdx = Math.max(0, Math.min(availableRates.length - 1, idx + delta));
    setSpeed(availableRates[newIdx]);
  }

  // ---- Time Display ----

  function updateTimeDisplay(currentTime) {
    timeDisplay.textContent = formatTime(currentTime) + ' / ' + formatTime(duration);
  }

  // ---- Timeline ----

  function updatePlayhead(currentTime) {
    if (!duration || duration <= 0) return;
    var pct = (currentTime / duration) * 100;
    playhead.style.left = pct + '%';
  }

  function updateLoopRegion() {
    if (!duration || duration <= 0) return;
    var leftPct = (pointA / duration) * 100;
    var widthPct = ((pointB - pointA) / duration) * 100;
    loopRegion.style.left = leftPct + '%';
    loopRegion.style.width = widthPct + '%';
    handleA.style.left = leftPct + '%';
    handleB.style.left = ((pointB / duration) * 100) + '%';
  }

  function updateABLabels() {
    aTimeDisplay.textContent = 'A: ' + formatTime(pointA);
    bTimeDisplay.textContent = 'B: ' + formatTime(pointB);
  }

  function getPercentFromEvent(e, track) {
    var rect = track.getBoundingClientRect();
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    var x = clientX - rect.left;
    return Math.max(0, Math.min(100, (x / rect.width) * 100));
  }

  function percentToTime(pct) {
    return (pct / 100) * duration;
  }

  // Handle dragging
  function initHandleDrag(handleEl, which) {
    function onStart(e) {
      e.preventDefault();
      draggingHandle = which;
      handleEl.classList.add('dragging');

      function onMove(e) {
        e.preventDefault();
        var pct = getPercentFromEvent(e, timelineTrack);
        var time = percentToTime(pct);

        if (which === 'a') {
          time = Math.min(time, pointB - 0.1);
          time = Math.max(0, time);
          pointA = time;
        } else {
          time = Math.max(time, pointA + 0.1);
          time = Math.min(duration, time);
          pointB = time;
        }

        updateLoopRegion();
        updateABLabels();
      }

      function onEnd() {
        draggingHandle = null;
        handleEl.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
    }

    handleEl.addEventListener('mousedown', onStart);
    handleEl.addEventListener('touchstart', onStart, { passive: false });
  }

  // Click on track to seek
  function initTrackClick() {
    timelineTrack.addEventListener('click', function (e) {
      if (e.target.classList.contains('timeline-handle')) return;
      if (draggingHandle) return;
      var pct = getPercentFromEvent(e, timelineTrack);
      var time = percentToTime(pct);
      if (player && typeof player.seekTo === 'function') {
        player.seekTo(time, true);
      }
    });
  }

  // ---- AB Loop Logic ----

  function setPointA(time) {
    if (time === undefined && player) {
      time = player.getCurrentTime();
    }
    pointA = Math.max(0, Math.min(time, pointB - 0.1));
    updateLoopRegion();
    updateABLabels();
  }

  function setPointB(time) {
    if (time === undefined && player) {
      time = player.getCurrentTime();
    }
    pointB = Math.max(pointA + 0.1, Math.min(time, duration));
    updateLoopRegion();
    updateABLabels();
  }

  function resetAB() {
    pointA = 0;
    pointB = duration || 0;
    updateLoopRegion();
    updateABLabels();
  }

  function toggleLoop() {
    loopEnabled = !loopEnabled;
    loopToggleBtn.classList.toggle('active', loopEnabled);
  }

  // ---- Section Playlist ----

  function saveSections() {
    if (!currentVideoId) return;
    try {
      localStorage.setItem(STORAGE_PREFIX + currentVideoId, JSON.stringify(sections));
    } catch (e) {
      // localStorage may be full or unavailable
    }
  }

  function loadSections() {
    if (!currentVideoId) {
      sections = [];
      renderSectionList();
      return;
    }
    try {
      var data = localStorage.getItem(STORAGE_PREFIX + currentVideoId);
      sections = data ? JSON.parse(data) : [];
    } catch (e) {
      sections = [];
    }
    activeSectionId = null;
    renderSectionList();
  }

  function addSection(name) {
    var section = {
      id: 'sec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: name || 'Section ' + (sections.length + 1),
      startTime: pointA,
      endTime: pointB
    };
    sections.push(section);
    saveSections();
    renderSectionList();
  }

  function deleteSection(id) {
    sections = sections.filter(function (s) { return s.id !== id; });
    if (activeSectionId === id) activeSectionId = null;
    saveSections();
    renderSectionList();
  }

  function renameSection(id, newName) {
    var section = sections.find(function (s) { return s.id === id; });
    if (section) {
      section.name = newName || section.name;
      saveSections();
      renderSectionList();
    }
  }

  function playSection(id) {
    var section = sections.find(function (s) { return s.id === id; });
    if (!section) return;
    activeSectionId = id;
    pointA = section.startTime;
    pointB = section.endTime;
    loopEnabled = true;
    loopToggleBtn.classList.add('active');
    updateLoopRegion();
    updateABLabels();
    if (player && typeof player.seekTo === 'function') {
      player.seekTo(pointA, true);
      player.playVideo();
    }
    renderSectionList();
  }

  function renderSectionList() {
    // Remove all children except the no-sections message
    while (sectionList.firstChild) {
      sectionList.removeChild(sectionList.firstChild);
    }

    if (sections.length === 0) {
      var msg = document.createElement('p');
      msg.className = 'muted-text';
      msg.id = 'no-sections-msg';
      msg.textContent = 'No sections saved yet. Set an A-B loop and click "+ Add Section".';
      sectionList.appendChild(msg);
      return;
    }

    sections.forEach(function (section, index) {
      var row = document.createElement('div');
      row.className = 'section-row';
      row.draggable = true;
      row.dataset.index = index;
      row.dataset.id = section.id;

      // Drag handle
      var dragHandle = document.createElement('span');
      dragHandle.className = 'section-drag-handle';
      dragHandle.textContent = '\u2630'; // hamburger icon
      dragHandle.title = 'Drag to reorder';

      // Name
      var nameSpan = document.createElement('span');
      nameSpan.className = 'section-name';
      nameSpan.textContent = section.name;
      nameSpan.title = 'Double-click to rename';

      // Double-click to rename
      nameSpan.addEventListener('dblclick', function () {
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'section-name-input';
        input.value = section.name;
        nameSpan.replaceWith(input);
        input.focus();
        input.select();

        function finishRename() {
          var newName = input.value.trim();
          if (newName && newName !== section.name) {
            renameSection(section.id, newName);
          } else {
            renderSectionList();
          }
        }

        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            finishRename();
          } else if (e.key === 'Escape') {
            renderSectionList();
          }
        });
        input.addEventListener('blur', finishRename);
      });

      // Times
      var timesSpan = document.createElement('span');
      timesSpan.className = 'section-times';
      timesSpan.textContent = formatTime(section.startTime) + ' - ' + formatTime(section.endTime);

      // Play button
      var playBtn = document.createElement('button');
      playBtn.className = 'section-play-btn' + (activeSectionId === section.id ? ' active' : '');
      playBtn.innerHTML = '&#9654;';
      playBtn.title = 'Play this section';
      playBtn.addEventListener('click', function () {
        playSection(section.id);
      });

      // Delete button
      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'section-delete-btn';
      deleteBtn.innerHTML = '&times;';
      deleteBtn.title = 'Delete section';
      deleteBtn.addEventListener('click', function () {
        deleteSection(section.id);
      });

      row.appendChild(dragHandle);
      row.appendChild(nameSpan);
      row.appendChild(timesSpan);
      row.appendChild(playBtn);
      row.appendChild(deleteBtn);

      // Drag events
      row.addEventListener('dragstart', function (e) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
        row.classList.add('dragging');
      });

      row.addEventListener('dragend', function () {
        row.classList.remove('dragging');
        // Remove drag-over class from all rows
        sectionList.querySelectorAll('.section-row').forEach(function (r) {
          r.classList.remove('drag-over');
        });
      });

      row.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // Remove drag-over from siblings, add to this
        sectionList.querySelectorAll('.section-row').forEach(function (r) {
          r.classList.remove('drag-over');
        });
        row.classList.add('drag-over');
      });

      row.addEventListener('dragleave', function () {
        row.classList.remove('drag-over');
      });

      row.addEventListener('drop', function (e) {
        e.preventDefault();
        row.classList.remove('drag-over');
        var fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        var toIndex = parseInt(row.dataset.index, 10);
        if (fromIndex !== toIndex && !isNaN(fromIndex) && !isNaN(toIndex)) {
          var moved = sections.splice(fromIndex, 1)[0];
          sections.splice(toIndex, 0, moved);
          saveSections();
          renderSectionList();
        }
      });

      sectionList.appendChild(row);
    });
  }

  // ---- Export / Import ----

  function exportSections() {
    if (!currentVideoId || sections.length === 0) return;
    var data = {
      videoId: currentVideoId,
      sections: sections
    };
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ytlooper-sections-' + currentVideoId + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importSections(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        if (!data || !Array.isArray(data.sections)) {
          urlError.textContent = 'Invalid sections file format.';
          return;
        }
        // Validate each section has required fields
        var valid = data.sections.every(function (s) {
          return typeof s.name === 'string' &&
            typeof s.startTime === 'number' &&
            typeof s.endTime === 'number' &&
            s.endTime > s.startTime;
        });
        if (!valid) {
          urlError.textContent = 'Sections file contains invalid data.';
          return;
        }
        // Ensure each imported section has a unique id
        data.sections.forEach(function (s) {
          if (!s.id) {
            s.id = 'sec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
          }
        });
        // If for the same video, merge. Otherwise replace.
        if (data.videoId === currentVideoId) {
          // Merge: add sections that don't already exist (by matching name+times)
          data.sections.forEach(function (imported) {
            var exists = sections.some(function (existing) {
              return existing.name === imported.name &&
                Math.abs(existing.startTime - imported.startTime) < 0.5 &&
                Math.abs(existing.endTime - imported.endTime) < 0.5;
            });
            if (!exists) {
              sections.push(imported);
            }
          });
        } else {
          // Different video — load that video first if we can, then set sections
          sections = data.sections;
          if (data.videoId) {
            currentVideoId = data.videoId;
          }
        }
        saveSections();
        renderSectionList();
        urlError.textContent = '';
      } catch (err) {
        urlError.textContent = 'Could not parse the sections file.';
      }
    };
    reader.readAsText(file);
  }

  // ---- Keyboard Shortcuts ----

  function handleKeyboard(e) {
    // Ignore when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    var key = e.key;

    switch (key) {
      case ' ':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'l':
      case 'L':
        toggleLoop();
        break;
      case 'a':
        setPointA();
        break;
      case 'b':
        setPointB();
        break;
      case '[':
        if (player) player.seekTo(pointA, true);
        break;
      case ']':
        if (player) player.seekTo(pointB, true);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (player) {
          var seekBack = e.shiftKey ? 1 : 5;
          player.seekTo(Math.max(0, player.getCurrentTime() - seekBack), true);
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (player) {
          var seekFwd = e.shiftKey ? 1 : 5;
          player.seekTo(Math.min(duration, player.getCurrentTime() + seekFwd), true);
        }
        break;
      case '-':
      case '_':
        changeSpeedStep(-1);
        break;
      case '+':
      case '=':
        changeSpeedStep(1);
        break;
      case 'r':
      case 'R':
        resetAB();
        break;
      case '?':
        toggleShortcutsModal();
        break;
    }
  }

  // ---- Modal ----

  function toggleShortcutsModal() {
    shortcutsModal.hidden = !shortcutsModal.hidden;
  }

  // ---- URL Hash ----

  function loadFromHash() {
    var hash = window.location.hash.replace('#', '').trim();
    if (hash && extractVideoId(hash)) {
      urlInput.value = hash;
      loadVideo(hash);
    }
  }

  // ---- Utility ----

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) seconds = 0;
    var hrs = Math.floor(seconds / 3600);
    var mins = Math.floor((seconds % 3600) / 60);
    var secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return hrs + ':' + mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
    }
    return mins + ':' + secs.toString().padStart(2, '0');
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Event Listeners ----

  function init() {
    // Initially hide controls until a video is loaded
    controlsBar.style.display = 'none';
    timelineSection.style.display = 'none';
    sectionsPanel.style.display = 'none';

    // Load YouTube API
    loadYouTubeAPI();

    // URL input
    loadBtn.addEventListener('click', function () {
      var id = extractVideoId(urlInput.value);
      if (id) {
        loadVideo(id);
      } else {
        urlError.textContent = 'Please enter a valid YouTube URL.';
      }
    });

    urlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        loadBtn.click();
      }
    });

    // Clear error on input change
    urlInput.addEventListener('input', function () {
      urlError.textContent = '';
    });

    // Play/Pause
    playPauseBtn.addEventListener('click', togglePlayPause);

    // Loop toggle
    loopToggleBtn.addEventListener('click', toggleLoop);

    // Set A / Set B / Reset
    setABtn.addEventListener('click', function () { setPointA(); });
    setBBtn.addEventListener('click', function () { setPointB(); });
    resetABBtn.addEventListener('click', resetAB);

    // Timeline handles
    initHandleDrag(handleA, 'a');
    initHandleDrag(handleB, 'b');
    initTrackClick();

    // Section playlist
    addSectionBtn.addEventListener('click', function () {
      addSectionForm.hidden = false;
      sectionNameInput.value = '';
      sectionNameInput.focus();
    });

    saveSectionBtn.addEventListener('click', function () {
      var name = sectionNameInput.value.trim();
      addSection(name);
      addSectionForm.hidden = true;
      sectionNameInput.value = '';
    });

    cancelSectionBtn.addEventListener('click', function () {
      addSectionForm.hidden = true;
      sectionNameInput.value = '';
    });

    sectionNameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveSectionBtn.click();
      } else if (e.key === 'Escape') {
        cancelSectionBtn.click();
      }
    });

    // Export / Import
    exportBtn.addEventListener('click', exportSections);
    importBtn.addEventListener('click', function () {
      importFileInput.click();
    });
    importFileInput.addEventListener('change', function () {
      if (importFileInput.files.length > 0) {
        importSections(importFileInput.files[0]);
        importFileInput.value = '';
      }
    });

    // Shortcuts modal
    shortcutsBtn.addEventListener('click', toggleShortcutsModal);
    closeModalBtn.addEventListener('click', function () {
      shortcutsModal.hidden = true;
    });
    // Close modal on backdrop click
    shortcutsModal.querySelector('.modal-backdrop').addEventListener('click', function () {
      shortcutsModal.hidden = true;
    });
    // Close modal on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !shortcutsModal.hidden) {
        shortcutsModal.hidden = true;
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboard);

    // When clicking outside the video, blur the iframe so keyboard shortcuts work
    document.addEventListener('click', function (e) {
      if (e.target.tagName !== 'IFRAME' && !e.target.closest('.video-wrapper')) {
        if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
          document.activeElement.blur();
        }
      }
    });

    // Load from URL hash if present
    loadFromHash();

    // Render initial speed buttons
    renderSpeedButtons();
  }

  // Start the app
  init();

})();
