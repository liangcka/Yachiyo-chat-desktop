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

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct KeyStoreData {
    pub keys: HashMap<String, String>,
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

    fn at_path(storage_path: PathBuf) -> Self {
        Self {
            storage_path,
            key: derive_machine_key(),
            cache: Mutex::new(None),
        }
    }

    fn read_data(&self) -> KeyStoreData {
        let mut cache_guard = self.cache.lock().unwrap();
        if let Some(cached) = &*cache_guard {
            return cached.keys.clone().into();
        }

        if !self.storage_path.exists() {
            let data = KeyStoreData::default();
            *cache_guard = Some(KeyStoreData {
                keys: data.keys.clone(),
            });
            return data;
        }

        let encrypted_bytes = match fs::read(&self.storage_path) {
            Ok(bytes) => bytes,
            Err(_) => return KeyStoreData::default(),
        };

        let Some(decrypted) = self.open(&encrypted_bytes) else {
            return KeyStoreData::default();
        };

        let data: KeyStoreData = serde_json::from_slice(&decrypted).unwrap_or_default();
        // 旧版文件用可推导的机器密钥加密：读取成功后立即按当前方案重新加密落盘
        if needs_reseal(&encrypted_bytes) {
            let _ = self.write_file(&data);
        }
        *cache_guard = Some(KeyStoreData {
            keys: data.keys.clone(),
        });
        data
    }

    /// 只负责加密落盘，不触碰缓存锁：`read_data` 持锁期间迁移旧文件时也会调用
    fn write_file(&self, data: &KeyStoreData) -> Result<(), String> {
        let plaintext = serde_json::to_vec(data).map_err(|e| e.to_string())?;
        let output = self.seal(&plaintext)?;
        fs::write(&self.storage_path, output).map_err(|e| e.to_string())
    }

    fn write_data(&self, data: &KeyStoreData) -> Result<(), String> {
        self.write_file(data)?;

        let mut cache_guard = self.cache.lock().unwrap();
        *cache_guard = Some(KeyStoreData {
            keys: data.keys.clone(),
        });
        Ok(())
    }

    pub fn get_key(&self, provider: &str) -> Option<String> {
        let data = self.read_data();
        data.keys.get(provider).cloned()
    }

    pub fn set_key(&self, provider: &str, key: &str) -> Result<(), String> {
        let mut data = self.read_data();
        data.keys.insert(provider.to_string(), key.to_string());
        self.write_data(&data)
    }

    pub fn delete_key(&self, provider: &str) -> Result<(), String> {
        let mut data = self.read_data();
        data.keys.remove(provider);
        self.write_data(&data)
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

impl From<HashMap<String, String>> for KeyStoreData {
    fn from(keys: HashMap<String, String>) -> Self {
        Self { keys }
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
