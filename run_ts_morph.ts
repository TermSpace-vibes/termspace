import { Project, SyntaxKind } from "ts-morph";

const project = new Project();
project.addSourceFilesAtPaths("src/**/*.ts");
project.addSourceFilesAtPaths("src/**/*.tsx");

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
    if (prop) prop.rename(newName); // This magically updates EVERYTHING across all loaded files!
}

project.saveSync();
