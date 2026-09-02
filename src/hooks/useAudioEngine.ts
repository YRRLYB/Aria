import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { Track } from "@/data/music";
import type { NativeAudioState } from "@/lib/audioTypes";
import { api } from "@/lib/api";
import { commitPlaybackTime, getPlaybackTime } from "@/lib/playbackClock";
import { configureSpectrumAnalyser } from "@/lib/spectrumEngine";
import { readCachedAudioSettings, writeCachedAudioSettings, type AudioOutputMode, type QualityLevel } from "@/lib/playerPresentation";

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
  audioOutputMode: AudioOutputMode;
  pageVisible: boolean;
  analyserEnabled: boolean;
  pendingSeekRef: { current: number };
  setPlaying: (updater: (playing: boolean) => boolean) => void;
  setDurationSeconds: (seconds: number) => void;
  exclusiveMode: boolean;
  handleTrackEnded: () => void;
  pickRelativeTrack: (direction: 1 | -1) => void;
  hasMultipleQueueTracks: boolean;
}) {
  const activeTrack = options.activeTrack;
  const [audioOutputDevices, setAudioOutputDevices] = useState<Array<{ id: string; label: string }>>([]);
  const [nativeAudioSupported, setNativeAudioSupported] = useState(() => Boolean(window.ariaDesktop?.nativeAudio?.supported));
  const [nativeAudioState, setNativeAudioState] = useState<NativeAudioState | null>(null);
  const [selectedSinkId, setSelectedSinkId] = useState(() => readCachedAudioSettings().sinkId ?? "default");
  const [nativePlaybackFailed, setNativePlaybackFailed] = useState(false);
  const [nativeAnalyserWakeToken, setNativeAnalyserWakeToken] = useState(0);

  // Keep both WASAPI modes on the native mpv path.  Chromium's media element
  // is retained only as a muted analyser source, so selecting shared output
  // never silently downgrades a lossless stream to browser playback.
  const nativePlaybackRequested = Boolean(
    nativeAudioSupported && (options.audioOutputMode !== "system" || activeTrack.requiresNativePlayback),
  );
  const nativePlaybackEnabled = Boolean(nativePlaybackRequested && !nativePlaybackFailed);

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
  const analyserOutputModeRef = useRef<"audible" | "silent" | null>(null);
  const nativeLoadedUrlRef = useRef<string | null>(null);
  const nativeAnalyserDelayUntilRef = useRef(0);
  const nativeLoadSequenceRef = useRef(0);
  const lastNativeRenderRef = useRef({ at: 0, position: 0 });
  const audioErrorRef = useRef({ count: 0, lastAt: 0 });

  const syncNativeAudioState = useEffectEvent((state: NativeAudioState) => {
    const now = performance.now();
    const previousNativeRender = lastNativeRenderRef.current;
    const shouldRenderNativeState =
      state.kind !== "progress" ||
      now - previousNativeRender.at > 500 ||
      Math.abs((state.position ?? 0) - previousNativeRender.position) > 0.8;
    if (shouldRenderNativeState) {
      lastNativeRenderRef.current = { at: now, position: state.position ?? previousNativeRender.position };
      setNativeAudioState(state);
    }
    const currentTrackMatches = Boolean(state.trackId && state.trackId === options.activeTrackId);
    const shouldSyncPlayback =
      currentTrackMatches &&
      (state.active ||
        state.kind === "loading" ||
        state.kind === "loaded" ||
        state.kind === "pause" ||
        state.kind === "seek" ||
        state.kind === "progress" ||
        state.kind === "ended");

    if (shouldSyncPlayback) {
      if (typeof state.duration === "number" && state.duration > 0) {
        options.setDurationSeconds(state.duration);
      }
      if (typeof state.position === "number") {
        commitPlaybackTime(state.position, state.kind === "loaded" || state.kind === "seek" || state.kind === "ended");
      }
      if (state.kind === "pause" && typeof state.paused === "boolean") {
        options.setPlaying(() => !state.paused);
      }
    }
    if (state.kind === "ended" && currentTrackMatches && nativePlaybackEnabled) {
      options.handleTrackEnded();
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
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativePlaybackEnabled) return;
    const audio = audioRef.current as (HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> }) | null;
    if (!audio?.setSinkId) return;
    audio.setSinkId(selectedSinkId === "default" ? "" : selectedSinkId).catch(() => {
      // Device switching is optional; keep current output if the platform rejects it.
    });
  }, [nativePlaybackEnabled, selectedSinkId]);

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (nativeAudio?.supported) {
      nativeAudio
        .isSupported?.()
        .then((supported) => {
          setNativeAudioSupported(Boolean(supported));
          if (!supported) return [];
          return nativeAudio.listDevices?.() ?? [];
        })
        .then((devices) => {
          if (Array.isArray(devices) && devices.length) {
            setAudioOutputDevices(devices);
          }
        })
        .catch(() => {
          setNativeAudioSupported(false);
        });
      return;
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
  }, []);

  useEffect(() => {
    writeCachedAudioSettings({
      sinkId: selectedSinkId,
      hifiEnabled: options.hifiEnabled,
      exclusiveMode: options.exclusiveMode,
      outputMode: options.audioOutputMode,
    });
  }, [options.audioOutputMode, options.exclusiveMode, options.hifiEnabled, selectedSinkId]);

  useEffect(() => {
    setNativePlaybackFailed(false);
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
    audio.volume = nativePlaybackEnabled ? (nativeAnalyserBridgeReady ? 1 : 0) : Math.max(0, Math.min(1, options.volume / 100));
    audio.preload = nativePlaybackEnabled ? (nativeAnalyserReady ? "auto" : "none") : options.hifiEnabled ? "auto" : "metadata";

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
      options.setDurationSeconds(0);
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
    if (!nativePlaybackEnabled) return;
    const audio = audioRef.current;
    if (!audio) return;
    const desiredTime = nativeAudioState?.position;
    if (!Number.isFinite(desiredTime)) return;
    if (Math.abs((audio.currentTime || 0) - (desiredTime ?? 0)) < 0.45) return;
    audio.currentTime = Math.max(0, desiredTime ?? 0);
  }, [nativeAudioState?.position, nativePlaybackEnabled]);

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativeAudio?.supported) return;
    if (nativePlaybackEnabled) return;
    nativeLoadedUrlRef.current = null;
    nativeAudio.stop?.().catch(() => undefined);
  }, [nativePlaybackEnabled]);

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

    const nextUrl = activeStreamUrl;
    const nextLoadKey = [
      nextUrl,
      options.activeTrack.nativeDevice ?? "",
      options.activeTrack.nativeStart ?? "",
      options.activeTrack.nativeEnd ?? "",
      options.activeTrack.cdReadQuality ?? "high",
    ].join("\u0000");
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
      })
      .then((state) => {
        if (cancelled || nativeLoadSequenceRef.current !== loadSequence) return;
        if (state) syncNativeAudioState(state as NativeAudioState);
      })
      .catch(() => {
        if (cancelled || nativeLoadSequenceRef.current !== loadSequence) return;
        nativeLoadedUrlRef.current = null;
        setNativePlaybackFailed(true);
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
    nativeAudioState?.trackId,
    options.exclusiveMode,
    options.volume,
    options.playing,
    selectedSinkId,
    syncNativeAudioState,
  ]);

  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativePlaybackEnabled || !nativeAudio?.supported) return;
    nativeAudio.setPaused?.(!options.playing).catch(() => undefined);
  }, [nativePlaybackEnabled, options.playing]);
  useEffect(() => {
    const nativeAudio = window.ariaDesktop?.nativeAudio;
    if (!nativePlaybackEnabled || !nativeAudio?.supported) return;
    nativeAudio.setVolume?.(options.volume).catch(() => undefined);
  }, [nativePlaybackEnabled, options.volume]);

  useEffect(() => {
    if (
      !options.playing ||
      !audioElementStreamUrl ||
      !options.pageVisible ||
      (nativePlaybackEnabled && !options.analyserEnabled)
    ) {
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

    void context.resume();
    const analyser = analyserRef.current;
    if (!analyser) return;
    configureSpectrumAnalyser(analyser);

    const desiredOutputMode = nativePlaybackEnabled ? "silent" : "audible";
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

      if (nativePlaybackEnabled) {
        const silentGain = nativeSilenceGainRef.current ?? context.createGain();
        silentGain.gain.value = 0;
        nativeSilenceGainRef.current = silentGain;
        analyser.connect(silentGain);
        silentGain.connect(context.destination);
      } else {
        analyser.connect(context.destination);
      }
      analyserOutputModeRef.current = desiredOutputMode;
    }
    if (nativePlaybackEnabled) {
      audio.muted = false;
      audio.volume = 1;
    }
  }, [
    audioElementStreamUrl,
    options.activeTrack.id,
    nativePlaybackEnabled,
    options.analyserEnabled,
    options.pageVisible,
    options.playing,
  ]);

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
    activeStreamUrl,
    audioElementStreamUrl,
    handleAudioError,
    resetAudioError,
  };
}
