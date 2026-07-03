import fs from 'fs'

const filePath = 'src/store/useAppStore.ts'
let text = fs.readFileSync(filePath, 'utf8')

// The problem is that my previous script replaced parameter names `workspaceId` with `tabId` but inside the body of the function they still used `workspaceId`, or vice versa.
// Let's replace any lingering `workspaceId` inside the pane functions that now take `tabId`.
// Actually, it's safer to just replace any undefined `tabId` or `workspaceId` systematically.

const paneFunctions = [
    'setTerminals', 'addTerminal', 'removeTerminal', 'renameTerminal', 'updateTerminalCwd', 'setTerminalNotification', 'setTerminalExecutionState',
    'setBrowserPanes', 'addBrowserPane', 'updateBrowserPane', 'removeBrowserPane',
    'setEditorPanes', 'addEditorPane', 'updateEditorPaneFile', 'removeEditorPane',
    'setKubernetesPanes', 'addKubernetesPane', 'removeKubernetesPane',
    'setLayout', 'updateLayoutSizes', 'swapPanes'
]

paneFunctions.forEach(fn => {
    const regex = new RegExp(`(${fn}: \\(tabId(?:[^\\)]*)\\) =>\\s*(?:set\\(\\(state\\) => \\(\\{|\\{)?)([\\s\\S]*?)(?=,\\n  \\w+: |,\\n  setActiveWorkspaceId|\\}\\)$)`, 'g')
    text = text.replace(regex, (match, prefix, body) => {
        return prefix + body.replace(/workspaceId/g, 'tabId')
    })
})

// Also there are some places where tabId is used instead of workspaceId for tabs actions.
// "src/store/useAppStore.ts(150,12): error TS2304: Cannot find name 'tabId'."
// Let's manually fix some specific errors by running `npx tsc --noEmit` locally in my mind... wait.
// Let's just restore the file from git to HEAD and do it properly with a typescript AST transform?
// No, I can't `git checkout` because I don't want to lose other things? Wait, I only touched `db.rs`, `commands.rs`, and `useAppStore.ts`. I can just rewrite `useAppStore.ts` safely.
fs.writeFileSync(filePath, text)
