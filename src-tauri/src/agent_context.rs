use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedInstructionFile {
    pub path: PathBuf,
    pub scope_root: PathBuf,
    pub format: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedWorkspaceInstructions {
    pub files: Vec<ResolvedInstructionFile>,
    pub resolution_path: Vec<PathBuf>,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextRequest {
    pub workspace_root: PathBuf,
    pub provider: String,
    pub selected_paths: Vec<PathBuf>,
    pub token_budget: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextItem {
    pub id: String,
    pub kind: String,
    pub source: String,
    pub content_hash: String,
    pub estimated_tokens: i64,
    pub priority: i64,
    pub inclusion_reason: String,
    pub trust_level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextExclusion {
    pub source: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBundle {
    pub id: String,
    pub provider: String,
    pub items: Vec<ContextItem>,
    pub exclusions: Vec<ContextExclusion>,
    pub instructions: ResolvedWorkspaceInstructions,
    pub estimated_tokens: i64,
    pub truncated: bool,
}

pub fn resolve_workspace_instructions(
    workspace_root: &Path,
    selected_paths: &[PathBuf],
) -> Result<ResolvedWorkspaceInstructions, String> {
    let root = canonical_workspace_root(workspace_root)?;
    let mut files = Vec::new();
    let mut resolution_path = Vec::new();
    let mut seen = HashSet::new();

    for selected_path in selected_paths {
        let selected = match fs::canonicalize(selected_path) {
            Ok(path) if path.starts_with(&root) => path,
            _ => continue,
        };
        let mut current = selected.parent().map(Path::to_path_buf);
        while let Some(directory) = current {
            if !directory.starts_with(&root) {
                break;
            }
            resolution_path.push(directory.clone());
            let agents_path = directory.join("AGENTS.md");
            add_instruction_if_present(&mut files, &mut seen, &agents_path, &directory, "agents-md")?;
            if directory == root {
                break;
            }
            current = directory.parent().map(Path::to_path_buf);
        }
    }

    let root_claude = root.join("CLAUDE.md");
    add_instruction_if_present(&mut files, &mut seen, &root_claude, &root, "claude-md")?;

    Ok(ResolvedWorkspaceInstructions {
        files,
        resolution_path,
        conflicts: Vec::new(),
    })
}

pub fn assemble_context(request: ContextRequest) -> Result<ContextBundle, String> {
    let root = canonical_workspace_root(&request.workspace_root)?;
    let instructions = resolve_workspace_instructions(&root, &request.selected_paths)?;
    let mut items = Vec::new();
    let mut exclusions = Vec::new();
    let mut estimated_tokens = 0;
    let budget = request.token_budget.max(0);

    for selected_path in &request.selected_paths {
        let display_path = selected_path.display().to_string();
        if is_default_excluded(selected_path) {
            exclusions.push(ContextExclusion { source: display_path, reason: "default_exclusion".into() });
            continue;
        }
        let canonical = match fs::canonicalize(selected_path) {
            Ok(path) => path,
            Err(_) => {
                exclusions.push(ContextExclusion { source: display_path, reason: "missing".into() });
                continue;
            }
        };
        if !canonical.starts_with(&root) {
            exclusions.push(ContextExclusion { source: display_path, reason: "outside_workspace".into() });
            continue;
        }
        if !canonical.is_file() {
            exclusions.push(ContextExclusion { source: display_path, reason: "not_a_file".into() });
            continue;
        }
        let content = fs::read(&canonical).map_err(|error| format!("Unable to inspect selected context: {error}"))?;
        let item_tokens = ((content.len() as i64) + 3) / 4;
        if estimated_tokens + item_tokens > budget {
            exclusions.push(ContextExclusion { source: display_path, reason: "token_budget".into() });
            continue;
        }
        estimated_tokens += item_tokens;
        items.push(ContextItem {
            id: format!("context-{}", items.len() + 1),
            kind: "user_attachment".into(),
            source: canonical.strip_prefix(&root).unwrap_or(&canonical).display().to_string(),
            content_hash: hash_bytes(&content),
            estimated_tokens: item_tokens,
            priority: 100,
            inclusion_reason: "selected by user".into(),
            trust_level: "user_selected_content".into(),
        });
    }

    let truncated = exclusions
        .iter()
        .any(|exclusion| exclusion.reason == "token_budget");
    Ok(ContextBundle {
        id: format!("context-bundle-{}", uuid::Uuid::new_v4()),
        provider: request.provider,
        items,
        exclusions,
        instructions,
        estimated_tokens,
        truncated,
    })
}

fn canonical_workspace_root(workspace_root: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(workspace_root).map_err(|error| format!("Unable to resolve workspace root: {error}"))
}

fn add_instruction_if_present(
    files: &mut Vec<ResolvedInstructionFile>,
    seen: &mut HashSet<PathBuf>,
    path: &Path,
    scope_root: &Path,
    format: &str,
) -> Result<(), String> {
    if !path.is_file() || !seen.insert(path.to_path_buf()) {
        return Ok(());
    }
    let content = fs::read(path).map_err(|error| format!("Unable to read workspace instruction: {error}"))?;
    files.push(ResolvedInstructionFile {
        path: path.to_path_buf(),
        scope_root: scope_root.to_path_buf(),
        format: format.into(),
        content_hash: hash_bytes(&content),
    });
    Ok(())
}

fn is_default_excluded(path: &Path) -> bool {
    let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
    file_name.starts_with(".env")
        || matches!(file_name, "id_rsa" | "id_ed25519" | "credentials" | ".git")
        || path.components().any(|component| component.as_os_str() == ".git")
}

fn hash_bytes(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::PathBuf;

    struct Fixture {
        root: PathBuf,
        root_agents: PathBuf,
        root_claude: PathBuf,
        nested_agents: PathBuf,
        package_file: PathBuf,
        outside_file: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "termspace_agent_context_{}_{}_{}",
                std::process::id(),
                crate::db::now_ms(),
                uuid::Uuid::new_v4(),
            ));
            let package = root.join("packages/app");
            fs::create_dir_all(&package).unwrap();
            let root_agents = root.join("AGENTS.md");
            let root_claude = root.join("CLAUDE.md");
            let nested_agents = package.join("AGENTS.md");
            let package_file = package.join("feature.ts");
            let outside_file = PathBuf::from("/private/tmp").join(format!(
                "termspace_agent_context_outside_{}_{}_{}",
                std::process::id(),
                crate::db::now_ms(),
                uuid::Uuid::new_v4(),
            ));
            fs::write(&root_agents, "root instructions").unwrap();
            fs::write(&root_claude, "claude instructions").unwrap();
            fs::write(&nested_agents, "nested instructions").unwrap();
            fs::write(&package_file, "export const feature = true;").unwrap();
            fs::write(&outside_file, "outside").unwrap();
            Self { root, root_agents, root_claude, nested_agents, package_file, outside_file }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
            let _ = fs::remove_file(&self.outside_file);
        }
    }

    #[test]
    fn closest_agents_instruction_precedes_root_and_claude_files() {
        let fixture = Fixture::new();
        let resolved = resolve_workspace_instructions(&fixture.root, &[fixture.package_file.clone()]).unwrap();

        assert_eq!(
            resolved.files.iter().map(|file| file.path.clone()).collect::<Vec<_>>(),
            vec![
                fs::canonicalize(&fixture.nested_agents).unwrap(),
                fs::canonicalize(&fixture.root_agents).unwrap(),
                fs::canonicalize(&fixture.root_claude).unwrap(),
            ],
        );
    }

    #[test]
    fn assembler_excludes_env_and_outside_symlink_targets() {
        let fixture = Fixture::new();
        let env_file = fixture.root.join(".env");
        let symlink_path = fixture.root.join("outside-link");
        fs::write(&env_file, "SECRET=never-send").unwrap();
        symlink(&fixture.outside_file, &symlink_path).unwrap();

        let bundle = assemble_context(ContextRequest {
            workspace_root: fixture.root.clone(),
            provider: "codex".into(),
            selected_paths: vec![fixture.package_file.clone(), env_file, symlink_path],
            token_budget: 1_000,
        })
        .unwrap();

        assert!(bundle.items.iter().all(|item| !item.source.ends_with(".env")));
        assert!(bundle.exclusions.iter().any(|item| item.reason == "default_exclusion"));
        assert!(bundle.exclusions.iter().any(|item| item.reason == "outside_workspace"));
    }
}
