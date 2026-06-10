import React, { useCallback, useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { useDictation } from '../../hooks/useDictation';
import { useAppStore } from '../../store/useAppStore';
import { invoke } from '@tauri-apps/api/core';
import { motion, PanInfo } from 'framer-motion';



export const DictationButton: React.FC = () => {
  const activeTerminalId = useAppStore((state) => state.activeTerminalId);
  const addToast = useAppStore((state) => state.addToast);
  const dictationButtonPosition = useAppStore((state) => state.dictationButtonPosition);
  const setDictationButtonPosition = useAppStore((state) => state.setDictationButtonPosition);
  const dragRef = useRef<HTMLDivElement>(null);
  // Track whether the user actually dragged so we don't fire a toggle on drag-end
  const didDragRef = useRef(false);

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

  const handleError = useCallback((errorStr: string) => {
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

  const { isListening, toggleListening, interimTranscript } = useDictation({ onResult: handleResult, onError: handleError });

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
          backgroundColor: isListening ? 'var(--bg-main)' : 'var(--bg-sidebar)',
          border: `1px solid ${isListening ? 'var(--accent)' : 'var(--border-inactive)'}`,
          color: isListening ? 'var(--accent)' : 'var(--text-inactive)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'inherit',
          boxShadow: isListening ? '0 0 12px var(--accent)' : '0 4px 6px rgba(0,0,0,0.3)',
          transition: 'background-color 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s',
          outline: 'none',
        }}
        title="Dictate to Terminal (Web Speech API)"
      >
        {isListening ? (
          <motion.div
            animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Mic size={24} />
          </motion.div>
        ) : (
          <MicOff size={24} />
        )}
      </button>

      {isListening && interimTranscript && (
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
          {interimTranscript}
        </motion.div>
      )}
    </motion.div>
  );
};
