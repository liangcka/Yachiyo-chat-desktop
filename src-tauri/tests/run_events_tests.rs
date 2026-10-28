//! 运行事件日志：序号递增、断线后按序号回填、日志裁剪后的缺口提示、空闲心跳与结束。
use futures_util::StreamExt;
use std::sync::Arc;
use std::time::Duration;
use yachiyo_desktop_lib::gateway::agent::run_events::{subscribe_with_heartbeat, RunEventLog};

fn frame(name: &str) -> String {
    format!("event: delta\ndata: {{\"text\":\"{name}\"}}\n\n")
}

async fn next(stream: &mut (impl futures::Stream<Item = Result<String, axum::Error>> + Unpin)) -> Option<String> {
    tokio::time::timeout(Duration::from_secs(5), stream.next()).await.expect("事件超时").map(|item| item.unwrap())
}

#[tokio::test]
async fn subscribers_receive_numbered_events_and_reconnect_from_their_last_sequence() {
    let log = Arc::new(RunEventLog::new());
    assert_eq!(log.push(frame("a")), 1);
    assert_eq!(log.push(frame("b")), 2);

    let mut first = Box::pin(subscribe_with_heartbeat(Arc::clone(&log), 0, Duration::from_millis(30)));
    assert_eq!(next(&mut first).await.unwrap(), format!("id: 1\n{}", frame("a")));
    assert_eq!(next(&mut first).await.unwrap(), format!("id: 2\n{}", frame("b")));
    // 空闲时下发心跳，不编号
    assert_eq!(next(&mut first).await.unwrap(), ": ping\n\n");
    // 连接断开：订阅者离开，日志照常写入
    drop(first);
    log.push(frame("c"));
    log.push(frame("d"));

    // 重新连接时从最后收到的序号之后回填，不重复、不乱序
    let mut resumed = Box::pin(subscribe_with_heartbeat(Arc::clone(&log), 2, Duration::from_secs(60)));
    assert_eq!(next(&mut resumed).await.unwrap(), format!("id: 3\n{}", frame("c")));
    assert_eq!(next(&mut resumed).await.unwrap(), format!("id: 4\n{}", frame("d")));
    let pending = tokio::spawn(async move {
        let mut items = Vec::new();
        while let Some(item) = next(&mut resumed).await {
            items.push(item);
        }
        items
    });
    tokio::time::sleep(Duration::from_millis(30)).await;
    log.push(frame("e"));
    log.finish();
    assert_eq!(log.push(frame("late")), 0, "结束后不再写入");
    assert_eq!(pending.await.unwrap(), vec![format!("id: 5\n{}", frame("e"))], "结束后读完剩余事件即关闭");
}

#[tokio::test]
async fn reconnecting_after_the_log_was_trimmed_reports_the_gap() {
    let log = Arc::new(RunEventLog::new());
    // 写入超过保留上限的事件，最早的被丢弃
    for index in 0..20_005 {
        log.push(frame(&index.to_string()));
    }
    log.finish();
    let read = log.read_after(3);
    assert_eq!(read.gap, Some((4, 5)));
    assert_eq!(read.events.first().map(|(seq, _)| *seq), Some(6));

    let mut stream = Box::pin(subscribe_with_heartbeat(Arc::clone(&log), 3, Duration::from_secs(60)));
    assert_eq!(next(&mut stream).await.unwrap(), "event: gap\ndata: {\"from\":4,\"to\":5}\n\n");
    assert!(next(&mut stream).await.unwrap().starts_with("id: 6\n"));
    // 已读到最新时没有缺口
    assert_eq!(log.read_after(20_005).gap, None);
}
