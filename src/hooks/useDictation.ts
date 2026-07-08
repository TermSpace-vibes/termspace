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

interface UseDictationProps {
  onResult: (text: string) => void;
  onError?: (error: string) => void;
  listenForGlobalToggle?: boolean;
}

interface DictationModelStatus {
  state: string;
  source: string | null;
  downloadedPath: string | null;
  bundledPath: string | null;
  sizeBytes: number | null;
  expectedSizeBytes: number;
  error: string | null;
}

export function useDictation({ onResult, onError, listenForGlobalToggle = true }: UseDictationProps) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState<string>('');

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  
  const audioDataRef = useRef<number[]>([]);
  const isListeningRef = useRef(false);

  const stopRecordingAndTranscribe = useCallback(async () => {
    isListeningRef.current = false;
    setIsListening(false);
    setIsProcessing(true);
    setInterimTranscript('Processing transcription...');

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

      onResult(formatted);
    } catch (e: any) {
      console.error('Transcription error', e);
      if (onError) onError(e.toString());
    }
    
    setInterimTranscript('');
    setIsProcessing(false);
    audioDataRef.current = [];
  }, [onResult, onError]);

  const toggleListening = useCallback(async () => {
    if (isListeningRef.current) {
      await stopRecordingAndTranscribe();
      return;
    }

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
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

      source.connect(processor);
      processor.connect(gainNode);
      gainNode.connect(context.destination);

      audioContextRef.current = context;
      streamRef.current = stream;
      processorRef.current = processor;
      gainNodeRef.current = gainNode;

      isListeningRef.current = true;
      setIsListening(true);
      setInterimTranscript('Listening...');
      const providerName = provider === 'openai' ? 'OpenAI' : provider === 'groq' ? 'Groq' : 'Local';
      useAppStore.getState().addToast(`${providerName} Dictation started.`, 'success');
      
    } catch (err: any) {
      console.error('Mic error:', err);
      const message = err instanceof Error ? err.message : String(err);
      const isModelError = /model|transcription/i.test(message);
      if (onError) onError(isModelError ? message : 'Microphone access denied or error occurred.');
    }
  }, [stopRecordingAndTranscribe, onError]);

  useEffect(() => {
    if (!listenForGlobalToggle) return;

    const handleGlobalToggle = () => toggleListening();
    window.addEventListener('termspace:toggle-dictation', handleGlobalToggle as EventListener);
    return () => window.removeEventListener('termspace:toggle-dictation', handleGlobalToggle as EventListener);
  }, [toggleListening, listenForGlobalToggle]);

  return { isListening, isProcessing, toggleListening, mediaStream: streamRef.current, interimTranscript };
}
