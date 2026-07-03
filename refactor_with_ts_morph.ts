import { Project, SyntaxKind, ParameterDeclaration } from "ts-morph";

const project = new Project();
project.addSourceFilesAtPaths("src/store/useAppStore.ts");
project.addSourceFilesAtPaths("src/components/WorkspaceView/**/*.tsx");
project.addSourceFilesAtPaths("src/hooks/**/*.ts");
project.addSourceFilesAtPaths("src/types/index.ts");

// 1. Add WorkspaceTab to types/index.ts
const typesFile = project.getSourceFile("src/types/index.ts")!;
if (!typesFile.getInterface("WorkspaceTab")) {
    typesFile.addInterface({
        name: "WorkspaceTab",
        isExported: true,
        properties: [
            { name: "id", type: "string" },
            { name: "workspaceId", type: "string" },
            { name: "name", type: "string" },
            { name: "position", type: "number" },
            { name: "createdAt", type: "number" }
        ]
    });
}

const storeFile = project.getSourceFile("src/store/useAppStore.ts")!;

// Add WorkspaceTab to imports in useAppStore.ts
const imports = storeFile.getImportDeclarations();
for (const imp of imports) {
    if (imp.getModuleSpecifierValue() === '../types') {
        const namedImports = imp.getNamedImports().map(n => n.getName());
        if (!namedImports.includes("WorkspaceTab")) {
            imp.addNamedImport("WorkspaceTab");
        }
    }
}

// 2. Refactor AppState Interface
const appState = storeFile.getInterfaceOrThrow("AppState");

// Rename ByWorkspace to ByTab
const renames = [
    { old: "terminalsByWorkspace", new: "terminalsByTab" },
    { old: "browserPanesByWorkspace", new: "browserPanesByTab" },
    { old: "editorPanesByWorkspace", new: "editorPanesByTab" },
    { old: "kubernetesPanesByWorkspace", new: "kubernetesPanesByTab" },
    { old: "layoutsByWorkspace", new: "layoutsByTab" },
    { old: "activeFileByWorkspace", new: "activeFileByTab" }
];

for (const { old, new: newName } of renames) {
    const prop = appState.getProperty(old);
    if (prop) prop.rename(newName);
}

// Add tabsByWorkspace and activeTabByWorkspace
if (!appState.getProperty("tabsByWorkspace")) {
    appState.addProperty({ name: "tabsByWorkspace", type: "Record<string, WorkspaceTab[]>" });
}
if (!appState.getProperty("activeTabByWorkspace")) {
    appState.addProperty({ name: "activeTabByWorkspace", type: "Record<string, string | null>" });
}

// Add tab methods
if (!appState.getProperty("setTabs")) {
    appState.addProperty({ name: "setTabs", type: "(workspaceId: string, tabs: WorkspaceTab[]) => void" });
    appState.addProperty({ name: "addTab", type: "(workspaceId: string, tab: WorkspaceTab) => void" });
    appState.addProperty({ name: "updateTab", type: "(workspaceId: string, tabId: string, updates: Partial<WorkspaceTab>) => void" });
    appState.addProperty({ name: "removeTab", type: "(workspaceId: string, tabId: string) => void" });
    appState.addProperty({ name: "setActiveTabId", type: "(workspaceId: string, tabId: string | null) => void" });
}

// 3. Update the Zustand store implementation
const createCall = storeFile.getVariableDeclarationOrThrow("useAppStore")
    .getInitializerIfKindOrThrow(SyntaxKind.CallExpression);
const persistCall = createCall.getArguments()[0].asKindOrThrow(SyntaxKind.CallExpression);
const arrowFunc = persistCall.getArguments()[0].asKindOrThrow(SyntaxKind.ArrowFunction);
const storeObj = arrowFunc.getBody().asKindOrThrow(SyntaxKind.ParenthesizedExpression)
    .getExpression().asKindOrThrow(SyntaxKind.ObjectLiteralExpression);

// Update initial state properties
for (const { old, new: newName } of renames) {
    const prop = storeObj.getProperty(old);
    if (prop) {
        // ts-morph rename on ObjectLiteralElement isn't direct, we replace the text of the key.
        // Actually since we renamed it in the interface, the IDE might have renamed it here if ts-morph did it properly.
        // Let's check if it exists under old name.
        if (prop.isKind(SyntaxKind.PropertyAssignment)) {
             // Let's rename the initializer node if it's possible... no, just replace.
        }
    }
}

// Wait, the best way to rename properties inside `storeObj` and across the whole file is to just rename the property in `AppState`,
// and then use a regular string replace for the rest of the file because ts-morph rename on interfaces doesn't always cascade to object literals that implement it implicitly.
project.saveSync();
