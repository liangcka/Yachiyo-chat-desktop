use crate::tools::floor_char_boundary;
use regex::Regex;
use std::sync::OnceLock;
use std::time::Duration;

const BROWSER_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MAX_SEARCH_RESULTS: usize = 8;
const MAX_TITLE_CHARS: usize = 120;
const MAX_SNIPPET_CHARS: usize = 300;

#[derive(Debug, Clone, PartialEq)]
pub struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

struct BingMarket {
    mkt: &'static str,
    setlang: &'static str,
    accept_language: &'static str,
}

const MARKET_ZH: BingMarket = BingMarket { mkt: "zh-CN", setlang: "zh-hans", accept_language: "zh-CN,zh;q=0.9" };
const MARKET_JA: BingMarket = BingMarket { mkt: "ja-JP", setlang: "ja", accept_language: "ja-JP,ja;q=0.9" };
const MARKET_EN: BingMarket = BingMarket { mkt: "en-US", setlang: "en", accept_language: "en-US,en;q=0.9" };

/// 工具调用不带界面语言，按查询文字推断市场：假名优先判日语，其次汉字判中文
fn market_for_query(query: &str) -> &'static BingMarket {
    let has_kana = query.chars().any(|c| matches!(c, '\u{3040}'..='\u{30ff}'));
    let has_han = query.chars().any(|c| matches!(c, '\u{4e00}'..='\u{9fff}'));
    if has_kana {
        &MARKET_JA
    } else if has_han {
        &MARKET_ZH
    } else {
        &MARKET_EN
    }
}

fn truncate_chars(value: &str, max: usize) -> String {
    match value.char_indices().nth(max) {
        Some((index, _)) => format!("{}…", &value[..index]),
        None => value.to_string(),
    }
}

fn decode_html_entities(value: &str) -> String {
    static NUMERIC: OnceLock<Regex> = OnceLock::new();
    let numeric = NUMERIC.get_or_init(|| Regex::new(r"&#(x[0-9a-fA-F]+|\d+);").expect("valid regex"));
    let decoded = numeric.replace_all(value, |caps: &regex::Captures| {
        let raw = &caps[1];
        let code = match raw.strip_prefix('x').or_else(|| raw.strip_prefix('X')) {
            Some(hex) => u32::from_str_radix(hex, 16).ok(),
            None => raw.parse::<u32>().ok(),
        };
        code.and_then(char::from_u32).map(String::from).unwrap_or_default()
    });
    decoded
        .replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// 解析必应 RSS：条目缺字段或链接非 http(s) 时整条丢弃
pub fn parse_bing_rss(xml: &str) -> Vec<WebSearchResult> {
    static ITEM: OnceLock<Regex> = OnceLock::new();
    static TITLE: OnceLock<Regex> = OnceLock::new();
    static LINK: OnceLock<Regex> = OnceLock::new();
    static DESCRIPTION: OnceLock<Regex> = OnceLock::new();
    let item_re = ITEM.get_or_init(|| Regex::new(r"(?s)<item>(.*?)</item>").expect("valid regex"));
    let title_re = TITLE.get_or_init(|| Regex::new(r"(?s)<title>(.*?)</title>").expect("valid regex"));
    let link_re = LINK.get_or_init(|| Regex::new(r"(?s)<link>(.*?)</link>").expect("valid regex"));
    let description_re =
        DESCRIPTION.get_or_init(|| Regex::new(r"(?s)<description>(.*?)</description>").expect("valid regex"));

    item_re
        .captures_iter(xml)
        .filter_map(|item| {
            let body = item.get(1)?.as_str();
            let extract = |re: &Regex| re.captures(body).map(|c| decode_html_entities(c[1].trim()).trim().to_string());
            let url = extract(link_re)?;
            if !url.starts_with("http://") && !url.starts_with("https://") {
                return None;
            }
            Some(WebSearchResult {
                title: truncate_chars(&extract(title_re)?, MAX_TITLE_CHARS),
                url,
                snippet: truncate_chars(&extract(description_re)?, MAX_SNIPPET_CHARS),
            })
        })
        .take(MAX_SEARCH_RESULTS)
        .collect()
}

async fn fetch_bing_rss(
    query: &str,
    market: &BingMarket,
    client: &reqwest::Client,
) -> Result<Vec<WebSearchResult>, String> {
    let res = client
        .get("https://www.bing.com/search")
        .query(&[("q", query), ("format", "rss"), ("mkt", market.mkt), ("setlang", market.setlang)])
        .header("accept", "application/rss+xml, application/xml, text/xml, */*")
        .header("accept-language", market.accept_language)
        .header("user-agent", BROWSER_USER_AGENT)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("搜索请求失败: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("搜索服务返回 HTTP {}", res.status()));
    }
    let xml = res.text().await.map_err(|e| format!("读取搜索结果失败: {}", e))?;
    Ok(parse_bing_rss(&xml))
}

/// 免 Key 的必应 RSS 检索；本地市场无结果时退到 en-US 再查一次
pub async fn web_search(query: &str, client: &reqwest::Client) -> Result<String, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("query 不能为空".to_string());
    }
    let market = market_for_query(query);
    let mut results = fetch_bing_rss(query, market, client).await;
    if market.mkt != MARKET_EN.mkt && !matches!(&results, Ok(items) if !items.is_empty()) {
        if let Ok(items) = fetch_bing_rss(query, &MARKET_EN, client).await {
            if !items.is_empty() {
                results = Ok(items);
            }
        }
    }
    let results = results?;
    if results.is_empty() {
        return Ok(format!("未找到与「{}」相关的搜索结果，可换更短或更通用的关键词重试。", query));
    }
    let lines: Vec<String> = results
        .iter()
        .enumerate()
        .map(|(i, r)| format!("[{}] {}\n{}\n{}", i + 1, r.title, r.url, r.snippet))
        .collect();
    Ok(format!(
        "搜索「{}」的结果（摘要不足时可用 web_fetch 抓取原文）：\n\n{}",
        query,
        lines.join("\n\n")
    ))
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bing_rss_extracts_valid_items() {
        let xml = r#"<rss><channel><title>Bing</title>
<item><title>Rust &amp; Tauri</title><link>https://example.com/a?x=1&amp;y=2</link><description>&#20013;&#25991; snippet</description></item>
<item><title>bad</title><link>javascript:alert(1)</link><description>x</description></item>
<item><title>no link</title><description>x</description></item>
</channel></rss>"#;
        let results = parse_bing_rss(xml);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Rust & Tauri");
        assert_eq!(results[0].url, "https://example.com/a?x=1&y=2");
        assert_eq!(results[0].snippet, "中文 snippet");
    }

    #[test]
    fn market_follows_query_script() {
        assert_eq!(market_for_query("今日のニュース").mkt, "ja-JP");
        assert_eq!(market_for_query("今天新闻").mkt, "zh-CN");
        assert_eq!(market_for_query("rust release").mkt, "en-US");
    }

    #[test]
    fn truncate_chars_respects_char_boundary() {
        assert_eq!(truncate_chars("一二三四", 2), "一二…");
        assert_eq!(truncate_chars("abc", 5), "abc");
    }
}
