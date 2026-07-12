import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { invoke } from '@tauri-apps/api/core';

// Extend Window interface for TypeScript
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export type DictationErrorKind =
  | 'micBlocked'
  | 'modelNeeded'
  | 'apiKeyNeeded'
  | 'transient'
  | 'unknown'

export interface DictationError {
  kind: DictationErrorKind;
  message: string;
}

export type DictationLifecycleStatus = 'starting' | 'listening' | 'processing' | 'idle'

interface UseDictationProps {
  onResult: (text: string) => void | Promise<void>;
  onEmpty?: () => void;
  onError?: (error: DictationError) => void;
  onLifecycleChange?: (status: DictationLifecycleStatus) => void;
  onStateChange?: (state: { isListening: boolean; isProcessing: boolean }) => void;
  onAudioLevels?: (levels: number[]) => void;
  listenForGlobalToggle?: boolean;
}

const AUDIO_LEVEL_BAND_COUNT = 7;
const AUDIO_LEVEL_UPDATE_INTERVAL_MS = 66;

interface DictationModelStatus {
  state: string;
  source: string | null;
  downloadedPath: string | null;
  bundledPath: string | null;
  sizeBytes: number | null;
  expectedSizeBytes: number;
  error: string | null;
}

function classifyDictationError(message: string, fallback: DictationErrorKind = 'unknown'): DictationErrorKind {
  if (/api key/i.test(message)) return 'apiKeyNeeded';
  if (/model|transcription model|download the transcription/i.test(message)) return 'modelNeeded';
  if (/microphone|mic|permission|denied|not-allowed|notallowed/i.test(message)) return 'micBlocked';
  if (/network|timeout|temporar|try again|provider|request/i.test(message)) return 'transient';
  return fallback;
}

function toDictationError(error: unknown, fallback: DictationErrorKind = 'unknown'): DictationError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: classifyDictationError(message, fallback),
    message,
  };
}

export function useDictation({
  onResult,
  onEmpty,
  onError,
  onLifecycleChange,
  onStateChange,
  onAudioLevels,
  listenForGlobalToggle = true,
}: UseDictationProps) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState<string>('');

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelsRafRef = useRef<number | null>(null);
  const onAudioLevelsRef = useRef(onAudioLevels);
  onAudioLevelsRef.current = onAudioLevels;

  const audioDataRef = useRef<number[]>([]);
  const isListeningRef = useRef(false);
  const startGenerationRef = useRef(0);

  const stopLevelMeter = useCallback(() => {
    if (levelsRafRef.current != null) {
      cancelAnimationFrame(levelsRafRef.current);
      levelsRafRef.current = null;
    }
    analyserRef.current = null;
    onAudioLevelsRef.current?.(new Array(AUDIO_LEVEL_BAND_COUNT).fill(0));
  }, []);

  const startLevelMeter = useCallback((analyser: AnalyserNode) => {
    analyserRef.current = analyser;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const bandsPerBar = Math.max(1, Math.floor(bins.length / AUDIO_LEVEL_BAND_COUNT));
    let lastUpdate = 0;

    const tick = (time: number) => {
      if (!analyserRef.current) return;
      if (time - lastUpdate >= AUDIO_LEVEL_UPDATE_INTERVAL_MS) {
        lastUpdate = time;
        analyser.getByteFrequencyData(bins);
        const levels: number[] = [];
        for (let bar = 0; bar < AUDIO_LEVEL_BAND_COUNT; bar++) {
          const start = bar * bandsPerBar;
          let sum = 0;
          for (let i = start; i < start + bandsPerBar; i++) {
            sum += bins[i] ?? 0;
          }
          levels.push(Math.min(1, (sum / bandsPerBar) / 255));
        }
        onAudioLevelsRef.current?.(levels);
      }
      levelsRafRef.current = requestAnimationFrame(tick);
    };

    levelsRafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopRecordingAndTranscribe = useCallback(async () => {
    isListeningRef.current = false;
    setIsListening(false);
    setIsProcessing(true);
    onStateChange?.({ isListening: false, isProcessing: true });
    onLifecycleChange?.('processing');
    setInterimTranscript('Processing transcription...');
    stopLevelMeter();

    const currentRate = audioContextRef.current ? audioContextRef.current.sampleRate : 16000;

    // Clean up Audio API
    if (processorRef.current && audioContextRef.current) {
      processorRef.current.disconnect();
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close();
    }
    
    streamRef.current = null;
    processorRef.current = null;
    audioContextRef.current = null;
    gainNodeRef.current = null;

    if (audioDataRef.current.length === 0) {
      setInterimTranscript('');
      setIsProcessing(false);
      audioDataRef.current = [];
      onEmpty?.();
      onStateChange?.({ isListening: false, isProcessing: false });
      onLifecycleChange?.('idle');
      return;
    }

    try {
      let finalAudioSamples = audioDataRef.current;
      
      // Resample down to 16000Hz if the browser ignored our sampleRate request (common in macOS WKWebView)
      if (currentRate !== 16000) {
        console.log(`Resampling from ${currentRate}Hz to 16000Hz`);
        const offlineCtx = new window.OfflineAudioContext(1, Math.ceil(audioDataRef.current.length * 16000 / currentRate), 16000);
        const buffer = offlineCtx.createBuffer(1, audioDataRef.current.length, currentRate);
        buffer.copyToChannel(new Float32Array(audioDataRef.current), 0);
        
        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(offlineCtx.destination);
        source.start();
        
        const renderedBuffer = await offlineCtx.startRendering();
        finalAudioSamples = Array.from(renderedBuffer.getChannelData(0));
      }

      const settings = useAppStore.getState().settings;
      const provider = settings.dictationProvider || 'local';
      
      let text = '';
      
      if (provider === 'local') {
        text = await invoke<string>('transcribe_chunk', { 
          audioSamples: finalAudioSamples,
          prompt: settings.dictationPrompt || null
        });
      } else {
        // Encode to WAV
        const sampleRate = 16000;
        const buffer = new ArrayBuffer(44 + finalAudioSamples.length * 2);
        const view = new DataView(buffer);
        
        const writeString = (offset: number, string: string) => {
          for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
          }
        };
        
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + finalAudioSamples.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, finalAudioSamples.length * 2, true);
        
        let offset = 44;
        for (let i = 0; i < finalAudioSamples.length; i++) {
          let s = Math.max(-1, Math.min(1, finalAudioSamples[i]));
          view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
          offset += 2;
        }
        
        const apiKey = settings.dictationApiKey || '';
        if (!apiKey) {
          throw new Error(`API key required for ${provider}`);
        }
        
        const endpoint = provider === 'groq' 
          ? 'https://api.groq.com/openai/v1/audio/transcriptions'
          : 'https://api.openai.com/v1/audio/transcriptions';
          
        const model = provider === 'groq' ? 'whisper-large-v3' : 'whisper-1';
        const bytes = Array.from(new Uint8Array(buffer));

        text = await invoke<string>('transcribe_openai', {
          audio: bytes,
          prompt: settings.dictationPrompt || null,
          apiKey,
          endpoint,
          model
        });
      }
      
      let formatted = text.trim();
      formatted = formatted.replace(/\bdash dash\b/gi, '--');
      formatted = formatted.replace(/\bdash\b/gi, '-');
      formatted = formatted.replace(/\bslash\b/gi, '/');
      formatted = formatted.replace(/\bdot\b/gi, '.');
      formatted = formatted.replace(/\basterisk\b/gi, '*');
      formatted = formatted.replace(/\bstar\b/gi, '*');
      // Remove common Whisper hallucination tags
      formatted = formatted.replace(/\[\s*blank_audio\s*\]/gi, '');
      formatted = formatted.replace(/\[\s*silence\s*\]/gi, '');
      formatted = formatted.replace(/\(\s*silence\s*\)/gi, '');
      formatted = formatted.replace(/<\/?[^>]+(>|$)/gi, ''); // remove HTML-like tags like </footer>
      formatted = formatted.replace(/♪/g, '');
      formatted = formatted.trim();

      if (/\b(execute|enter)$/.test(formatted)) {
        formatted = formatted.replace(/\s*\b(execute|enter)$/, '\r');
      } else if (formatted.length > 0) {
        formatted = formatted + ' '; // trailing space for continuous dictation
      }

      if (!formatted.trim()) {
        onEmpty?.();
      } else {
        await onResult(formatted);
      }
    } catch (e: any) {
      console.error('Transcription error', e);
      onError?.(toDictationError(e, 'transient'));
    }
    
    setInterimTranscript('');
    setIsProcessing(false);
    onStateChange?.({ isListening: false, isProcessing: false });
    onLifecycleChange?.('idle');
    audioDataRef.current = [];
  }, [onResult, onEmpty, onError, onLifecycleChange, onStateChange, stopLevelMeter]);

  const cancelPendingStart = useCallback(() => {
    if (isListeningRef.current) return;
    startGenerationRef.current += 1;
    setIsProcessing(false);
    setInterimTranscript('');
    onStateChange?.({ isListening: false, isProcessing: false });
    onLifecycleChange?.('idle');
  }, [onLifecycleChange, onStateChange]);

  const toggleListening = useCallback(async () => {
    if (isListeningRef.current) {
      await stopRecordingAndTranscribe();
      return;
    }

    const startGeneration = ++startGenerationRef.current;

    // Give immediate feedback the click registered — loading the local
    // whisper model (or waiting on the mic permission prompt) can take a
    // noticeable moment, and without this the button looked frozen/dead
    // for that whole stretch instead of visibly "starting up".
    setIsProcessing(true);
    onStateChange?.({ isListening: false, isProcessing: true });
    onLifecycleChange?.('starting');
    setInterimTranscript('Warming up model…');

    try {
      const provider = useAppStore.getState().settings.dictationProvider || 'local';
      if (provider === 'local') {
        const status = await invoke<DictationModelStatus>('get_dictation_model_status');
        console.info('Transcription backend selected:', {
          backend: 'local',
          modelState: status.state,
          modelPath: status.downloadedPath,
          modelExists: status.state === 'downloaded' || status.state === 'loaded',
          modelLoaded: status.state === 'loaded',
          isDownloadedModelPath: status.source === 'downloaded',
          isBundledModelPath: false,
          isFallbackPath: false,
        });

        if (status.state === 'missing') {
          throw new Error('Download the transcription model first.');
        }
        if (status.state === 'corrupted') {
          throw new Error(status.error || 'Downloaded transcription model is corrupted. Re-download it from Settings.');
        }
        if (status.state !== 'loaded') {
          const loadedStatus = await invoke<DictationModelStatus>('load_dictation_model');
          console.info('Transcription local model loaded:', {
            modelState: loadedStatus.state,
            modelPath: loadedStatus.downloadedPath,
            modelLoaded: loadedStatus.state === 'loaded',
          });
        }
        if (startGeneration !== startGenerationRef.current) return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (startGeneration !== startGenerationRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const context = new window.AudioContext({ sampleRate: 16000 });
      const source = context.createMediaStreamSource(stream);
      
      const processor = context.createScriptProcessor(4096, 1, 1);
      const gainNode = context.createGain();
      gainNode.gain.value = 0; // Prevent feedback loops

      audioDataRef.current = []; // reset
      setIsProcessing(false);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // We must copy the array because inputData is just a view that gets reused
        for (let i = 0; i < inputData.length; i++) {
          audioDataRef.current.push(inputData[i]);
        }
      };

      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.6;

      source.connect(processor);
      source.connect(analyser);
      processor.connect(gainNode);
      gainNode.connect(context.destination);

      audioContextRef.current = context;
      streamRef.current = stream;
      processorRef.current = processor;
      gainNodeRef.current = gainNode;
      startLevelMeter(analyser);

      isListeningRef.current = true;
      setIsListening(true);
      onStateChange?.({ isListening: true, isProcessing: false });
      onLifecycleChange?.('listening');
      setInterimTranscript('Listening...');
      const providerName = provider === 'openai' ? 'OpenAI' : provider === 'groq' ? 'Groq' : 'Local';
      useAppStore.getState().addToast(`${providerName} Dictation started.`, 'success');

    } catch (err: any) {
      if (startGeneration !== startGenerationRef.current) return;
      console.error('Mic error:', err);
      setIsProcessing(false);
      setInterimTranscript('');
      onStateChange?.({ isListening: false, isProcessing: false });
      const dictationError = toDictationError(err, 'micBlocked');
      if (dictationError.kind === 'micBlocked') {
        onError?.({
          kind: 'micBlocked',
          message: 'Microphone access denied or error occurred.',
        });
      } else {
        onError?.(dictationError);
      }
    }
  }, [stopRecordingAndTranscribe, onError, onLifecycleChange, onStateChange, startLevelMeter]);

  useEffect(() => {
    if (!listenForGlobalToggle) return;

    const handleGlobalToggle = () => toggleListening();
    window.addEventListener('termspace:toggle-dictation', handleGlobalToggle as EventListener);
    return () => window.removeEventListener('termspace:toggle-dictation', handleGlobalToggle as EventListener);
  }, [toggleListening, listenForGlobalToggle]);

  return { isListening, isProcessing, toggleListening, cancelPendingStart, mediaStream: streamRef.current, interimTranscript };
}
