import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { Track } from "@/data/music";
import type { NativeAudioState } from "@/lib/audioTypes";
import { nativePlaybackStateChanged, syncNativePlaybackClock } from "@/lib/nativePlaybackState";
import { api } from "@/lib/api";
import { commitPlaybackTime, getPlaybackTime } from "@/lib/playbackClock";
import { configureSpectrumAnalyser } from "@/lib/spectrumEngine";
import { readCachedAudioSettings, writeCachedAudioSettings, type AudioOutputMode, type QualityLevel } from "@/lib/playerPresentation";
import loudnessProcessorUrl from "@/lib/loudnessProcessor.js?url&no-inline";

// Owns the media pipeline: the HTML audio element, the mpv native bridge
// (loading/progress/pause/volume/device + exclusive mode), output device
// enumeration and the Web Audio graph that feeds the spectrum visualizer.
export function useAudioEngine(options: {
  activeTrack: Track;
  activeTrackId: string;
  idleTrackId: string;
  effectiveQualityLevel: QualityLevel;
  playing: boolean;
  volume: number;
  hifiEnabled: boolean;
  masterQualityEnabled: boolean;
  gaplessEnabled: boolean;
  normalizationEnabled: boolean;
  audioOutputMode: AudioOutputMode;
  pageVisible: boolean;
  analyserEnabled: boolean;
  pendingSeekRef: { current: number };
  setPlaying: (updater: (playing: boolean) => boolean) => void;
  setDurationSeconds: (seconds: number) => void;
  exclusiveMode: boolean;
  durationSeconds: number;
  handleTrackEnded: () => void;
  // Called when mpv advances to an entry that was appended for gapless
  // playback. The native engine owns the transition, but React still needs
  // to adopt the new track id so the analyser and progress UI follow it.
  handleNativeTrackAdvanced: (trackId: string) => void;
  pickRelativeTrack: (direction: 1 | -1) => void;
  hasMultipleQueueTracks: boolean;
  // Resolves the next queue entry (already URL-resolved) for gapless mpv
  // preloading; null when the next track cannot be preloaded.
  getNextPreload: () => { trackId: string; url: string } | null;
}) {
  const activeTrack = options.activeTrack;
  const [audioOutputDevices, setAudioOutputDevices] = useState<Array<{ id: string; label: string }>>([]);
  const [nativeAudioSupported, setNativeAudioSupported] = useState(() => Boolean(window.ariaDesktop?.nativeAudio?.supported));
  const [nativeAudioState, setNativeAudioState] = useState<NativeAudioState | null>(null);
  const [selectedSinkId, setSelectedSinkId] = useState(() => readCachedAudioSettings().sinkId ?? "default");
  const [nativePlaybackFailed, setNativePlaybackFailed] = useState(false);
  const [nativeAnalyserWakeToken, setNativeAnalyserWakeToken] = useState(0);
  const [normalizationError, setNormalizationError] = useState<string | null>(null);
  const [normalizerReady, setNormalizerReady] = useState(false);

  // Browser/System output must remain a Chromium media session. The two
  // WASAPI choices use mpv: Shared exposes Aria as an application-audio
  // source for OOPZ, while Exclusive opens the endpoint outside the system
  // mixer. Audio CD playback always requires the native engine.
  const nativePlaybackRequested = Boolean(
    nativeAudioSupported && (options.audioOutputMode !== "system" || activeTrack.requiresNativePlayback),
  );
  // Do not silently send a failed WASAPI request back through Chromium. That
  // made the UI say "Exclusive" while Windows was still mixing the audio.
  const nativePlaybackEnabled = nativePlaybackRequested;

  const activeStreamUrl = useMemo(() => {
    if (!activeTrack.streamUrl) return null;
    const resolvedUrl = api.resolveUrl(activeTrack.streamUrl);
    if (activeTrack.source !== "netease") return resolvedUrl;

    const url = new URL(resolvedUrl, window.location.href);
    url.searchParams.set("level", options.effectiveQualityLevel);
    return url.href;
  }, [activeTrack, options.effectiveQualityLevel]);

  const audioElementStreamUrl = useMemo(() => {
    if (!activeTrack.streamUrl || activeTrack.requiresNativePlayback) return null;
    const resolvedUrl = api.resolveUrl(activeTrack.streamUrl);
    if (activeTrack.source !== "netease") return resolvedUrl;

    const url = new URL(resolvedUrl, window.location.href);
    if (activeTrack.source === "netease") {
      // Native mpv owns the audible lossless stream. The renderer copy is
      // analyser-only, so use the smallest available stream to avoid doubling
      // high-resolution downloads and decoder memory.
      url.searchParams.set("level", nativePlaybackEnabled ? "standard" : options.effectiveQualityLevel);
    }
    return url.href;
  }, [activeTrack, options.effectiveQualityLevel, nativePlaybackEnabled]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const nativeSilenceGainRef = useRef<GainNode | null>(null);
  const normalizerRef = useRef<AudioWorkletNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const normalizerLoadRef = useRef<Promise<void> | null>(null);
  const analyserOutputModeRef = useRef<"audible" | "normalized" | "silent" | null>(null);
  const nativeLoadedUrlRef = useRef<string | null>(null);
  const nativeAnalyserDelayUntilRef = useRef(0);
  const nativeLoadSequenceRef = useRef(0);
  const nativeSeekSequenceRef = useRef(0);
  const lastNativeRenderRef = useRef<NativeAudioState | null>(null);
  const audioErrorRef = useRef({ count: 0, lastAt: 0 });
  const preloadKeyRef = useRef<string | null>(null);
  const handledGaplessGenerationRef = useRef(0);
  const previousStreamRef = useRef({ trackId: activeTrack.id, url: activeStreamUrl });

  // A quality change replaces the stream, not the song. Capture the shared
  // clock before either decoder resets its source; both the native load and
  // browser loadedmetadata paths consume this position when they are ready.
  useEffect(() => {
    const previous = previousStreamRef.current;
    if (previous.trackId === activeTrack.id && previous.url && activeStreamUrl && previous.url !== activeStreamUrl) {
      options.pendingSeekRef.current = getPlaybackTime();
    }
    previousStreamRef.current = { trackId: activeTrack.id, url: activeStreamUrl };
  }, [activeTrack.id, activeStreamUrl]);

  const syncNativeAudioState = useEffectEvent((state: NativeAudioState) => {
    if (state.kind === "superseded") return;
    // Position and VBR bitrate ticks do not change the App's presentation.
    // Keep the playhead in its external store and sync the analyser directly.
    if (nativePlaybackStateChanged(lastNativeRenderRef.current, state)) {
      lastNativeRenderRef.current = state;
      setNativeAudioState(state);
    }
    const currentTrackMatches = Boolean(state.trackId && state.trackId === options.activeTrackId);
    const shouldSyncPlayback =
      nativePlaybackEnabled &&
      currentTrackMatches &&
      (state.active ||
        state.kind === "loading" ||
        state.kind === "loaded" ||
        state.kind === "pause" ||
        state.kind === "seek" ||
        state.kind === "progress" ||
        state.kind === "ended");

    if (shouldSyncPlayback) {
      const audio = audioRef.current;
      syncNativePlaybackClock(state, audio?.getAttribute("src") ? audio : null);
      if (typeof state.duration === "number" && state.duration > 0) {
        options.setDurationSeconds(state.duration);
      }
      // Aria owns playback intent (including SMTC commands). An acknowledgement
      // of an older pause must not undo a newer play click during native loading.
    }
    if (state.kind === "ended" && currentTrackMatches && nativePlaybackEnabled) {
      options.handleTrackEnded();
    }

    // With an appended mpv playlist entry, the native engine emits a
    // `advanced` event for the next track without an intervening renderer
    // load call. Its track id therefore differs from React's current id. Do
    // not wait for an `ended` event (which is intentionally suppressed by the
    // native engine); hand the identity to App immediately.
    const gaplessGeneration = Number(state.gaplessGeneration ?? 0);
    // A native engine restart resets its generation counter. Drop the old
    // renderer-side watermark so the first seamless transition after resume
    // is still adopted.
    if (gaplessGeneration < handledGaplessGenerationRef.current) {
      handledGaplessGenerationRef.current = 0;
    }
    if (
      nativePlaybackEnabled &&
      state.kind === "advanced" &&
      state.trackId &&
      gaplessGeneration > handledGaplessGenerationRef.current
    ) {
      handledGaplessGenerationRef.current = gaplessGeneration;
      options.handleNativeTrackAdvanced(state.trackId);
    }
  });

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativeAudio?.supported) return;

    let cancelled = false;
    nativeAudio
      .getState?.()
      .then((state) => {
        if (!cancelled && state) syncNativeAudioState(state as NativeAudioState);
      })
      .catch(() => undefined);

    const dispose = nativeAudio.onEvent?.((payload) => {
      if (!cancelled) syncNativeAudioState(payload as NativeAudioState);
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [syncNativeAudioState]);

  useEffect(() => {
    if (nativePlaybackEnabled) return;
    const audio = audioRef.current as (HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> }) | null;
    const sinkId = selectedSinkId === "default" ? "" : selectedSinkId;
    const context = audioContextRef.current as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    context?.setSinkId?.(sinkId).catch(() => setSelectedSinkId("default"));
    audio?.setSinkId?.(sinkId).catch(() => {
      // Device switching is optional; keep current output if the platform rejects it.
    });
  }, [nativePlaybackEnabled, selectedSinkId]);

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (nativeAudio?.supported && options.audioOutputMode !== "system") {
      let cancelled = false;
      nativeAudio
        .isSupported?.()
        .then((supported) => {
          if (cancelled) return [];
          setNativeAudioSupported(Boolean(supported));
          if (!supported) return [];
          return nativeAudio.listDevices?.() ?? [];
        })
        .then((devices) => {
          if (!cancelled && Array.isArray(devices) && devices.length) {
            setAudioOutputDevices(devices);
          }
        })
        .catch(() => {
          if (!cancelled) setNativeAudioSupported(false);
        });
      return () => { cancelled = true; };
    }

    if (!navigator.mediaDevices?.enumerateDevices) return;

    let cancelled = false;
    const refreshDevices = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (cancelled) return;
          const outputs = devices
            .filter((device) => device.kind === "audiooutput")
            .map((device, index) => ({
              id: device.deviceId || `output-${index}`,
              label: device.label || `播放设备 ${index + 1}`,
            }));
          setAudioOutputDevices([{ id: "default", label: "系统默认" }, ...outputs.filter((device) => device.id !== "default")]);
        })
        .catch(() => {
          if (!cancelled) setAudioOutputDevices([{ id: "default", label: "系统默认" }]);
        });
    };

    refreshDevices();
    navigator.mediaDevices.addEventListener?.("devicechange", refreshDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refreshDevices);
    };
  }, [options.audioOutputMode]);

  useEffect(() => {
    writeCachedAudioSettings({
      sinkId: selectedSinkId,
      hifiEnabled: options.hifiEnabled,
      masterQualityEnabled: options.masterQualityEnabled,
      gaplessEnabled: options.gaplessEnabled,
      normalizationEnabled: options.normalizationEnabled,
      exclusiveMode: options.exclusiveMode,
      outputMode: options.audioOutputMode,
    });
  }, [options.audioOutputMode, options.exclusiveMode, options.gaplessEnabled, options.hifiEnabled, options.masterQualityEnabled, options.normalizationEnabled, selectedSinkId]);

  useEffect(() => {
    setNativePlaybackFailed(false);
    nativeSeekSequenceRef.current += 1;
    nativeLoadedUrlRef.current = null;
    if (!nativePlaybackRequested) {
      nativeAnalyserDelayUntilRef.current = 0;
      setNativeAnalyserWakeToken((value) => value + 1);
      return;
    }

    nativeAnalyserDelayUntilRef.current = performance.now() + 220;
    const timer = window.setTimeout(() => {
      setNativeAnalyserWakeToken((value) => value + 1);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [options.activeTrack.id, activeStreamUrl, options.audioOutputMode, nativePlaybackRequested, selectedSinkId]);

  useEffect(() => {
    if (!audioOutputDevices.length) return;
    if (audioOutputDevices.some((device) => device.id === selectedSinkId)) return;
    setSelectedSinkId("default");
  }, [audioOutputDevices, selectedSinkId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const nativeAnalyserBridgeReady = Boolean(nativePlaybackEnabled && audioSourceRef.current && nativeSilenceGainRef.current);
    const nativeAnalyserReady =
      !nativePlaybackEnabled ||
      Boolean(
        nativeAudioState?.trackId === options.activeTrack.id &&
          nativeAudioState.active &&
          performance.now() >= nativeAnalyserDelayUntilRef.current,
      );
    audio.muted = nativePlaybackEnabled && !nativeAnalyserBridgeReady;
    audio.volume = nativePlaybackEnabled ? (nativeAnalyserBridgeReady ? 1 : 0) : outputGainRef.current ? 1 : Math.max(0, Math.min(1, options.volume / 100));
    if (outputGainRef.current) outputGainRef.current.gain.setTargetAtTime(options.volume / 100, audioContextRef.current!.currentTime, 0.03);
    // The mpv path owns audible lossless playback. Chromium only needs a
    // lightweight analyser source, so avoid pre-buffering the whole stream.
    audio.preload = nativePlaybackEnabled ? (nativeAnalyserReady ? "metadata" : "none") : "metadata";

    if (!audioElementStreamUrl || !nativeAnalyserReady || (nativePlaybackEnabled && !options.analyserEnabled)) {
      audio.pause();
      if (nativePlaybackEnabled && audio.src) {
        audio.removeAttribute("src");
        audio.load();
      }
      return;
    }

    const nextSrc = new URL(audioElementStreamUrl, window.location.href).href;
    if (audio.src !== nextSrc) {
      audio.pause();
      if (audio.src) {
        audio.removeAttribute("src");
        audio.load();
      }
      audio.src = nextSrc;
      audio.load();
      if (!nativePlaybackEnabled) options.setDurationSeconds(0);
    }

    if (options.playing) {
      audio.play().catch(() => {
        if (!nativePlaybackEnabled) options.setPlaying(() => false);
      });
    } else {
      audio.pause();
    }
  }, [
    audioElementStreamUrl,
    options.activeTrack.id,
    options.hifiEnabled,
    nativeAudioState?.active,
    nativeAudioState?.trackId,
    nativeAnalyserWakeToken,
    nativePlaybackEnabled,
    options.analyserEnabled,
    options.volume,
    options.playing,
  ]);

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativeAudio?.supported) return;
    if (nativePlaybackEnabled) return;
    nativeLoadedUrlRef.current = null;
    nativeAudio.stop?.().catch(() => undefined);
  }, [nativePlaybackEnabled]);

  // Gapless preload runs on a 1-second clock tick reading the committed
  // playback clock, decoupled from state-update timing so the append always
  // lands inside the final seconds of the current track.
  const preloadInputsRef = useRef({
    enabled: false,
    playing: false,
    durationSeconds: 0,
    activeTrackId: "",
    generation: 0,
    getNextPreload: () => null as { trackId: string; url: string } | null,
  });
  preloadInputsRef.current = {
    enabled: nativePlaybackEnabled && options.gaplessEnabled,
    playing: options.playing,
    durationSeconds: options.durationSeconds,
    activeTrackId: options.activeTrack.id,
    generation: nativeAudioState?.gaplessGeneration ?? 0,
    getNextPreload: options.getNextPreload,
  };

  useEffect(() => {
    if (!nativePlaybackEnabled) return;
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    const loadNext = nativeAudio?.loadNext;
    if (!loadNext) return;

    const timer = window.setInterval(() => {
      const inputs = preloadInputsRef.current;
      if (!inputs.enabled || !inputs.playing) return;
      const remaining = inputs.durationSeconds - getPlaybackTime();
      if (!Number.isFinite(remaining) || remaining > 6 || remaining <= 0.2) return;

      const next = inputs.getNextPreload();
      if (!next) return;
      const key = `${inputs.activeTrackId}\u0000${next.trackId}\u0000${next.url}\u0000${inputs.generation}`;
      if (preloadKeyRef.current === key) return;
      preloadKeyRef.current = key;
      loadNext(next).catch(() => {
        preloadKeyRef.current = null;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [nativePlaybackEnabled, options.gaplessEnabled]);

  useEffect(() => {
    if (options.gaplessEnabled) return;
    preloadKeyRef.current = null;
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativePlaybackEnabled || !nativeAudio?.supported) return;
    // A disabled toggle must also drop an already appended mpv entry. Reload
    // the current URL through the normal effect on the next render.
    nativeLoadedUrlRef.current = null;
  }, [nativePlaybackEnabled, options.gaplessEnabled]);

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativePlaybackEnabled || !nativeAudio?.supported) return;
    options.pendingSeekRef.current = getPlaybackTime();
    nativeLoadedUrlRef.current = null;
  }, [options.exclusiveMode, nativePlaybackEnabled, selectedSinkId]);

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativePlaybackEnabled || !nativeAudio?.supported) return;

    if (!activeStreamUrl || options.activeTrack.id === options.idleTrackId) {
      nativeLoadedUrlRef.current = null;
      nativeAudio.stop?.().catch(() => undefined);
      return;
    }

    // A paused player restored after an app restart should not create an mpv
    // session. It avoids a phantom analyser and preserves the exact paused
    // state until the user explicitly presses play.
    if (!options.playing && !nativeAudioState?.active) {
      nativeLoadedUrlRef.current = null;
      return;
    }

    const nextUrl = activeStreamUrl;
    const nextLoadKey = [
      nextUrl,
      options.activeTrack.nativeDevice ?? "",
      options.activeTrack.nativeStart ?? "",
      options.activeTrack.nativeEnd ?? "",
      options.activeTrack.cdReadQuality ?? "high",
    ].join("\u0000");
    // A gapless advance is already loaded by mpv before React adopts the new
    // track id. Replacing that URL here would restart the song at zero and
    // can briefly disconnect the analyser from the active decoder.
    const nativeStateOwnsTrack = Boolean(
      nativeAudioState?.active &&
        nativeAudioState.trackId === options.activeTrack.id &&
        nativeAudioState.url === nextUrl &&
        nativeAudioState.exclusive === options.exclusiveMode &&
        nativeAudioState.deviceId === (selectedSinkId === "default" ? "auto" : selectedSinkId),
    );
    if (nativeStateOwnsTrack) {
      nativeLoadedUrlRef.current = nextLoadKey;
      return;
    }
    if (nativeLoadedUrlRef.current === nextLoadKey) return;

    let cancelled = false;
    const loadSequence = nativeLoadSequenceRef.current + 1;
    nativeLoadSequenceRef.current = loadSequence;
    nativeLoadedUrlRef.current = nextLoadKey;
    nativeAudio
      .load?.({
        trackId: options.activeTrack.id,
        url: nextUrl,
        position: options.pendingSeekRef.current || 0,
        paused: !options.playing,
        volume: options.volume,
        exclusive: options.exclusiveMode,
        deviceId: selectedSinkId,
        nativeDevice: options.activeTrack.nativeDevice ?? null,
        startChapter: options.activeTrack.nativeStart ?? null,
        endChapter: options.activeTrack.nativeEnd ?? null,
        cdReadQuality: options.activeTrack.cdReadQuality ?? "high",
        normalizationEnabled: options.normalizationEnabled,
      })
      .then((state) => {
        if (cancelled || nativeLoadSequenceRef.current !== loadSequence) return;
        if (state) syncNativeAudioState(state as NativeAudioState);
      })
      .catch(() => {
        if (cancelled || nativeLoadSequenceRef.current !== loadSequence) return;
        nativeLoadedUrlRef.current = null;
        setNativePlaybackFailed(true);
        options.setPlaying(() => false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeStreamUrl,
    options.activeTrack.id,
    options.activeTrack.cdReadQuality,
    options.activeTrack.nativeEnd,
    options.activeTrack.nativeDevice,
    options.activeTrack.nativeStart,
    nativePlaybackEnabled,
    options.gaplessEnabled,
    nativeAudioState?.active,
    nativeAudioState?.trackId,
    options.exclusiveMode,
    options.volume,
    options.playing,
    selectedSinkId,
    syncNativeAudioState,
  ]);

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativePlaybackEnabled || !nativeAudio?.supported || (!options.playing && !nativeAudioState?.active)) return;
    nativeAudio.setPaused?.(!options.playing).catch(() => undefined);
  }, [nativeAudioState?.active, nativePlaybackEnabled, options.playing]);
  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativePlaybackEnabled || !nativeAudio?.supported || !nativeAudioState?.active) return;
    nativeAudio.setVolume?.(options.volume).catch(() => undefined);
  }, [nativeAudioState?.active, nativePlaybackEnabled, options.volume]);

  useEffect(() => {
    setNormalizationError(null);
    if (!nativePlaybackEnabled || !nativeAudioState?.active) return;
    window.ariaDesktop?.nativeAudio?.configure?.({ normalizationEnabled: options.normalizationEnabled })
      .catch(() => setNormalizationError("音量标准化未能启用，请切换歌曲后重试。"));
  }, [nativePlaybackEnabled, nativeAudioState?.active, options.normalizationEnabled]);

  const seekNativeTrack = useEffectEvent(async (seconds: number) => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativePlaybackEnabled || !nativeAudio?.seek || !Number.isFinite(seconds)) return false;
    const position = Math.max(0, seconds);
    const seekSequence = ++nativeSeekSequenceRef.current;
    options.pendingSeekRef.current = position;
    commitPlaybackTime(position, true);
    // Restored paused tracks may not have a decoder yet. The load effect
    // consumes this pending position when the user's seek also resumes play.
    if (!nativeAudioState?.active || nativeAudioState.trackId !== options.activeTrack.id) return true;
    try {
      const state = await nativeAudio.seek(position);
      if (nativeSeekSequenceRef.current !== seekSequence) return false;
      options.pendingSeekRef.current = 0;
      if (state) syncNativeAudioState(state as NativeAudioState);
      return true;
    } catch {
      if (nativeSeekSequenceRef.current !== seekSequence) return false;
      options.pendingSeekRef.current = 0;
      // Keep future native progress subscribed even when one seek is rejected.
      const state = await nativeAudio.getState?.().catch(() => undefined);
      if (state && nativeSeekSequenceRef.current === seekSequence) syncNativeAudioState(state as NativeAudioState);
      return false;
    }
  });

  // mpv unloads its file at EOF. A seek to zero after that point operates on
  // the idle player and cannot start a single-track repeat, so reload the
  // source through the native engine instead.
  const restartNativeTrack = useEffectEvent(async () => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativePlaybackEnabled || !nativeAudio?.supported || !activeStreamUrl || options.activeTrack.id === options.idleTrackId) {
      return false;
    }

    const nextLoadKey = [
      activeStreamUrl,
      options.activeTrack.nativeDevice ?? "",
      options.activeTrack.nativeStart ?? "",
      options.activeTrack.nativeEnd ?? "",
      options.activeTrack.cdReadQuality ?? "high",
    ].join("\u0000");
    nativeLoadSequenceRef.current += 1;
    nativeLoadedUrlRef.current = nextLoadKey;
    preloadKeyRef.current = null;
    options.pendingSeekRef.current = 0;
    commitPlaybackTime(0, true);

    try {
      const state = await nativeAudio.load?.({
        trackId: options.activeTrack.id,
        url: activeStreamUrl,
        position: 0,
        paused: false,
        volume: options.volume,
        exclusive: options.audioOutputMode === "exclusive",
        deviceId: selectedSinkId,
        nativeDevice: options.activeTrack.nativeDevice ?? null,
        startChapter: options.activeTrack.nativeStart ?? null,
        endChapter: options.activeTrack.nativeEnd ?? null,
        cdReadQuality: options.activeTrack.cdReadQuality ?? "high",
        normalizationEnabled: options.normalizationEnabled,
      });
      if (state) syncNativeAudioState(state as NativeAudioState);
      return true;
    } catch {
      nativeLoadedUrlRef.current = null;
      setNativePlaybackFailed(true);
      return false;
    }
  });

  useEffect(() => {
    if (!audioSourceRef.current && (
      !options.playing || !audioElementStreamUrl ||
      (!options.pageVisible && !options.normalizationEnabled) ||
      (nativePlaybackEnabled && !options.analyserEnabled)
    )) {
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = audioContextRef.current ?? new AudioContextClass();
    audioContextRef.current = context;
    if (!nativePlaybackEnabled) {
      const outputContext = context as AudioContext & { setSinkId?: (id: string) => Promise<void> };
      outputContext.setSinkId?.(selectedSinkId === "default" ? "" : selectedSinkId).catch(() => setSelectedSinkId("default"));
    }
    if (!nativePlaybackEnabled && options.normalizationEnabled && !normalizerRef.current && !normalizerLoadRef.current) {
      if (!context.audioWorklet) {
        setNormalizationError("当前输出环境不支持音量标准化，请使用 WASAPI 输出。" );
      } else {
        const load = context.audioWorklet.addModule(loudnessProcessorUrl).then(() => {
          if (audioContextRef.current !== context) return;
          normalizerRef.current = new AudioWorkletNode(context, "aria-loudness");
          setNormalizerReady(true);
        }).catch(() => {
          if (audioContextRef.current === context) setNormalizationError("音量标准化加载失败，请重新打开播放器。" );
        });
        normalizerLoadRef.current = load;
      }
    }
    if (!audioSourceRef.current) {
      try {
        audioSourceRef.current = context.createMediaElementSource(audio);
      } catch {
        return;
      }
      analyserRef.current = context.createAnalyser();
      configureSpectrumAnalyser(analyserRef.current);
      audioSourceRef.current.connect(analyserRef.current);
    }

    if (options.playing) void context.resume();
    const analyser = analyserRef.current;
    if (!analyser) return;
    configureSpectrumAnalyser(analyser);
    const outputGain = outputGainRef.current ?? context.createGain();
    outputGainRef.current = outputGain;
    outputGain.gain.setTargetAtTime(options.volume / 100, context.currentTime, 0.03);

    const desiredOutputMode = nativePlaybackEnabled ? "silent" : options.normalizationEnabled && normalizerRef.current ? "normalized" : "audible";
    if (analyserOutputModeRef.current !== desiredOutputMode) {
      try {
        analyser.disconnect();
      } catch {
        // Ignore graph cleanup errors; reconnect below.
      }
      try {
        nativeSilenceGainRef.current?.disconnect();
      } catch {
        // The silent sink may already be disconnected.
      }
      normalizerRef.current?.disconnect();
      outputGain.disconnect();

      if (nativePlaybackEnabled) {
        const silentGain = nativeSilenceGainRef.current ?? context.createGain();
        silentGain.gain.value = 0;
        nativeSilenceGainRef.current = silentGain;
        analyser.connect(silentGain);
        silentGain.connect(context.destination);
      } else if (desiredOutputMode === "normalized" && normalizerRef.current) {
        analyser.connect(normalizerRef.current);
        normalizerRef.current.connect(outputGain);
        outputGain.connect(context.destination);
      } else {
        analyser.connect(outputGain);
        outputGain.connect(context.destination);
      }
      analyserOutputModeRef.current = desiredOutputMode;
    }
    if (nativePlaybackEnabled) {
      audio.muted = false;
      audio.volume = 1;
    } else {
      audio.volume = 1;
    }
  }, [
    audioElementStreamUrl,
    options.activeTrack.id,
    nativePlaybackEnabled,
    options.analyserEnabled,
    options.pageVisible,
    options.playing,
    options.normalizationEnabled,
    normalizerReady,
    options.volume,
    selectedSinkId,
  ]);

  useEffect(() => {
    normalizerRef.current?.port.postMessage("reset");
  }, [options.activeTrack.id, normalizerReady]);

  useEffect(() => {
    return () => {
      try {
        audioSourceRef.current?.disconnect();
      } catch {
        // Ignore audio graph shutdown errors.
      }
      try {
        analyserRef.current?.disconnect();
      } catch {
        // Ignore audio graph shutdown errors.
      }
      try {
        nativeSilenceGainRef.current?.disconnect();
      } catch {
        // Ignore audio graph shutdown errors.
      }
      audioSourceRef.current = null;
      analyserRef.current = null;
      nativeSilenceGainRef.current = null;
      normalizerRef.current?.disconnect();
      normalizerRef.current = null;
      normalizerLoadRef.current = null;
      outputGainRef.current?.disconnect();
      outputGainRef.current = null;
      analyserOutputModeRef.current = null;
      audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, []);

  function handleAudioError() {
    if (nativePlaybackEnabled) return;
    if (!activeStreamUrl || !options.playing) return;

    const now = Date.now();
    const previous = audioErrorRef.current;
    const nextCount = now - previous.lastAt > 6000 ? 1 : previous.count + 1;
    audioErrorRef.current = { count: nextCount, lastAt: now };

    if (nextCount >= 3 || !options.hasMultipleQueueTracks) {
      options.setPlaying(() => false);
      return;
    }

    window.setTimeout(() => options.pickRelativeTrack(1), 650);
  }

  function resetAudioError() {
    audioErrorRef.current = { count: 0, lastAt: 0 };
  }

  return {
    audioRef,
    analyserRef,
    audioOutputDevices,
    nativeAudioSupported,
    nativeAudioState,
    selectedSinkId,
    setSelectedSinkId,
    nativePlaybackFailed,
    nativePlaybackRequested,
    nativePlaybackEnabled,
    restartNativeTrack,
    seekNativeTrack,
    activeStreamUrl,
    audioElementStreamUrl,
    handleAudioError,
    resetAudioError,
    normalizationError,
  };
}
