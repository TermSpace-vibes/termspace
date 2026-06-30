/**
 * Default VS Code Extensions
 *
 * These provide an async init function that setup.ts calls AFTER
 * initialize() resolves, ensuring the extension service is registered first
 * before the extension manifests queue their registrations against it.
 *
 * Dynamic imports ensure these load AFTER the extension service override
 * is registered via initialize(). The packages' side effects at import
 * time register their extension manifests against the running service.
 */
export async function registerDefaultExtensions(): Promise<void> {
  await Promise.all([
    import('@codingame/monaco-vscode-typescript-language-features-default-extension'),
    import('@codingame/monaco-vscode-typescript-basics-default-extension'),
    import('@codingame/monaco-vscode-javascript-default-extension'),

    import('@codingame/monaco-vscode-json-default-extension'),
    import('@codingame/monaco-vscode-json-language-features-default-extension'),

    import('@codingame/monaco-vscode-css-default-extension'),
    import('@codingame/monaco-vscode-css-language-features-default-extension'),

    import('@codingame/monaco-vscode-html-default-extension'),
    import('@codingame/monaco-vscode-html-language-features-default-extension'),

    import('@codingame/monaco-vscode-markdown-basics-default-extension'),
    import('@codingame/monaco-vscode-markdown-language-features-default-extension'),

    import('@codingame/monaco-vscode-theme-defaults-default-extension'),
  ])
}
