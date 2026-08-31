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
        let mut truncated = text[..max_len].to_string();
        truncated.push_str("\n... [Web content truncated]");
        Ok(truncated)
    } else {
        Ok(text)
    }
}
