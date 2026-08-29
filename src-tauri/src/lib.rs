pub mod commands;
pub mod daemon;
pub mod session_manager;

use std::sync::Arc;
use tauri::{Manager, RunEvent};

use crate::session_manager::SessionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let session_manager = Arc::new(SessionManager::new(app.handle().clone()));
            app.manage(session_manager);

            // The daemon is bundled, not something the user starts. A failure
            // here is not fatal: the UI reconnects on a timer, so the window
            // still opens and reports the problem rather than refusing to run.
            if let Err(e) = daemon::start(app.handle()) {
                log::error!("could not start the bundled PTY daemon: {}", e);
            }

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
        .build(tauri::generate_context!())
        .expect("error while building Doom Term application");

    app.run(|handle, event| {
        // Take the daemon down with the app; an orphaned one would hold the
        // port and silently become the daemon of the next launch.
        if matches!(event, RunEvent::Exit) {
            daemon::stop(handle);
        }
    });
}
