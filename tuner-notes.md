# Guitar Tuner — Implementation Notes

## Overview

A built-in chromatic guitar tuner that uses the device microphone to detect pitch in real time. It lives across three files:

- **`tuner.js`** — All tuner logic: audio pipeline, AMDF pitch detection, frequency-to-note conversion, UI updates
- **`index.html`** — Tuner modal markup (note display, cents gauge, string indicators)
- **`style.css`** — Tuner modal and gauge styling

The tuner runs in a self-contained IIFE and exposes only `window.YTLooperTuner.toggle()` for the keyboard shortcut in `app.js`.

## Resources

- [cwilso/PitchDetect](https://github.com/nicktrav/nicktrav.github.io/blob/master/pitch-detect/js/pitchdetect.js) — Reference implementation for autocorrelation-based pitch detection in the browser
- [MDN Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) — `AudioContext`, `AnalyserNode`, `ScriptProcessorNode`, `MediaStreamSource`
- [AMDF (Average Magnitude Difference Function)](https://en.wikipedia.org/wiki/Average_magnitude_difference_function) — The autocorrelation variant used for pitch estimation

## Implementation Summary

### Audio pipeline

```
getUserMedia (mic) → MediaStreamSource → AnalyserNode (fftSize=8192) → ScriptProcessor (bufferSize=4096) → destination
```

The `ScriptProcessor`'s `onaudioprocess` callback reads time-domain data from the `AnalyserNode` and runs pitch detection on each buffer.

### Pitch detection (AMDF autocorrelation)

1. **RMS gate** — Compute RMS of the buffer; discard if below threshold (0.01) to ignore silence/noise
2. **Correlation computation** — For each lag offset 0..bufferSize/2, compute the average magnitude difference `|buffer[j] - buffer[j+offset]|`, then invert to get a correlation value (1 = perfect match, 0 = no match)
3. **Skip trivial peak** — Walk past the initial self-correlation peak (offsets where correlation > 0.8)
4. **Find best peak** — Scan remaining offsets for the highest correlation above 0.9; stop after passing the peak
5. **Quality check** — Reject if best correlation < 0.8
6. **Parabolic interpolation** — Refine the peak offset using neighboring correlation values for sub-sample accuracy
7. **Frequency** — `sampleRate / (bestOffset + shift)`

### Frequency-to-note conversion

- Computes semitone distance from A4 (440 Hz) using `12 * log2(freq / 440)`
- Derives MIDI note number, octave, note name, and cents deviation (rounded to nearest integer)
- Closest guitar string found by minimum cents distance across standard tuning (E2 A2 D3 G3 B3 E4)

### Display

- Note name + octave, frequency in Hz, cents deviation (+/- from nearest note)
- Gauge indicator positioned 0-100% (mapping -50 to +50 cents)
- Color coding: green (<=5 cents), yellow (<=15 cents), default otherwise
- Active guitar string highlighted

## Limitations

- **ScriptProcessor is deprecated** — Should migrate to `AudioWorklet` for better performance and to avoid main-thread audio processing
- **AMDF accuracy at extremes** — Struggles with very low frequencies (< ~80 Hz, e.g. drop tunings) and very high frequencies where the buffer doesn't capture enough periods
- **No noise filtering** — No noise gate beyond the simple RMS threshold; background noise can cause false detections
- **Single note only** — Cannot detect chords or multiple simultaneous pitches
- **Buffer size tradeoff** — 4096 samples balances latency vs. accuracy; smaller buffers improve responsiveness but reduce low-frequency resolution
- **Fixed reference pitch** — A4 is hardcoded to 440 Hz; some players prefer 432 Hz or other calibrations
- **Browser compatibility** — `getUserMedia` and `AudioContext` support varies; `webkitAudioContext` fallback is included but older browsers may still fail

## Alternatives

| Approach | Pros | Cons |
|----------|------|------|
| **FFT-based detection** | Built into `AnalyserNode`; simple to implement | Poor frequency resolution at low frequencies without very large FFT sizes |
| **YIN algorithm** | More accurate than AMDF; better noise handling | More complex; higher CPU cost |
| **WASM-based detection** | Near-native performance; can use proven C/C++ libraries | Build toolchain complexity; larger payload |
| **ML pitch detection (CREPE/SPICE)** | State-of-the-art accuracy; handles noisy environments | Large model files; inference latency; dependency on TensorFlow.js or ONNX |
| **Web Audio API PitchDetector proposal** | Native browser API; zero JS overhead | Not yet implemented in any browser |

## Future Improvements

- **AudioWorklet migration** — Replace deprecated `ScriptProcessor` with `AudioWorkletProcessor` to move pitch detection off the main thread
- **WASM note detection** — Already listed in CLAUDE.md TODOs; could port a C library like Aubio for better accuracy and performance
- **Noise gate / filtering** — Apply a bandpass filter (80-1200 Hz for guitar) before detection to reduce false positives
- **Chord detection** — Use FFT to identify multiple simultaneous peaks
- **Reference pitch calibration** — Let users set A4 to something other than 440 Hz
- **Visual waveform display** — Show the raw audio waveform or a frequency spectrum alongside the tuner gauge
- **Smoothing / averaging** — Average detected pitch over several frames to reduce jitter in the display
