use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

const NONCE_SIZE: usize = 12;

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct KeyStoreData {
    pub keys: HashMap<String, String>,
    /// 保存 Key 时绑定的自定义端点；没有记录表示 Key 属于厂商原生端点。
    /// 旧版文件没有该字段，按原生端点处理
    #[serde(default)]
    pub endpoints: HashMap<String, String>,
}

/// 端点比较前的规范化：去掉首尾空白与尾部斜杠
/// 密钥槽名：厂商名本身（旧版每厂商一把 Key），或“厂商名~后缀”（同一厂商的多条配置各占一槽）
pub fn is_valid_slot(slot: &str) -> bool {
    let (provider, suffix) = match slot.split_once('~') {
        Some((provider, suffix)) => (provider, Some(suffix)),
        None => (slot, None),
    };
    let provider_ok = !provider.is_empty() && provider.len() <= 32 && provider.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    let suffix_ok = match suffix {
        None => true,
        Some(s) => !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
    };
    provider_ok && suffix_ok
}

/// 槽是否归属该厂商
pub fn slot_belongs_to(slot: &str, provider: &str) -> bool {
    is_valid_slot(slot) && (slot == provider || slot.strip_prefix(provider).is_some_and(|rest| rest.starts_with('~')))
}

fn normalize_endpoint(endpoint: &str) -> String {
    endpoint.trim().trim_end_matches('/').to_string()
}

pub struct KeyStore {
    storage_path: PathBuf,
    key: [u8; 32],
    cache: Mutex<Option<KeyStoreData>>,
}

impl KeyStore {
    pub fn new() -> Self {
        let mut storage_path = dirs_storage_path();
        fs::create_dir_all(&storage_path).ok();
        storage_path.push("keys.enc");

        Self::at_path(storage_path)
    }

    /// 指定加密文件路径，供隔离的测试使用
    pub fn at_path(storage_path: PathBuf) -> Self {
        Self {
            storage_path,
            key: derive_machine_key(),
            cache: Mutex::new(None),
        }
    }

    fn read_data(&self) -> KeyStoreData {
        let mut cache_guard = self.cache.lock().unwrap();
        // 读不出时按「没有 Key」处理，但不写缓存，文件恢复可读后下次读取即生效
        self.load(&mut cache_guard).unwrap_or_default()
    }

    /// 在持有缓存锁的前提下取出当前数据。文件存在却读不出时返回错误而不是空数据，
    /// 否则随后的任何一次保存都会把空数据写回，其余厂商的 Key 随之永久丢失
    fn load(&self, cache: &mut Option<KeyStoreData>) -> Result<KeyStoreData, String> {
        if let Some(cached) = cache.as_ref() {
            return Ok(cached.clone());
        }

        let encrypted_bytes = match fs::read(&self.storage_path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let data = KeyStoreData::default();
                *cache = Some(data.clone());
                return Ok(data);
            }
            // 占用、权限等多为暂时性故障，文件本身可能完好，不能当作空存储
            Err(e) => return Err(format!("读取密钥文件失败: {e}")),
        };

        let data = match self
            .open(&encrypted_bytes)
            .and_then(|decrypted| serde_json::from_slice::<KeyStoreData>(&decrypted).ok())
        {
            Some(data) => {
                // 旧版文件用可推导的机器密钥加密：读取成功后立即按当前方案重新加密落盘
                if needs_reseal(&encrypted_bytes) {
                    let _ = self.write_file(&data);
                }
                data
            }
            None => {
                // 内容已无法解密（损坏或换了系统账户）：原文件移到旁边留作恢复，再从空存储开始，
                // 用户重新填写 Key 即可继续使用
                let aside = self.storage_path.with_extension("enc.unreadable");
                fs::rename(&self.storage_path, &aside)
                    .map_err(|e| format!("密钥文件无法解密且无法移走: {e}"))?;
                KeyStoreData::default()
            }
        };
        *cache = Some(data.clone());
        Ok(data)
    }

    /// 先写同目录临时文件再整体替换，写到一半退出也不会留下残缺的密钥文件
    fn write_file(&self, data: &KeyStoreData) -> Result<(), String> {
        let plaintext = serde_json::to_vec(data).map_err(|e| e.to_string())?;
        let output = self.seal(&plaintext)?;
        let staging = self.storage_path.with_extension("enc.tmp");
        fs::write(&staging, output).map_err(|e| e.to_string())?;
        fs::rename(&staging, &self.storage_path).map_err(|e| e.to_string())
    }

    /// 读-改-写全程持有缓存锁，并发保存不同厂商的 Key 时不会互相覆盖
    fn update(&self, change: impl FnOnce(&mut KeyStoreData)) -> Result<(), String> {
        let mut cache_guard = self.cache.lock().unwrap();
        let mut data = self.load(&mut cache_guard)?;
        change(&mut data);
        self.write_file(&data)?;
        *cache_guard = Some(data);
        Ok(())
    }

    pub fn get_key(&self, provider: &str) -> Option<String> {
        let data = self.read_data();
        data.keys.get(provider).cloned()
    }

    /// 取用已保存的 Key 前校验请求的目的端点：Key 只能发往保存时绑定的端点，
    /// 否则页面里的脚本可以带着攻击者的 baseUrl 让网关把真实 Key 发出去
    pub fn get_key_for_endpoint(&self, provider: &str, base_url: Option<&str>) -> Option<String> {
        let data = self.read_data();
        let bound = data.endpoints.get(provider).map(String::as_str);
        let requested = base_url.map(normalize_endpoint);
        let matches = match (bound, requested.as_deref()) {
            (None, None) => true,
            (Some(bound), Some(requested)) => normalize_endpoint(bound) == requested,
            _ => false,
        };
        if matches {
            data.keys.get(provider).cloned()
        } else {
            None
        }
    }

    pub fn set_key(&self, provider: &str, key: &str) -> Result<(), String> {
        self.set_key_for_endpoint(provider, key, None)
    }

    /// 保存 Key 并绑定到保存时使用的自定义端点（None 表示厂商原生端点）
    pub fn set_key_for_endpoint(&self, provider: &str, key: &str, base_url: Option<&str>) -> Result<(), String> {
        self.update(|data| {
            data.keys.insert(provider.to_string(), key.to_string());
            match base_url {
                Some(base_url) => {
                    data.endpoints.insert(provider.to_string(), normalize_endpoint(base_url));
                }
                None => {
                    data.endpoints.remove(provider);
                }
            }
        })
    }

    pub fn delete_key(&self, provider: &str) -> Result<(), String> {
        self.update(|data| {
            data.keys.remove(provider);
            data.endpoints.remove(provider);
        })
    }

    /// 该厂商任一绑定原生端点（无自定义端点）的 Key，优先旧版的厂商名槽；供余额查询等只认原生端点的场景
    pub fn native_key_for_provider(&self, provider: &str) -> Option<String> {
        let data = self.read_data();
        if let Some(key) = data.keys.get(provider).filter(|_| !data.endpoints.contains_key(provider)) {
            return Some(key.clone());
        }
        let mut slots: Vec<&String> = data
            .keys
            .keys()
            .filter(|slot| slot_belongs_to(slot, provider) && !data.endpoints.contains_key(slot.as_str()))
            .collect();
        slots.sort();
        slots.first().and_then(|slot| data.keys.get(slot.as_str()).cloned())
    }

    pub fn list_configured_providers(&self) -> Vec<String> {
        let data = self.read_data();
        data.keys.keys().cloned().collect()
    }
}

impl KeyStore {
    /// Windows 使用 DPAPI 按当前登录用户加密，其余平台沿用机器派生密钥的 AES-GCM
    fn seal(&self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        #[cfg(target_os = "windows")]
        {
            let mut output = DPAPI_MAGIC.to_vec();
            output.extend(dpapi::protect(plaintext)?);
            Ok(output)
        }
        #[cfg(not(target_os = "windows"))]
        {
            self.seal_legacy(plaintext)
        }
    }

    fn open(&self, bytes: &[u8]) -> Option<Vec<u8>> {
        #[cfg(target_os = "windows")]
        if let Some(blob) = bytes.strip_prefix(DPAPI_MAGIC.as_slice()) {
            return dpapi::unprotect(blob).ok();
        }
        self.open_legacy(bytes)
    }

    #[cfg_attr(target_os = "windows", allow(dead_code))]
    fn seal_legacy(&self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let mut nonce_bytes = [0u8; NONCE_SIZE];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|e| e.to_string())?;
        let ciphertext = cipher.encrypt(nonce, plaintext).map_err(|e| e.to_string())?;

        let mut output = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
        output.extend_from_slice(&nonce_bytes);
        output.extend_from_slice(&ciphertext);
        Ok(output)
    }

    fn open_legacy(&self, bytes: &[u8]) -> Option<Vec<u8>> {
        if bytes.len() < NONCE_SIZE {
            return None;
        }
        let (nonce_bytes, ciphertext) = bytes.split_at(NONCE_SIZE);
        let cipher = Aes256Gcm::new_from_slice(&self.key).ok()?;
        cipher.decrypt(Nonce::from_slice(nonce_bytes), ciphertext).ok()
    }
}

/// Windows 密文文件头，其后为 DPAPI 输出；无此文件头的文件按旧版 AES-GCM 格式解析
#[cfg(target_os = "windows")]
const DPAPI_MAGIC: &[u8; 4] = b"YKD1";

fn needs_reseal(bytes: &[u8]) -> bool {
    #[cfg(target_os = "windows")]
    {
        !bytes.starts_with(DPAPI_MAGIC)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = bytes;
        false
    }
}

#[cfg(target_os = "windows")]
mod dpapi {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        transform(data, true)
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        transform(data, false)
    }

    fn transform(data: &[u8], protect: bool) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(data.len()).map_err(|e| e.to_string())?,
            pbData: data.as_ptr().cast_mut(),
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        // SAFETY: 输入缓冲区在调用期间有效且只读；输出缓冲区由系统分配，复制后用 LocalFree 释放
        let ok = unsafe {
            if protect {
                CryptProtectData(
                    &input,
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            } else {
                CryptUnprotectData(
                    &input,
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            }
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        // SAFETY: 调用成功时 pbData 指向长度为 cbData 的有效缓冲区
        let bytes =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
        unsafe {
            LocalFree(output.pbData.cast());
        }
        Ok(bytes)
    }
}

pub(crate) fn dirs_storage_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(app_data) = std::env::var("APPDATA") {
            let mut p = PathBuf::from(app_data);
            p.push("cn.amtale.yachiyo.desktop");
            return p;
        }
    }

    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let mut p = PathBuf::from(home);
        p.push(".yachiyo-desktop");
        return p;
    }

    PathBuf::from(".yachiyo-desktop")
}

fn derive_machine_key() -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"yachiyo-desktop-local-keystore-salt-v1");

    #[cfg(target_os = "windows")]
    {
        if let Ok(user) = std::env::var("USERNAME") {
            hasher.update(user.as_bytes());
        }
        if let Ok(comp) = std::env::var("COMPUTERNAME") {
            hasher.update(comp.as_bytes());
        }
    }

    let result = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_survive_a_fresh_store_instance() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("keys.enc");
        KeyStore::at_path(path.clone()).set_key("claude", "sk-ant-test-1234567890").unwrap();

        let reopened = KeyStore::at_path(path.clone());
        assert_eq!(reopened.get_key("claude").as_deref(), Some("sk-ant-test-1234567890"));
        let raw = fs::read(&path).unwrap();
        assert!(!raw.windows(10).any(|w| w == b"sk-ant-tes"), "密文中不得出现明文 Key");
    }

    #[test]
    fn unreadable_file_is_kept_aside_instead_of_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("keys.enc");
        fs::write(&path, b"not a valid sealed keystore").unwrap();

        let store = KeyStore::at_path(path.clone());
        assert_eq!(store.get_key("deepseek"), None);
        store.set_key("glm", "glm-key-1234567890").unwrap();

        assert_eq!(
            fs::read(dir.path().join("keys.enc.unreadable")).unwrap(),
            b"not a valid sealed keystore",
            "读不出的原文件应原样保留以便恢复"
        );
        assert_eq!(KeyStore::at_path(path).get_key("glm").as_deref(), Some("glm-key-1234567890"));
    }

    #[test]
    fn save_is_refused_when_the_file_cannot_be_read() {
        let dir = tempfile::tempdir().unwrap();
        // 以目录占位制造非 NotFound 的读取错误，模拟文件被占用等暂时性故障
        let path = dir.path().join("keys.enc");
        fs::create_dir(&path).unwrap();

        let store = KeyStore::at_path(path.clone());
        assert!(store.set_key("deepseek", "sk-test-1234567890").is_err());
        assert!(path.is_dir(), "读取失败时不得用空数据覆盖原文件");
    }

    #[test]
    fn slots_of_one_provider_keep_separate_keys() {
        let dir = tempfile::tempdir().unwrap();
        let store = KeyStore::at_path(dir.path().join("keys.dat"));
        store.set_key_for_endpoint("openai~kimi", "kimi-key-1234567890", Some("https://api.moonshot.cn/v1")).unwrap();
        store.set_key_for_endpoint("openai~qwen", "qwen-key-1234567890", Some("https://dashscope.aliyuncs.com/compatible-mode/v1")).unwrap();
        assert_eq!(store.get_key_for_endpoint("openai~kimi", Some("https://api.moonshot.cn/v1")).as_deref(), Some("kimi-key-1234567890"));
        assert_eq!(store.get_key_for_endpoint("openai~qwen", Some("https://dashscope.aliyuncs.com/compatible-mode/v1")).as_deref(), Some("qwen-key-1234567890"));
        assert_eq!(store.get_key_for_endpoint("openai~kimi", Some("https://dashscope.aliyuncs.com/compatible-mode/v1")), None);
    }

    #[test]
    fn slot_names_are_validated_and_scoped_to_provider() {
        assert!(is_valid_slot("deepseek"));
        assert!(is_valid_slot("openai~a1B2-c_3"));
        assert!(!is_valid_slot("openai~"));
        assert!(!is_valid_slot("../etc"));
        assert!(!is_valid_slot("OpenAI"));
        assert!(slot_belongs_to("openai~x1", "openai"));
        assert!(slot_belongs_to("openai", "openai"));
        assert!(!slot_belongs_to("claude~x1", "openai"));
        assert!(!slot_belongs_to("openaix~x1", "openai"));
    }

    #[test]
    fn native_key_prefers_legacy_slot_and_skips_custom_endpoints() {
        let dir = tempfile::tempdir().unwrap();
        let store = KeyStore::at_path(dir.path().join("keys.dat"));
        store.set_key_for_endpoint("deepseek~a", "proxy-key-1234567890", Some("https://proxy.example.com/v1")).unwrap();
        assert_eq!(store.native_key_for_provider("deepseek"), None);
        store.set_key("deepseek~b", "native-key-1234567890").unwrap();
        assert_eq!(store.native_key_for_provider("deepseek").as_deref(), Some("native-key-1234567890"));
        store.set_key("deepseek", "legacy-key-1234567890").unwrap();
        assert_eq!(store.native_key_for_provider("deepseek").as_deref(), Some("legacy-key-1234567890"));
    }

    #[test]
    fn concurrent_saves_keep_every_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("keys.enc");
        let store = std::sync::Arc::new(KeyStore::at_path(path.clone()));
        let providers = ["deepseek", "glm", "openai", "claude", "gemini", "stepfun"];
        let handles: Vec<_> = providers
            .iter()
            .map(|provider| {
                let store = std::sync::Arc::clone(&store);
                let provider = provider.to_string();
                std::thread::spawn(move || store.set_key(&provider, &format!("{provider}-key-1234567890")).unwrap())
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }

        let reopened = KeyStore::at_path(path);
        for provider in providers {
            assert_eq!(reopened.get_key(provider), Some(format!("{provider}-key-1234567890")));
        }
    }

    #[test]
    fn legacy_files_are_read_and_resealed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("keys.enc");
        let legacy = KeyStore::at_path(path.clone());
        let mut data = KeyStoreData::default();
        data.keys.insert("deepseek".into(), "sk-legacy-1234567890".into());
        let sealed = legacy.seal_legacy(&serde_json::to_vec(&data).unwrap()).unwrap();
        fs::write(&path, sealed).unwrap();

        let store = KeyStore::at_path(path.clone());
        assert_eq!(store.get_key("deepseek").as_deref(), Some("sk-legacy-1234567890"));
        #[cfg(target_os = "windows")]
        assert!(fs::read(&path).unwrap().starts_with(DPAPI_MAGIC), "旧文件应迁移为 DPAPI 格式");
        assert_eq!(
            KeyStore::at_path(path).get_key("deepseek").as_deref(),
            Some("sk-legacy-1234567890")
        );
    }
}
