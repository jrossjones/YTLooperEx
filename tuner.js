/* ========================================
   YTLooper - Guitar Tuner
   Pitch detection via Web Audio API + autocorrelation
   ======================================== */

(function () {
  'use strict';

  // ---- Constants ----
  var A4 = 440;
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var BUFFER_SIZE = 4096;
  var RMS_THRESHOLD = 0.01;

  // Standard guitar tuning frequencies
  var GUITAR_STRINGS = [
    { note: 'E', octave: 2, freq: 82.41 },
    { note: 'A', octave: 2, freq: 110.00 },
    { note: 'D', octave: 3, freq: 146.83 },
    { note: 'G', octave: 3, freq: 196.00 },
    { note: 'B', octave: 3, freq: 246.94 },
    { note: 'E', octave: 4, freq: 329.63 }
  ];

  // ---- State ----
  var audioContext = null;
  var analyserNode = null;
  var sourceNode = null;
  var scriptNode = null;
  var mediaStream = null;
  var isListening = false;

  // ---- DOM References (cached on init) ----
  var tunerModal = null;
  var tunerBtn = null;
  var closeTunerBtn = null;
  var startBtn = null;
  var errorEl = null;
  var noteEl = null;
  var frequencyEl = null;
  var centsEl = null;
  var gaugeIndicator = null;
  var stringEls = null;

  // ---- Autocorrelation Pitch Detection ----

  function autoCorrelate(buffer, sampleRate) {
    // Check if signal is loud enough
    var rms = 0;
    for (var i = 0; i < buffer.length; i++) {
      rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / buffer.length);
    if (rms < RMS_THRESHOLD) return -1;

    // AMDF-style autocorrelation with two-phase peak finding
    var size = buffer.length;
    var maxSamples = Math.floor(size / 2);
    var correlations = new Array(maxSamples);

    // Phase 1: compute all correlations
    for (var offset = 0; offset < maxSamples; offset++) {
      var correlation = 0;
      for (var j = 0; j < maxSamples; j++) {
        correlation += Math.abs(buffer[j] - buffer[j + offset]);
      }
      correlations[offset] = 1 - correlation / maxSamples;
    }

    // Phase 2: skip past the trivial self-correlation peak
    // Walk forward until similarity drops below threshold
    var skipThreshold = 0.8;
    var offset = 1; // start at 1 to skip trivial offset-0
    while (offset < maxSamples && correlations[offset] > skipThreshold) {
      offset++;
    }

    // Phase 3: find the best peak after the dip
    var bestOffset = -1;
    var bestCorrelation = 0;
    var foundGoodCorrelation = false;

    for (; offset < maxSamples; offset++) {
      if (correlations[offset] > 0.9 && correlations[offset] > bestCorrelation) {
        bestCorrelation = correlations[offset];
        bestOffset = offset;
        foundGoodCorrelation = true;
      } else if (foundGoodCorrelation) {
        // Past the peak — stop searching
        break;
      }
    }

    if (bestCorrelation < 0.8 || bestOffset <= 0) return -1;

    // Parabolic interpolation for sub-sample accuracy
    var shift = 0;
    if (bestOffset > 0 && bestOffset < maxSamples - 1) {
      var prev = correlations[bestOffset - 1];
      var curr = correlations[bestOffset];
      var next = correlations[bestOffset + 1];
      shift = (next - prev) / (2 * (2 * curr - next - prev));
    }

    return sampleRate / (bestOffset + shift);
  }

  // ---- Note / Frequency Helpers ----

  function frequencyToNote(freq) {
    var noteNum = 12 * (Math.log2(freq / A4));
    var roundedNote = Math.round(noteNum);
    var cents = Math.round((noteNum - roundedNote) * 100);
    var midiNote = roundedNote + 69; // A4 = MIDI 69
    var octave = Math.floor(midiNote / 12) - 1;
    var noteIndex = ((midiNote % 12) + 12) % 12;
    return {
      note: NOTE_NAMES[noteIndex],
      octave: octave,
      cents: cents
    };
  }

  function findClosestString(freq) {
    var closestIdx = 0;
    var closestDist = Infinity;
    for (var i = 0; i < GUITAR_STRINGS.length; i++) {
      // Use cents distance for perceptual accuracy
      var centsDist = Math.abs(1200 * Math.log2(freq / GUITAR_STRINGS[i].freq));
      if (centsDist < closestDist) {
        closestDist = centsDist;
        closestIdx = i;
      }
    }
    return closestIdx;
  }

  // ---- Audio Setup ----

  function startListening() {
    if (isListening) {
      stopListening();
      return;
    }

    errorEl.textContent = '';

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (stream) {
        mediaStream = stream;
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContext.resume();

        sourceNode = audioContext.createMediaStreamSource(stream);
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = BUFFER_SIZE * 2;

        scriptNode = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
        sourceNode.connect(analyserNode);
        analyserNode.connect(scriptNode);
        scriptNode.connect(audioContext.destination);

        var buffer = new Float32Array(BUFFER_SIZE);

        scriptNode.onaudioprocess = function () {
          analyserNode.getFloatTimeDomainData(buffer);
          var freq = autoCorrelate(buffer, audioContext.sampleRate);
          if (freq > 0 && isFinite(freq)) {
            updateDisplay(freq);
          }
        };

        isListening = true;
        startBtn.textContent = 'Stop Tuner';
        startBtn.classList.add('listening');
      })
      .catch(function (err) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorEl.textContent = 'Microphone permission denied. Please allow access and try again.';
        } else {
          errorEl.textContent = 'Could not access microphone: ' + err.message;
        }
      });
  }

  function stopListening() {
    isListening = false;
    startBtn.textContent = 'Start Tuner';
    startBtn.classList.remove('listening');

    if (scriptNode) {
      scriptNode.onaudioprocess = null;
      scriptNode.disconnect();
      scriptNode = null;
    }
    if (analyserNode) {
      analyserNode.disconnect();
      analyserNode = null;
    }
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (track) { track.stop(); });
      mediaStream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }

    resetDisplay();
  }

  // ---- Display Updates ----

  function updateDisplay(freq) {
    var noteInfo = frequencyToNote(freq);
    var closestStringIdx = findClosestString(freq);

    // Note name
    noteEl.textContent = noteInfo.note + noteInfo.octave;

    // Frequency
    frequencyEl.textContent = freq.toFixed(1) + ' Hz';

    // Cents
    var absCents = Math.abs(noteInfo.cents);
    if (noteInfo.cents === 0) {
      centsEl.textContent = 'in tune';
    } else {
      centsEl.textContent = (noteInfo.cents > 0 ? '+' : '') + noteInfo.cents + ' cents';
    }

    // Gauge indicator position (map -50..+50 cents to 0%..100%)
    var gaugePct = 50 + noteInfo.cents;
    gaugePct = Math.max(0, Math.min(100, gaugePct));
    gaugeIndicator.style.left = gaugePct + '%';

    // Color coding
    gaugeIndicator.classList.remove('in-tune', 'close');
    if (absCents <= 5) {
      gaugeIndicator.classList.add('in-tune');
    } else if (absCents <= 15) {
      gaugeIndicator.classList.add('close');
    }

    // Highlight closest string
    for (var i = 0; i < stringEls.length; i++) {
      stringEls[i].classList.toggle('active', i === closestStringIdx);
    }
  }

  function resetDisplay() {
    noteEl.textContent = '--';
    frequencyEl.textContent = '-- Hz';
    centsEl.textContent = '';
    gaugeIndicator.style.left = '50%';
    gaugeIndicator.classList.remove('in-tune', 'close');
    for (var i = 0; i < stringEls.length; i++) {
      stringEls[i].classList.remove('active');
    }
  }

  // ---- Modal Management ----

  function openModal() {
    tunerModal.hidden = false;
  }

  function closeModal() {
    tunerModal.hidden = true;
    stopListening();
  }

  function toggleModal() {
    if (tunerModal.hidden) {
      openModal();
    } else {
      closeModal();
    }
  }

  // ---- Initialization ----

  function init() {
    tunerModal = document.getElementById('tuner-modal');
    tunerBtn = document.getElementById('tuner-btn');
    closeTunerBtn = document.getElementById('close-tuner-btn');
    startBtn = document.getElementById('tuner-start-btn');
    errorEl = document.getElementById('tuner-error');
    noteEl = document.getElementById('tuner-note');
    frequencyEl = document.getElementById('tuner-frequency');
    centsEl = document.getElementById('tuner-cents');
    gaugeIndicator = document.getElementById('tuner-gauge-indicator');
    stringEls = document.getElementById('tuner-strings').querySelectorAll('.tuner-string');

    // Open/close
    tunerBtn.addEventListener('click', toggleModal);
    closeTunerBtn.addEventListener('click', closeModal);

    // Close on backdrop click
    tunerModal.querySelector('.modal-backdrop').addEventListener('click', closeModal);

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !tunerModal.hidden) {
        closeModal();
      }
    });

    // Start/stop
    startBtn.addEventListener('click', startListening);

    // Cleanup on page unload
    window.addEventListener('beforeunload', stopListening);
  }

  // Expose toggle for keyboard shortcut in app.js
  window.YTLooperTuner = { toggle: function () { toggleModal(); } };

  init();

})();
