use serde::Deserialize;
use std::{
  fs,
  io,
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::Mutex,
  thread,
  time::{Duration, Instant},
};
use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Manager, RunEvent, WindowEvent,
};

#[derive(Default)]
struct RuntimeState {
  child: Mutex<Option<Child>>,
  runtime_url: Mutex<Option<String>>,
}

#[derive(Deserialize)]
struct RuntimeInfo {
  url: String,
}

fn repo_root() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .expect("src-tauri must live inside the hexnest-node project")
    .to_path_buf()
}

fn desktop_runtime_dir(app: &AppHandle) -> io::Result<PathBuf> {
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| io::Error::other(format!("failed to resolve app data dir: {error}")))?;
  let runtime_dir = app_data_dir.join("runtime");
  fs::create_dir_all(&runtime_dir)
    .map_err(|error| io::Error::other(format!("failed to create runtime dir {}: {error}", runtime_dir.display())))?;
  Ok(runtime_dir)
}

fn runtime_info_path(app: &AppHandle) -> io::Result<PathBuf> {
  Ok(desktop_runtime_dir(app)?.join("runtime-info.json"))
}

fn search_for_file(root: &Path, prefix: &str) -> Option<PathBuf> {
  let entries = fs::read_dir(root).ok()?;
  for entry in entries.flatten() {
    let path = entry.path();
    if path.is_dir() {
      if let Some(found) = search_for_file(&path, prefix) {
        return Some(found);
      }
      continue;
    }

    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
      continue;
    };
    if file_name.starts_with(prefix) {
      return Some(path);
    }
  }
  None
}

fn resolve_packaged_runtime_binary(app: &AppHandle) -> Option<PathBuf> {
  let mut roots = Vec::new();
  if let Ok(resource_dir) = app.path().resource_dir() {
    roots.push(resource_dir);
  }
  if let Ok(executable_path) = std::env::current_exe() {
    if let Some(parent) = executable_path.parent() {
      roots.push(parent.to_path_buf());
    }
  }

  for root in roots {
    if let Some(found) = search_for_file(&root, "hexnest-node-runtime-") {
      return Some(found);
    }
  }
  None
}

fn resolve_runtime_public_dir(app: &AppHandle) -> Option<PathBuf> {
  let mut candidates = Vec::new();
  if let Ok(resource_dir) = app.path().resource_dir() {
    candidates.push(resource_dir.join("public"));
  }
  candidates.push(repo_root().join("public"));

  candidates.into_iter().find(|candidate| candidate.join("index.html").exists())
}

fn spawn_runtime(app: &AppHandle) -> io::Result<PathBuf> {
  let runtime_dir = desktop_runtime_dir(app)?;
  let runtime_info = runtime_dir.join("runtime-info.json");
  let node_data_dir = runtime_dir.join("node-data");

  fs::create_dir_all(&node_data_dir)
    .map_err(|error| io::Error::other(format!("failed to create node data dir {}: {error}", node_data_dir.display())))?;

  let _ = fs::remove_file(&runtime_info);

  let project_root = repo_root();
  let mut command = if cfg!(debug_assertions) {
    if cfg!(target_os = "windows") {
      let mut command = Command::new("npm.cmd");
      command.arg("run").arg("dev");
      command
    } else {
      let mut command = Command::new("npm");
      command.arg("run").arg("dev");
      command
    }
  } else if let Some(sidecar_binary) = resolve_packaged_runtime_binary(app) {
    let mut command = Command::new(sidecar_binary);
    command
  } else {
    let mut command = Command::new("node");
    command.arg(project_root.join("dist").join("src").join("index.js"));
    command
  };

  let public_dir = resolve_runtime_public_dir(app);

  command
    .current_dir(&project_root)
    .env("HEXNEST_APP_DATA_DIR", &node_data_dir)
    .env("HEXNEST_RUNTIME_INFO_PATH", &runtime_info)
    .env("HEXNEST_WEB_HOST", "127.0.0.1")
    .env("HEXNEST_WEB_PORT", "0")
    .env("HEXNEST_WEB_PORT_STRICT", "false")
    .stdin(Stdio::null())
    .stdout(Stdio::inherit())
    .stderr(Stdio::inherit());

  if let Some(public_dir) = public_dir {
    command.env("HEXNEST_PUBLIC_DIR", public_dir);
  }

  let child = command
    .spawn()
    .map_err(|error| io::Error::other(format!("failed to start hexnest-node runtime: {error}")))?;

  let state = app.state::<RuntimeState>();
  let mut guard = state.child.lock().expect("runtime child mutex poisoned");
  *guard = Some(child);

  Ok(runtime_info)
}

fn load_runtime_url(runtime_info: &Path) -> Option<String> {
  let raw = fs::read_to_string(runtime_info).ok()?;
  let payload: RuntimeInfo = serde_json::from_str(&raw).ok()?;
  if payload.url.trim().is_empty() {
    return None;
  }
  Some(payload.url)
}

fn show_main_window(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

fn hide_main_window(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.hide();
  }
}

fn emit_script(app: &AppHandle, script: String) {
  let app_handle = app.clone();
  let _ = app_handle.run_on_main_thread(move || {
    if let Some(window) = app_handle.get_webview_window("main") {
      let _ = window.eval(&script);
    }
  });
}

fn set_status(app: &AppHandle, message: &str) {
  let json_message = serde_json::to_string(message).unwrap_or_else(|_| "\"Starting HexNest Node\"".into());
  emit_script(
    app,
    format!("window.__HEXNEST_DESKTOP__?.setStatus({json_message});")
  );
}

fn set_error(app: &AppHandle, message: &str) {
  let json_message = serde_json::to_string(message).unwrap_or_else(|_| "\"HexNest Node failed to start\"".into());
  emit_script(
    app,
    format!("window.__HEXNEST_DESKTOP__?.setError({json_message});")
  );
}

fn set_mode(app: &AppHandle, message: &str) {
  let json_message = serde_json::to_string(message).unwrap_or_else(|_| "\"Desktop shell\"".into());
  emit_script(app, format!("window.__HEXNEST_DESKTOP__?.setMode({json_message});"));
}

fn set_hint(app: &AppHandle, message: &str) {
  let json_message = serde_json::to_string(message).unwrap_or_else(|_| "\"Use the tray icon to reopen the window.\"".into());
  emit_script(app, format!("window.__HEXNEST_DESKTOP__?.setHint({json_message});"));
}

fn redirect_to_runtime(app: &AppHandle, url: &str) {
  let json_url = serde_json::to_string(url).unwrap_or_else(|_| "\"about:blank\"".into());
  emit_script(app, format!("window.location.replace({json_url});"));
}

fn await_runtime(app: AppHandle, runtime_info: PathBuf) {
  thread::spawn(move || {
    set_status(&app, "Booting the local node runtime.");
    set_mode(&app, if cfg!(debug_assertions) { "Desktop dev shell" } else { "Desktop packaged shell" });
    set_hint(&app, "Closing the window keeps HexNest Node alive in the system tray.");
    let started_at = Instant::now();

    loop {
      if let Some(url) = load_runtime_url(&runtime_info) {
        let state = app.state::<RuntimeState>();
        let mut runtime_url = state.runtime_url.lock().expect("runtime url mutex poisoned");
        *runtime_url = Some(url.clone());
        redirect_to_runtime(&app, &url);
        return;
      }

      if started_at.elapsed() > Duration::from_secs(30) {
        set_error(
          &app,
          "HexNest Node did not publish its local control URL within 30 seconds."
        );
        return;
      }

      thread::sleep(Duration::from_millis(250));
    }
  });
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
  let Some(icon) = app.default_window_icon().cloned() else {
    return Ok(());
  };

  let show = MenuItem::with_id(app, "show", "Show HexNest Node", true, None::<&str>)?;
  let hide = MenuItem::with_id(app, "hide", "Hide to Tray", true, None::<&str>)?;
  let separator = PredefinedMenuItem::separator(app)?;
  let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&show, &hide, &separator, &quit])?;

  TrayIconBuilder::with_id("main-tray")
    .icon(icon)
    .tooltip("HexNest Node")
    .menu(&menu)
    .menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id().as_ref() {
      "show" => show_main_window(app),
      "hide" => hide_main_window(app),
      "quit" => {
        stop_runtime(app);
        app.exit(0);
      }
      _ => {}
    })
    .on_tray_icon_event(|tray, event| match event {
      TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } => show_main_window(tray.app_handle()),
      TrayIconEvent::DoubleClick {
        button: MouseButton::Left,
        ..
      } => show_main_window(tray.app_handle()),
      _ => {}
    })
    .build(app)?;

  Ok(())
}

fn stop_runtime(app: &AppHandle) {
  let state = app.state::<RuntimeState>();
  let mut guard = state.child.lock().expect("runtime child mutex poisoned");
  if let Some(child) = guard.as_mut() {
    let _ = child.kill();
  }
  *guard = None;

  let mut runtime_url = state.runtime_url.lock().expect("runtime url mutex poisoned");
  *runtime_url = None;

  if let Ok(runtime_info) = runtime_info_path(app) {
    let _ = fs::remove_file(runtime_info);
  }
}

fn main() {
  let mut builder = tauri::Builder::default();
  builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
    show_main_window(app);
  }));

  let app = builder
    .manage(RuntimeState::default())
    .on_window_event(|window, event| {
      if window.label() != "main" {
        return;
      }

      if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let app = window.app_handle();
        hide_main_window(&app);
      }
    })
    .setup(|app| {
      create_tray(app.handle())?;
      let runtime_info = spawn_runtime(app.handle())?;
      await_runtime(app.handle().clone(), runtime_info);
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("failed to build HexNest Node desktop shell");

  app.run(|app_handle, event| {
    if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
      stop_runtime(app_handle);
    }
  });
}