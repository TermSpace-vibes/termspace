import React, { useCallback, useRef } from 'react';
import { AudioLines } from 'lucide-react';
import { useDictation, type DictationError } from '../../hooks/useDictation';
import { useAppStore } from '../../store/useAppStore';
import { invoke } from '@tauri-apps/api/core';
import { motion, PanInfo } from 'framer-motion';



export const DictationButton: React.FC = () => {
  const activeTerminalId = useAppStore((state) => state.activeTerminalId);
  const addToast = useAppStore((state) => state.addToast);
  const settings = useAppStore((state) => state.settings);
  const dictationButtonPosition = useAppStore((state) => state.dictationButtonPosition);
  const setDictationButtonPosition = useAppStore((state) => state.setDictationButtonPosition);
  const dragRef = useRef<HTMLDivElement>(null);
  // Track whether the user actually dragged so we don't fire a toggle on drag-end
  const didDragRef = useRef(false);
  const [globalDictationState, setGlobalDictationState] = React.useState<{
    isListening: boolean;
    isProcessing: boolean;
    interimTranscript: string;
    toggleListening: () => void;
  } | null>(null);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<typeof globalDictationState>;
      setGlobalDictationState(customEvent.detail);
    };
    window.addEventListener('termspace:global-dictation-state', handler);
    return () => window.removeEventListener('termspace:global-dictation-state', handler);
  }, []);

  // Clamp position to ensure it stays on screen if window is resized
  const clampedPosition = React.useMemo(() => {
    if (!dictationButtonPosition) return undefined;
    return {
      x: Math.min(Math.max(0, dictationButtonPosition.x), window.innerWidth - 48),
      y: Math.min(Math.max(0, dictationButtonPosition.y), window.innerHeight - 48)
    };
  }, [dictationButtonPosition]);

  const handleResult = useCallback(async (text: string) => {
    if (!activeTerminalId) {
      addToast('No active terminal to dictate to.', 'error');
      return;
    }
    try {
      await invoke('write_terminal', { terminalId: activeTerminalId, data: text });
    } catch (e) {
      console.error('Failed to write dictation to PTY', e);
      addToast('Dictation failed to write to terminal.', 'error');
    }
  }, [activeTerminalId, addToast]);

  const handleError = useCallback((error: DictationError) => {
    const errorStr = error.message;
    if (errorStr.toLowerCase().includes('denied') || errorStr.toLowerCase().includes('not-allowed')) {
      addToast(
        'Microphone permission denied.',
        'error',
        {
          label: 'Open Settings',
          onClick: () => {
            invoke('open_mic_settings').catch(console.error);
          }
        }
      );
    } else {
      addToast(errorStr, 'error');
    }
  }, [addToast]);

  const terminalDictation = useDictation({
    onResult: handleResult,
    onError: handleError,
    listenForGlobalToggle: !settings.globalDictationEnabled,
  });
  const fallbackGlobalDictation = React.useMemo(() => ({
    isListening: false,
    isProcessing: false,
    interimTranscript: '',
    toggleListening: () => window.dispatchEvent(new CustomEvent('termspace:toggle-global-dictation')),
  }), []);
  const activeDictation = settings.globalDictationEnabled
    ? (globalDictationState || fallbackGlobalDictation)
    : terminalDictation;
  const { isListening, isProcessing, toggleListening, interimTranscript } = activeDictation;
  const isActive = isListening || isProcessing;
  const statusText = isProcessing ? 'Processing transcription...' : interimTranscript;
  const waveformBars = [12, 24, 16, 30, 20, 26, 14];

  return (
    <motion.div
      ref={dragRef}
      drag
      dragMomentum={false}
      // Keeps the button contained inside the window bounds
      dragConstraints={{ left: 0, top: 0, right: window.innerWidth - 48, bottom: window.innerHeight - 48 }}
      initial={clampedPosition || { x: window.innerWidth - 448, y: window.innerHeight - 72 }}
      onDragStart={() => { didDragRef.current = false; }}
      onDrag={(_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        // Mark as a real drag once the pointer moves more than 4px
        if (Math.abs(info.offset.x) > 4 || Math.abs(info.offset.y) > 4) {
          didDragRef.current = true;
        }
      }}
      onDragEnd={() => {
        if (dragRef.current) {
          const rect = dragRef.current.getBoundingClientRect();
          setDictationButtonPosition({ x: rect.left, y: rect.top });
        }
      }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 9999,
        cursor: 'grab',
      }}
      whileDrag={{ cursor: 'grabbing', scale: 1.05 }}
    >
      <button
        onClick={() => {
          // Don't toggle if the pointer moved — that was a drag, not a tap
          if (!didDragRef.current) toggleListening();
          didDragRef.current = false;
        }}
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          backgroundColor: isActive ? 'var(--bg-main)' : 'var(--bg-sidebar)',
          border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border-inactive)'}`,
          color: isActive ? 'var(--accent)' : 'var(--text-inactive)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'inherit',
          boxShadow: isActive ? '0 0 14px color-mix(in srgb, var(--accent) 62%, transparent)' : '0 4px 6px rgba(0,0,0,0.3)',
          transition: 'background-color 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s',
          outline: 'none',
        }}
        title={settings.globalDictationEnabled ? 'Dictate to Active App' : 'Dictate to Terminal'}
      >
        {isProcessing ? (
          <motion.div
            data-testid="dictation-processing-spinner"
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: '2px solid var(--text-dim)',
              borderTopColor: 'var(--accent)',
            }}
          />
        ) : isListening ? (
          <motion.div
            data-testid="dictation-waveform"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              height: 30,
            }}
          >
            {waveformBars.map((height, index) => (
              <motion.span
                key={`${height}-${index}`}
                aria-hidden="true"
                animate={{
                  height: [Math.max(7, height * 0.45), height, Math.max(8, height * 0.62)],
                  opacity: [0.55, 1, 0.72],
                }}
                transition={{
                  repeat: Infinity,
                  duration: 0.68 + index * 0.045,
                  delay: index * 0.055,
                  ease: 'easeInOut',
                }}
                style={{
                  width: 3,
                  borderRadius: 999,
                  background: 'currentColor',
                  boxShadow: '0 0 8px color-mix(in srgb, var(--accent) 65%, transparent)',
                }}
              />
            ))}
          </motion.div>
        ) : (
          <AudioLines size={22} strokeWidth={2.25} />
        )}
      </button>

      {isActive && statusText && (
        <motion.div
          initial={{ opacity: 0, y: 10, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            marginBottom: '12px',
            backgroundColor: 'var(--bg-sidebar)',
            border: '1px solid var(--accent)',
            padding: '6px 12px',
            borderRadius: '6px',
            color: 'var(--accent)',
            fontSize: '12px',
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        >
          {statusText}
        </motion.div>
      )}
    </motion.div>
  );
};
