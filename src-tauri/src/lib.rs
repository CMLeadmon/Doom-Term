pub mod commands;
pub mod daemon;

use tauri::RunEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // The daemon is bundled, not something the user starts. A failure
            // here is not fatal: the UI reconnects on a timer, so the window
            // still opens and reports the problem rather than refusing to run.
            if let Err(e) = daemon::start(app.handle()) {
                log::error!("could not start the bundled PTY daemon: {}", e);
            }

            log::info!("Doom Term Tauri backend initialized successfully");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::browse_directory])
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
