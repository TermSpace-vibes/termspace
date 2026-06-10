const fs = require('fs');
const file = 'src/components/WorkspaceView/NativeTerminalPane.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. Fix refs
code = code.replace(
  "const cellsRef = useRef<SnapshotCell[]>([])",
  "const cellsRef = useRef<Uint32Array>(new Uint32Array())"
);
code = code.replace(
  "const scrollbarThumbRef = useRef<HTMLDivElement>(null)",
  `const scrollbarThumbRef = useRef<HTMLDivElement>(null)
  
  // Smooth caret animation state
  const animatedCursorRef = useRef({ col: 0, row: 0, lastTime: 0, lastDisplayOffset: 0 })
  const isAnimatingCursorRef = useRef(false)
  
  // ── 120fps Smooth Scrolling State ──────────────────────────────────────────
  const visualOffsetRef = useRef(0)
  const backendOffsetRef = useRef(0)
  const lastDisplayOffsetRef = useRef(0)
  const lastWheelTimeRef = useRef(0)
  const pendingScrollDeltaRef = useRef(0)`
);

// 2. Fix listen callback
code = code.replace(
  "cellsRef.current = snap.cells",
  `const rawStr = atob(snap.cells_b64 ?? (snap as any).cellsB64 ?? '')
      const u8 = new Uint8Array(rawStr.length)
      for (let i = 0; i < rawStr.length; i++) {
        u8[i] = rawStr.charCodeAt(i)
      }
      cellsRef.current = new Uint32Array(u8.buffer)`
);

code = code.replace(
  "col: snap.cursorCol,",
  "col: snap.cursorCol ?? (snap as any).cursor_col,"
).replace(
  "row: snap.cursorRow,",
  "row: snap.cursorRow ?? (snap as any).cursor_row,"
).replace(
  "visible: snap.cursorVisible,",
  "visible: snap.cursorVisible ?? (snap as any).cursor_visible,"
);

code = code.replace(
  "if (snap.cwd && snap.cwd !== cwdRef.current) {",
  `isAlternateRef.current = snap.isAlternate ?? (snap as any).is_alternate ?? false
      displayOffsetRef.current = snap.displayOffset ?? (snap as any).display_offset ?? 0
      totalHistoryRef.current = snap.totalHistory ?? (snap as any).total_history ?? 0

      if (snap.cwd && snap.cwd !== cwdRef.current) {`
);

// 3. Fix scheduleRender
code = code.replace(
  "rendererRef.current.render(",
  `if (scrollbarThumbRef.current) {
        const total = totalHistoryRef.current
        const offset = displayOffsetRef.current
        const rows = rowsRef.current
        if (total > 0 && !isAlternateRef.current) {
          scrollbarThumbRef.current.style.display = 'block'
          const pctHeight = Math.max(1, (rows / (total + rows)) * 100)
          const pctBottom = (offset / (total + rows)) * 100
          scrollbarThumbRef.current.style.height = \`\${pctHeight}%\`
          scrollbarThumbRef.current.style.bottom = \`\${pctBottom}%\`
        } else {
          scrollbarThumbRef.current.style.display = 'none'
        }
      }

      // --- Cursor Animation Logic ---
      const target = cursorRef.current;
      const anim = animatedCursorRef.current;
      
      if (anim.lastTime === 0) anim.lastTime = time;
      const dt = Math.min((time - anim.lastTime) / 1000, 0.1);
      anim.lastTime = time;

      const SPEED = 25.0;
      
      // Teleport condition: line wraps, enters, or scroll changes
      const rowChanged = Math.abs(target.row - anim.row) >= 0.5;
      const colChangedALot = Math.abs(target.col - anim.col) > 5;
      const smoothCaretEnabled = useAppStore.getState().settings.smoothCaret ?? true;
      
      if (!smoothCaretEnabled || anim.lastDisplayOffset !== displayOffsetRef.current || (rowChanged && colChangedALot)) {
         anim.col = target.col;
         anim.row = target.row;
      } else {
         anim.col += (target.col - anim.col) * (1.0 - Math.exp(-SPEED * dt));
         anim.row += (target.row - anim.row) * (1.0 - Math.exp(-SPEED * dt));
      }
      anim.lastDisplayOffset = displayOffsetRef.current;

      if (smoothCaretEnabled && (Math.abs(anim.col - target.col) > 0.01 || Math.abs(anim.row - target.row) > 0.01)) {
         isAnimatingCursorRef.current = true;
      } else {
         anim.col = target.col;
         anim.row = target.row;
         isAnimatingCursorRef.current = false;
         anim.lastTime = 0;
      }
      
      const renderCursor = { ...target, col: anim.col, row: anim.row };

      rendererRef.current.render(`
);

code = code.replace(
  "cursorRef.current,",
  "renderCursor,"
);

code = code.replace(
  "highlightsRef.current,\n      )",
  `highlightsRef.current,
        selectionRef.current,
      )

      if (isAnimatingCursorRef.current) {
        scheduleRender()
      }`
);

// 4. Mouse Selection and getSelectedText
const selectionCode = `
  const getCellCoords = useCallback((e: MouseEvent | React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { row: 0, col: 0 }
    const col = Math.max(0, Math.min(colsRef.current, Math.floor((e.clientX - rect.left) / cellWRef.current)))
    const row = Math.max(0, Math.min(rowsRef.current - 1, Math.floor((e.clientY - rect.top) / cellHRef.current)))
    return { row, col }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const { row, col } = getCellCoords(e)
    selectionRef.current = { startRow: row, startCol: col, endRow: row, endCol: col }
    isDraggingRef.current = true
    scheduleRender()
  }, [getCellCoords, scheduleRender])

  useEffect(() => {
    const handleWinMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !selectionRef.current) return
      const { row, col } = getCellCoords(e)
      selectionRef.current.endRow = row
      selectionRef.current.endCol = col
      scheduleRender()
    }

    const handleWinMouseUp = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      const { row, col } = getCellCoords(e)
      if (selectionRef.current) {
        selectionRef.current.endRow = row
        selectionRef.current.endCol = col
        if (selectionRef.current.startRow === selectionRef.current.endRow && 
            selectionRef.current.startCol === selectionRef.current.endCol) {
          selectionRef.current = null
        }
      }
      scheduleRender()
    }

    window.addEventListener('mousemove', handleWinMouseMove)
    window.addEventListener('mouseup', handleWinMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleWinMouseMove)
      window.removeEventListener('mouseup', handleWinMouseUp)
    }
  }, [getCellCoords, scheduleRender])
`;

code = code.replace("// ── Title editing", selectionCode + "\n\n  // ── Title editing");

const getSelectedTextCode = `
/**
 * Extracts the text content from a rectangular selection.
 */
function getSelectedText(cells: Uint32Array, cols: number, rows: number, selection: SelectionRange | null): string {
  if (!selection) return ''
  let r1 = selection.startRow, c1 = selection.startCol
  let r2 = selection.endRow, c2 = selection.endCol
  if (r1 > r2 || (r1 === r2 && c1 > c2)) {
    r1 = selection.endRow; c1 = selection.endCol
    r2 = selection.startRow; c2 = selection.startCol
  }
  r1 = Math.max(0, Math.min(rows - 1, r1))
  r2 = Math.max(0, Math.min(rows - 1, r2))

  const lines: string[] = []
  for (let r = r1; r <= r2; r++) {
    let sc = (r === r1) ? c1 : 0
    let ec = (r === r2) ? c2 : cols
    sc = Math.max(0, Math.min(cols, sc))
    ec = Math.max(0, Math.min(cols, ec))

    let line = ''
    for (let c = sc; c < ec; c++) {
      const ci = r * cols + c;
      const ch_u32 = cells[ci * 4];
      if (ch_u32 && ch_u32 !== 0 && ch_u32 !== 32) {
        line += String.fromCodePoint(ch_u32);
      } else {
        line += ' ';
      }
    }
    // Trim trailing spaces for intermediate lines or if selection goes to the end
    if (r < r2 || ec === cols) {
      line = line.replace(/\\s+$/, '')
    }
    lines.push(line)
  }
  return lines.join('\\n')
}
`;

code = code.replace("function keyEventToData(e: React.KeyboardEvent): string | null {", getSelectedTextCode + "\n\nfunction keyEventToData(e: React.KeyboardEvent): string | null {");

// 5. Replace handleWheel completely
const wheelRegex = /const handleWheel = useCallback\(\(e: React\.WheelEvent<HTMLCanvasElement>\) => \{[\s\S]*?\}, \[terminalId\]\)/;
const newWheelCode = `const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (Math.abs(e.deltaY) < 1) return
    
    let physicalDelta = 0
    if (e.deltaMode === 1) physicalDelta = -e.deltaY * cellHRef.current
    else if (e.deltaMode === 2) physicalDelta = -e.deltaY * rowsRef.current * cellHRef.current
    else physicalDelta = -e.deltaY

    visualOffsetRef.current += physicalDelta
    backendOffsetRef.current += physicalDelta
    lastWheelTimeRef.current = performance.now()

    const maxVisual = cellHRef.current * 3
    if (visualOffsetRef.current > maxVisual) visualOffsetRef.current = maxVisual
    if (visualOffsetRef.current < -maxVisual) visualOffsetRef.current = -maxVisual

    if (canvasRef.current) {
      canvasRef.current.style.transform = \`translateY(\${-visualOffsetRef.current}px)\`
    }

    const lineThreshold = cellHRef.current > 0 ? cellHRef.current : 20
    if (Math.abs(backendOffsetRef.current) >= lineThreshold) {
      const lines = Math.trunc(backendOffsetRef.current / lineThreshold)
      backendOffsetRef.current -= lines * lineThreshold
      pendingScrollDeltaRef.current += lines 
    }
  }, [terminalId])

  // ── Smooth scroll decay loop ───────────────────────────────────────────────
  useEffect(() => {
    let handle: number
    const tick = () => {
      if (pendingScrollDeltaRef.current !== 0) {
        invoke('scroll_terminal', { terminalId, delta: pendingScrollDeltaRef.current }).catch(console.error)
        pendingScrollDeltaRef.current = 0
      }

      const now = performance.now()
      if (now - lastWheelTimeRef.current > 100) {
        if (Math.abs(visualOffsetRef.current) > 0.5) {
          visualOffsetRef.current *= 0.8
          if (canvasRef.current) {
            canvasRef.current.style.transform = \`translateY(\${-visualOffsetRef.current}px)\`
          }
        } else if (visualOffsetRef.current !== 0) {
          visualOffsetRef.current = 0
          if (canvasRef.current) {
            canvasRef.current.style.transform = \`translateY(0px)\`
          }
        }
      }
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [terminalId])`;
  
code = code.replace(wheelRegex, newWheelCode);

code = code.replace(
  "if (e.key === 'PageUp') {",
  `if (e.key === 'PageUp') {
      e.preventDefault()
      invoke('scroll_terminal', { terminalId, delta: 1 }).catch(console.error)
      return
    }`
);
code = code.replace(
  "if (e.key === 'PageDown') {",
  `if (e.key === 'PageDown') {
      e.preventDefault()
      invoke('scroll_terminal', { terminalId, delta: -1 }).catch(console.error)
      return
    }`
);

// add SelectionRange to imports
if (!code.includes("SelectionRange")) {
  code = code.replace("SearchMatch,", "SearchMatch, SelectionRange,");
}

fs.writeFileSync(file, code);
