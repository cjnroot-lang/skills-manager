use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use crate::core::{error::AppError, skill_store::SkillStore};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickCommandDto {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub command: Option<String>,
    pub script_ext: Option<String>,
    pub script_content: Option<String>,
    pub script_path: Option<String>,
    pub working_dir: Option<String>,
    pub env_vars: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<crate::core::skill_store::QuickCommandRecord> for QuickCommandDto {
    fn from(r: crate::core::skill_store::QuickCommandRecord) -> Self {
        QuickCommandDto {
            id: r.id,
            name: r.name,
            r#type: r.r#type,
            command: r.command,
            script_ext: r.script_ext,
            script_content: r.script_content,
            script_path: r.script_path,
            working_dir: r.working_dir,
            env_vars: r.env_vars,
            icon: r.icon,
            sort_order: r.sort_order,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ExecutionResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[tauri::command]
pub async fn get_quick_commands(
    store: tauri::State<'_, Arc<SkillStore>>,
) -> Result<Vec<QuickCommandDto>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let cmds = store.get_all_quick_commands().map_err(AppError::db)?;
        Ok(cmds.into_iter().map(QuickCommandDto::from).collect())
    })
    .await?
}

#[tauri::command]
pub async fn create_quick_command(
    name: String,
    r#type: String,
    command: Option<String>,
    script_ext: Option<String>,
    script_content: Option<String>,
    script_path: Option<String>,
    working_dir: Option<String>,
    env_vars: Option<String>,
    icon: Option<String>,
    store: tauri::State<'_, Arc<SkillStore>>,
) -> Result<QuickCommandDto, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let now = chrono::Utc::now().timestamp_millis();
        let id = uuid::Uuid::new_v4().to_string();

        let record = crate::core::skill_store::QuickCommandRecord {
            id: id.clone(),
            name: name.clone(),
            r#type: r#type.clone(),
            command: command.clone(),
            script_ext: script_ext.clone(),
            script_content: script_content.clone(),
            script_path: script_path.clone(),
            working_dir: working_dir.clone(),
            env_vars: env_vars.clone(),
            icon: icon.clone(),
            sort_order: 999,
            created_at: now,
            updated_at: now,
        };

        store.insert_quick_command(&record).map_err(AppError::db)?;

        Ok(QuickCommandDto {
            id,
            name,
            r#type,
            command,
            script_ext,
            script_content,
            script_path,
            working_dir,
            env_vars,
            icon,
            sort_order: 999,
            created_at: now,
            updated_at: now,
        })
    })
    .await?
}

#[tauri::command]
pub async fn update_quick_command(
    id: String,
    name: String,
    r#type: String,
    command: Option<String>,
    script_ext: Option<String>,
    script_content: Option<String>,
    script_path: Option<String>,
    working_dir: Option<String>,
    env_vars: Option<String>,
    icon: Option<String>,
    store: tauri::State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .update_quick_command(
                &id,
                &name,
                &r#type,
                command.as_deref(),
                script_ext.as_deref(),
                script_content.as_deref(),
                script_path.as_deref(),
                working_dir.as_deref(),
                env_vars.as_deref(),
                icon.as_deref(),
            )
            .map_err(AppError::db)
    })
    .await?
}

#[tauri::command]
pub async fn delete_quick_command(
    id: String,
    store: tauri::State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.delete_quick_command(&id).map_err(AppError::db)
    })
    .await?
}

#[tauri::command]
pub async fn reorder_quick_commands(
    ids: Vec<String>,
    store: tauri::State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.reorder_quick_commands(&ids).map_err(AppError::db)
    })
    .await?
}

#[tauri::command]
pub async fn execute_quick_command(
    id: String,
    store: tauri::State<'_, Arc<SkillStore>>,
) -> Result<ExecutionResult, AppError> {
    let store = store.inner().clone();
    let cmd = tauri::async_runtime::spawn_blocking(move || {
        store.get_quick_command_by_id(&id).map_err(AppError::db)
    })
    .await??;

    let cmd = cmd.ok_or_else(|| AppError::not_found("Quick command not found"))?;

    let (program, args, cwd) = build_execution_context(&cmd)?;

    let env_map = parse_env_vars(cmd.env_vars.as_deref());

    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd_obj = std::process::Command::new(&program);
        cmd_obj.args(&args);

        if let Some(dir) = &cwd {
            cmd_obj.current_dir(dir);
        }

        if !env_map.is_empty() {
            for (k, v) in &env_map {
                cmd_obj.env(k, v);
            }
        }

        cmd_obj.output()
    })
    .await
    .map_err(|e| AppError::internal(format!("Failed to execute command: {e}")))?
    .map_err(|e| AppError::internal(format!("Command execution error: {e}")))?;

    Ok(ExecutionResult {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn build_execution_context(
    cmd: &crate::core::skill_store::QuickCommandRecord,
) -> Result<(String, Vec<String>, Option<PathBuf>), AppError> {
    let cwd = cmd.working_dir.as_deref().map(PathBuf::from);

    match cmd.r#type.as_str() {
        "shell" => {
            let command = cmd
                .command
                .as_deref()
                .ok_or_else(|| AppError::invalid_input("Shell command is empty"))?;
            // Use interactive login shell so user PATH/profile from .zshrc is loaded
            let shell = default_login_shell();
            Ok((shell, vec!["-i".to_string(), "-l".to_string(), "-c".to_string(), command.to_string()], cwd))
        }
        "script" => {
            if let Some(path) = &cmd.script_path {
                let path = PathBuf::from(path);
                if !path.exists() {
                    return Err(AppError::not_found(&format!(
                        "Script file not found: {}",
                        path.display()
                    )));
                }
                let ext = cmd.script_ext.as_deref().unwrap_or("sh");
                let shell = default_login_shell();
                let exec_cmd = format_script_exec_command(ext, &path.to_string_lossy());
                Ok((shell, vec!["-i".to_string(), "-l".to_string(), "-c".to_string(), exec_cmd], cwd))
            } else {
                let content = cmd
                    .script_content
                    .as_deref()
                    .ok_or_else(|| AppError::invalid_input("Script content is empty"))?;
                let ext = cmd.script_ext.as_deref().unwrap_or("sh");

                let temp_dir = std::env::temp_dir().join("skills-manager-cmds");
                std::fs::create_dir_all(&temp_dir)
                    .map_err(|e| AppError::internal(format!("Failed to create temp dir: {e}")))?;
                let file_name = format!("{}.{}", cmd.id, ext);
                let temp_file = temp_dir.join(&file_name);
                std::fs::write(&temp_file, content)
                    .map_err(|e| AppError::internal(format!("Failed to write temp script: {e}")))?;

                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&temp_file, std::fs::Permissions::from_mode(0o755))
                        .map_err(|e| AppError::internal(format!("Failed to set permissions: {e}")))?;
                }

                let shell = default_login_shell();
                let exec_cmd = format_script_exec_command(ext, &temp_file.to_string_lossy());
                Ok((shell, vec!["-i".to_string(), "-l".to_string(), "-c".to_string(), exec_cmd], cwd))
            }
        }
        _ => Err(AppError::invalid_input(&format!(
            "Unknown command type: {}",
            cmd.r#type
        ))),
    }
}

/// Returns the user's login shell (from SHELL env), falls back to /bin/zsh then /bin/bash.
fn default_login_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            if std::path::Path::new("/bin/zsh").exists() {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        })
}

/// Build the command string for executing a script through a login shell.
/// e.g. for py: `python3 '/path/to/script.py'`
/// e.g. for sh: `sh '/path/to/script.sh'`
fn format_script_exec_command(ext: &str, script_path: &str) -> String {
    let interpreter = match ext {
        "py" => "python3",
        "js" => "node",
        _ => "sh",
    };
    format!("{} '{}'", interpreter, script_path)
}

fn parse_env_vars(env_vars: Option<&str>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(json_str) = env_vars {
        if let Ok(parsed) = serde_json::from_str::<HashMap<String, String>>(json_str) {
            map = parsed;
        }
    }
    map
}
