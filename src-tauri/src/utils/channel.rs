use std::env;
use std::fs;

/// Attempt to extract the Channel ID based on the installer's name or current executable name
pub fn get_channel_id() -> Option<String> {
    let mut filename = None;

    // 1. Try to read installer_name.txt (written by NSIS installer)
    if let Ok(exe_path) = env::current_exe()
        && let Some(dir) = exe_path.parent()
    {
        let info_file = dir.join("installer_name.txt");
        if info_file.exists()
            && let Ok(content) = fs::read_to_string(&info_file)
        {
            let content = content.trim();
            let path = std::path::Path::new(content);
            if let Some(file_name) = path.file_name()
                && let Some(name_str) = file_name.to_str()
            {
                filename = Some(name_str.to_string());
            }
        }
    }

    // 2. Fallback to current executable's name (for portable versions)
    if filename.is_none()
        && let Ok(exe_path) = env::current_exe()
        && let Some(name) = exe_path.file_name()
        && let Some(name_str) = name.to_str()
    {
        filename = Some(name_str.to_string());
    }

    if let Some(name) = filename {
        return extract_channel_from_filename(&name);
    }

    None
}

/// Parse filename to extract the channel ID
fn extract_channel_from_filename(filename: &str) -> Option<String> {
    let name_without_ext = filename.strip_suffix(".exe").unwrap_or(filename);

    let parts: Vec<&str> = name_without_ext.split(['-', '_']).collect();

    if parts.len() > 1
        && let Some(last_part) = parts.last()
    {
        let ignore_list = [
            "setup",
            "rev",
            "portable",
            "x64",
            "x86",
            "arm64",
            "verge",
            "clash",
            "update",
            "installer",
        ];
        if !ignore_list.contains(&last_part.to_lowercase().as_str()) {
            return Some(last_part.to_string());
        }
    }

    None
}

/// Read the previously saved channel ID from local cache file
fn read_saved_channel_id() -> Option<String> {
    if let Ok(home_dir) = crate::utils::dirs::app_home_dir()
        && home_dir.join("channel_id.txt").exists()
        && let Ok(content) = fs::read_to_string(home_dir.join("channel_id.txt"))
    {
        let id = content.trim().to_string();
        if !id.is_empty() {
            return Some(id);
        }
    }
    None
}

/// Save the current channel ID to local cache file
fn save_channel_id(channel_id: &str) {
    if let Ok(home_dir) = crate::utils::dirs::app_home_dir() {
        let _ = fs::create_dir_all(&home_dir);
        let cache_file = home_dir.join("channel_id.txt");
        let _ = fs::write(&cache_file, channel_id);
    }
}

pub async fn apply_channel_config() {
    use crate::config::{Config, PrfItem, PrfOption};
    use clash_verge_logging::{Type, logging};

    let current_channel = get_channel_id();

    if current_channel.is_none() {
        logging!(info, Type::Setup, "未检测到渠道标识，跳过自动配置");
        return;
    }

    let Some(channel_id) = current_channel else {
        return;
    };
    let saved_channel = read_saved_channel_id();

    // If the channel ID hasn't changed, skip
    if saved_channel.as_deref() == Some(&channel_id) {
        logging!(info, Type::Setup, "渠道标识未变化 ({}), 跳过配置拉取", channel_id);
        return;
    }

    logging!(
        info,
        Type::Setup,
        "检测到渠道变更: {:?} -> {}, 开始拉取对应配置...",
        saved_channel,
        channel_id
    );

    let url = format!("https://v.dodoj.com/s/{}", channel_id);
    let prf_opt = PrfOption::default();

    // With 15 seconds timeout
    match tokio::time::timeout(
        std::time::Duration::from_secs(15),
        PrfItem::from_url(&url, None, None, Some(&prf_opt)),
    )
    .await
    {
        Ok(Ok(mut item)) => {
            if (crate::config::profiles_append_item_safe(&mut item).await).is_ok() {
                let _ = crate::config::profiles::profiles_save_file_safe().await;
                logging!(info, Type::Setup, "渠道配置已被拉取并保存到列表");

                if let Some(uid) = &item.uid {
                    let switch_profiles = crate::config::IProfiles {
                        current: Some(uid.clone()),
                        items: None,
                    };
                    Config::profiles()
                        .await
                        .edit_draft(|d| d.patch_config(&switch_profiles));
                    Config::profiles().await.apply();
                    let _ = crate::config::profiles::profiles_save_file_safe().await;
                    logging!(info, Type::Setup, "配置已生效为默认选项");

                    // Trigger core engine reload and UI refresh
                    use crate::core::{CoreManager, handle};
                    if let Ok(outcome) = CoreManager::global().update_config_forced().await
                        && outcome.is_valid()
                    {
                        handle::Handle::refresh_clash();
                        logging!(info, Type::Setup, "代理服务端应用节点成功");
                    }
                    handle::Handle::notify_profile_changed(uid);
                }

                // Save the channel ID after successful application
                save_channel_id(&channel_id);
                logging!(info, Type::Setup, "渠道标识已缓存: {}", channel_id);
            }
        }
        Ok(Err(e)) => {
            logging!(warn, Type::Setup, "拉取渠道配置失败: {}", e);
        }
        Err(_) => {
            logging!(warn, Type::Setup, "拉取渠道配置超时");
        }
    }
}
