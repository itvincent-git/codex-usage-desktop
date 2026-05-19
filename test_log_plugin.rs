use tauri_plugin_log::{Builder, Target, TargetKind};
use log::LevelFilter;

fn main() {
    let builder = Builder::new().level(LevelFilter::Info);
}
