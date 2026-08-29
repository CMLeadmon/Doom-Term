pub mod commands;
pub mod session_manager;

use std::sync::Arc;
use tauri::Manager;

use crate::session_manager::SessionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let session_manager = Arc::new(SessionManager::new(app.handle().clone()));
            app.manage(session_manager);
            log::info!("Doom Term Tauri backend initialized successfully");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::spawn_session,
            commands::write_session,
            commands::resize_session,
            commands::send_signal,
            commands::kill_session,
            commands::list_sessions,
            commands::reattach_session,
            commands::get_system_telemetry,
            commands::browse_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Doom Term application");
}
