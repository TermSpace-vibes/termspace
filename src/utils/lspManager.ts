import { AbstractMessageReader, AbstractMessageWriter, DataCallback, Message } from 'vscode-jsonrpc';
import { MonacoLanguageClient } from 'monaco-languageclient';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import * as vscode from 'vscode';

class TauriMessageReader extends AbstractMessageReader {
    private callback: DataCallback | null = null;
    private unlisten: UnlistenFn | null = null;
    
    constructor(private id: string) { 
        super(); 
        this.setup(); 
    }
    
    async setup() {
        this.unlisten = await listen<{id: string, message: string}>('lsp-message', (e) => {
            if (e.payload.id === this.id && this.callback) {
                try {
                    this.callback(JSON.parse(e.payload.message));
                } catch (err) { 
                    console.error("LSP parse error", err); 
                }
            }
        });
    }
    
    listen(callback: DataCallback) { 
        this.callback = callback; 
        return {
            dispose: () => {
                this.callback = null;
            }
        };
    }
    
    dispose() { 
        if (this.unlisten) this.unlisten(); 
        super.dispose();
    }
}

class TauriMessageWriter extends AbstractMessageWriter {
    constructor(private id: string) { 
        super(); 
    }
    
    async write(msg: Message) {
        try {
            await invoke('write_lsp_message', { id: this.id, message: JSON.stringify(msg) });
        } catch (e) {
            console.error("LSP write error", e);
        }
    }
    
    end() {}
}

const connections = new Map<string, MonacoLanguageClient>();

export async function ensureLspConnection(workspaceId: string, rootPath: string, language: string) {
    const key = `${workspaceId}:${language}`;
    if (connections.has(key)) {
        return connections.get(key);
    }

    try {
        const id = await invoke<string>('spawn_lsp', { language, rootPath });
        
        const reader = new TauriMessageReader(id);
        const writer = new TauriMessageWriter(id);

        const client = new MonacoLanguageClient({
            name: `${language} Client`,
            clientOptions: {
                documentSelector: [language],
                workspaceFolder: {
                    uri: vscode.Uri.file(rootPath),
                    name: workspaceId,
                    index: 0
                }
            },
            messageTransports: { reader, writer }
        });

        await client.start();
        connections.set(key, client);
        
        return client;
    } catch (e) {
        console.error(`Failed to start LSP for ${language}`, e);
        return null;
    }
}
