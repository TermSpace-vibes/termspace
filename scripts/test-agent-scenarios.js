#!/usr/bin/env node

import { execSync } from 'child_process'
import { performance } from 'perf_hooks'

console.log('🤖 Termspace Agent Lifecycle Automated Scenario Verification')
console.log('===========================================================')

let allPassed = true

function runStep(name, fn) {
  process.stdout.write(`• ${name}... `)
  const start = performance.now()
  try {
    fn()
    const elapsed = (performance.now() - start).toFixed(1)
    console.log(`\x1b[32mPASS\x1b[0m (${elapsed}ms)`)
  } catch (err) {
    console.log(`\x1b[31mFAIL\x1b[0m`)
    console.error(err.message || err)
    allPassed = false
  }
}

// Scenario 1: Rust Engine Deterministic State Machine & Timing Tests
runStep('Rust backend agent state machine & path scoping unit tests', () => {
  execSync('cargo test test_detect_session_state', { cwd: 'src-tauri', stdio: 'pipe' })
  execSync('cargo test test_is_path_in_workspace', { cwd: 'src-tauri', stdio: 'pipe' })
})

// Scenario 2: Frontend Herdr-Style State Visuals & Transitions (Working, Needs Input, Done, Idle)
runStep('Frontend sidebar agent state rendering & interaction tests', () => {
  execSync('npx vitest run src/components/WorkspaceSidebar/AgentsSidebarSection.test.tsx', {
    stdio: 'pipe',
  })
})

// Scenario 3: Cross-Workspace Navigation & Terminal Focus Handshake
runStep('Workspace navigation and terminal focus on agent selection', () => {
  execSync('npx vitest run src/components/WorkspaceSidebar/WorkspaceSidebar.test.tsx', {
    stdio: 'pipe',
  })
})

// Scenario 4: Full App Suite Regression Gate
runStep('Full project test suite regression verification (46 test files)', () => {
  execSync('npm test', {
    stdio: 'pipe',
  })
})

console.log('===========================================================')
if (allPassed) {
  console.log('\x1b[32m✔ All Agent Scenarios Verified Successfully with Zero Delay!\x1b[0m')
  process.exit(0)
} else {
  console.log('\x1b[31m✖ Some Agent Scenarios Failed!\x1b[0m')
  process.exit(1)
}
