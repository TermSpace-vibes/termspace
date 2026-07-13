use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use tauri::Manager;
use whisper_rs::{WhisperContext, WhisperContextParameters};

pub const MODEL_FILE_NAME: &str = "ggml-base.en.bin";
pub const MODEL_PART_FILE_NAME: &str = "ggml-base.en.bin.part";
pub const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
pub const MODEL_SHA256: &str = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002";
pub const MODEL_SIZE_BYTES: u64 = 147_964_211;

/// Multilingual model (whisper.cpp `ggml-base.bin`). Downloaded on demand when
/// the user picks a non-English language. Validation is intentionally relaxed
/// (min size only, no pinned SHA) so we don't hardcode a checksum that can
/// drift between whisper.cpp releases; a corrupt file fails at `WhisperContext`
/// load and surfaces as an error state instead.
pub const MODEL_MULTILINGUAL_FILE_NAME: &str = "ggml-base.bin";
pub const MODEL_MULTILINGUAL_PART_FILE_NAME: &str = "ggml-base.bin.part";
pub const MODEL_MULTILINGUAL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
/// Below this we treat the download as incomplete/corrupt.
pub const MODEL_MULTILINGUAL_MIN_SIZE_BYTES: u64 = 100_000_000;

/// Which on-disk model a language maps to. English uses the smaller English-only
/// `base.en`; everything else needs the multilingual `base`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelKind {
    English,
    Multilingual,
}

pub fn model_kind_for_language(language: &str) -> ModelKind {
    if language.is_empty() || language.eq_ignore_ascii_case("en") {
        ModelKind::English
    } else {
        ModelKind::Multilingual
    }
}

pub fn model_file_name(kind: ModelKind) -> &'static str {
    match kind {
        ModelKind::English => MODEL_FILE_NAME,
        ModelKind::Multilingual => MODEL_MULTILINGUAL_FILE_NAME,
    }
}

pub fn model_part_file_name(kind: ModelKind) -> &'static str {
    match kind {
        ModelKind::English => MODEL_PART_FILE_NAME,
        ModelKind::Multilingual => MODEL_MULTILINGUAL_PART_FILE_NAME,
    }
}

pub fn model_url(kind: ModelKind) -> &'static str {
    match kind {
        ModelKind::English => MODEL_URL,
        ModelKind::Multilingual => MODEL_MULTILINGUAL_URL,
    }
}

/// `None` means "no strict check" (multilingual uses relaxed validation).
pub fn expected_size(kind: ModelKind) -> Option<u64> {
    match kind {
        ModelKind::English => Some(MODEL_SIZE_BYTES),
        ModelKind::Multilingual => None,
    }
}

pub fn expected_sha(kind: ModelKind) -> Option<&'static str> {
    match kind {
        ModelKind::English => Some(MODEL_SHA256),
        ModelKind::Multilingual => None,
    }
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DictationModelStatus {
    pub state: String,
    pub source: Option<String>,
    pub downloaded_path: Option<String>,
    pub bundled_path: Option<String>,
    pub size_bytes: Option<u64>,
    pub expected_size_bytes: u64,
    pub error: Option<String>,
}

fn path_string(path: &Path) -> Option<String> {
    path.to_str().map(ToOwned::to_owned)
}

fn status(
    state: &str,
    source: Option<&str>,
    downloaded_path: Option<&Path>,
    bundled_path: Option<&Path>,
    size_bytes: Option<u64>,
    error: Option<String>,
) -> DictationModelStatus {
    DictationModelStatus {
        state: state.to_string(),
        source: source.map(ToOwned::to_owned),
        downloaded_path: downloaded_path.and_then(path_string),
        bundled_path: bundled_path.and_then(path_string),
        size_bytes,
        expected_size_bytes: MODEL_SIZE_BYTES,
        error,
    }
}

pub fn app_model_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    #[cfg(debug_assertions)]
    dir.push("dev");
    dir.push("models");
    Ok(dir)
}

pub fn downloaded_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    downloaded_model_path_for(app, ModelKind::English)
}

pub fn downloaded_model_path_for(app: &tauri::AppHandle, kind: ModelKind) -> Result<PathBuf, String> {
    Ok(app_model_dir(app)?.join(model_file_name(kind)))
}

pub fn downloaded_part_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    downloaded_part_path_for(app, ModelKind::English)
}

pub fn downloaded_part_path_for(app: &tauri::AppHandle, kind: ModelKind) -> Result<PathBuf, String> {
    Ok(app_model_dir(app)?.join(model_part_file_name(kind)))
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

pub fn validate_model_file(path: &Path) -> Result<u64, String> {
    validate_model_file_kind(path, ModelKind::English)
}

pub fn validate_model_file_kind(path: &Path, kind: ModelKind) -> Result<u64, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let size = metadata.len();

    match expected_size(kind) {
        Some(expected) => {
            if size != expected {
                return Err(format!(
                    "model size mismatch: expected {expected} bytes, got {size} bytes"
                ));
            }
        }
        None => {
            // Relaxed validation for the multilingual model (no pinned SHA/size).
            if size < MODEL_MULTILINGUAL_MIN_SIZE_BYTES {
                return Err(format!(
                    "model file too small ({size} bytes); download may be incomplete or corrupt"
                ));
            }
        }
    }

    if let Some(expected_sha) = expected_sha(kind) {
        let sha = sha256_file(path)?;
        if sha != expected_sha {
            return Err(format!(
                "model checksum mismatch: expected {expected_sha}, got {sha}"
            ));
        }
    }

    Ok(size)
}

pub fn inspect_model_files(
    downloaded_path: &Path,
    _bundled_path: Option<&Path>,
    kind: ModelKind,
) -> DictationModelStatus {
    if downloaded_path.exists() {
        return match validate_model_file_kind(downloaded_path, kind) {
            Ok(size) => status(
                "downloaded",
                Some("downloaded"),
                Some(downloaded_path),
                None,
                Some(size),
                None,
            ),
            Err(error) => status(
                "corrupted",
                Some("downloaded"),
                Some(downloaded_path),
                None,
                std::fs::metadata(downloaded_path).ok().map(|m| m.len()),
                Some(error),
            ),
        };
    }

    status("missing", None, None, None, None, None)
}

pub fn inspect_app_model_files(app: &tauri::AppHandle) -> Result<DictationModelStatus, String> {
    let downloaded = downloaded_model_path(app)?;
    Ok(inspect_model_files(&downloaded, None, ModelKind::English))
}

/// Status for the model that a given language maps to (English vs multilingual).
pub fn inspect_app_model_files_for(
    app: &tauri::AppHandle,
    kind: ModelKind,
) -> Result<DictationModelStatus, String> {
    let downloaded = downloaded_model_path_for(app, kind)?;
    Ok(inspect_model_files(&downloaded, None, kind))
}

pub fn selected_model_path(app: &tauri::AppHandle, language: &str) -> Result<Option<PathBuf>, String> {
    let kind = model_kind_for_language(language);
    let downloaded = downloaded_model_path_for(app, kind)?;

    if validate_model_file_kind(&downloaded, kind).is_ok() {
        return Ok(Some(downloaded));
    }

    Ok(None)
}

pub fn loaded_status(mut status: DictationModelStatus) -> DictationModelStatus {
    if status.state == "downloaded" && status.source.as_deref() == Some("downloaded") {
        status.state = "loaded".to_string();
    }
    status
}

pub fn load_whisper_context_from_path(path: &Path) -> Result<WhisperContext, String> {
    let params = WhisperContextParameters::default();
    WhisperContext::new_with_params(path, params).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("termspace-dictation-model-{name}-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_bytes(path: &Path, size: usize, byte: u8) {
        fs::write(path, vec![byte; size]).unwrap();
    }

    #[test]
    fn dictation_model_missing_download_reports_missing_when_no_bundled_fallback() {
        let dir = temp_dir("missing");
        let status = inspect_model_files(&dir.join(MODEL_FILE_NAME), None, ModelKind::English);

        assert_eq!(status.state, "missing");
        assert_eq!(status.source, None);
    }

    #[test]
    fn dictation_model_ignores_existing_bundled_fallback() {
        let dir = temp_dir("bundled");
        let downloaded = dir.join(MODEL_FILE_NAME);
        let bundled = dir.join("bundled.bin");
        write_bytes(&bundled, 32, 1);

        let status = inspect_model_files(&downloaded, Some(&bundled), ModelKind::English);

        assert_eq!(status.state, "missing");
        assert_eq!(status.source, None);
        assert_eq!(status.bundled_path, None);
    }

    #[test]
    fn dictation_model_ignores_stale_part_file() {
        let dir = temp_dir("part");
        let final_path = dir.join(MODEL_FILE_NAME);
        let part_path = dir.join(MODEL_PART_FILE_NAME);
        write_bytes(&part_path, 16, 2);

        let status = inspect_model_files(&final_path, None, ModelKind::English);

        assert_eq!(status.state, "missing");
        assert_eq!(status.downloaded_path, None);
    }

    #[test]
    fn dictation_model_reports_corrupted_download_on_size_mismatch() {
        let dir = temp_dir("corrupt");
        let downloaded = dir.join(MODEL_FILE_NAME);
        write_bytes(&downloaded, 16, 3);

        let status = inspect_model_files(&downloaded, None, ModelKind::English);

        assert_eq!(status.state, "corrupted");
        assert_eq!(status.source.as_deref(), Some("downloaded"));
        assert!(status.error.unwrap().contains("size"));
    }
}
