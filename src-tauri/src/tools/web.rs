use crate::tools::floor_char_boundary;
use std::time::Duration;

pub async fn web_fetch(url: &str, client: &reqwest::Client) -> Result<String, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Invalid URL: must start with http:// or https://".to_string());
    }

    let res = client
        .get(url)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch URL '{}': {}", url, e))?;

    if !res.status().is_success() {
        return Err(format!("HTTP error {}: {}", res.status(), url));
    }

    let text = res
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let max_len = 16 * 1024;
    if text.len() > max_len {
        // 切片点必须先回退到字符边界：直接按字节切会在多字节字符中间 panic（CJK 页面必然命中）
        let cut = floor_char_boundary(&text, max_len);
        let mut truncated = text[..cut].to_string();
        truncated.push_str("\n... [Web content truncated]");
        Ok(truncated)
    } else {
        Ok(text)
    }
}
