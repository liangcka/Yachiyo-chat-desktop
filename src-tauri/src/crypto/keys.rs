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

        let key = derive_machine_key();
        Self {
            storage_path,
            key,
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

        if encrypted_bytes.len() < NONCE_SIZE {
            return KeyStoreData::default();
        }

        let (nonce_bytes, ciphertext) = encrypted_bytes.split_at(NONCE_SIZE);
        let cipher = match Aes256Gcm::new_from_slice(&self.key) {
            Ok(c) => c,
            Err(_) => return KeyStoreData::default(),
        };
        let nonce = Nonce::from_slice(nonce_bytes);

        let decrypted = match cipher.decrypt(nonce, ciphertext) {
            Ok(bytes) => bytes,
            Err(_) => return KeyStoreData::default(),
        };

        let data: KeyStoreData = serde_json::from_slice(&decrypted).unwrap_or_default();
        *cache_guard = Some(KeyStoreData {
            keys: data.keys.clone(),
        });
        data
    }

    fn write_data(&self, data: &KeyStoreData) -> Result<(), String> {
        let plaintext = serde_json::to_vec(data).map_err(|e| e.to_string())?;

        let mut nonce_bytes = [0u8; NONCE_SIZE];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|e| e.to_string())?;
        let ciphertext = cipher.encrypt(nonce, plaintext.as_ref()).map_err(|e| e.to_string())?;

        let mut output = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
        output.extend_from_slice(&nonce_bytes);
        output.extend_from_slice(&ciphertext);

        fs::write(&self.storage_path, output).map_err(|e| e.to_string())?;

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

impl From<HashMap<String, String>> for KeyStoreData {
    fn from(keys: HashMap<String, String>) -> Self {
        Self { keys }
    }
}

fn dirs_storage_path() -> PathBuf {
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
