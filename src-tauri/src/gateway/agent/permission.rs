use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::oneshot;

#[derive(Debug, Clone, Copy)]
pub struct ApprovalDecision {
    pub approved: bool,
    /// true 时把该工具记入本次运行的会话级放行集（不再询问）
    pub session_scope: bool,
}

/// 全局批准注册表：SSE 流内发起 permission_request，POST /api/agent/approval 回填决定
#[derive(Default)]
pub struct ApprovalRegistry {
    pending: Mutex<HashMap<String, oneshot::Sender<ApprovalDecision>>>,
}

impl ApprovalRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, request_id: &str) -> oneshot::Receiver<ApprovalDecision> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(request_id.to_string(), tx);
        rx
    }

    /// 送达决定；返回 false 表示 requestId 未知或已被消费（超时/取消）
    pub fn resolve(&self, request_id: &str, decision: ApprovalDecision) -> bool {
        match self.pending.lock().unwrap().remove(request_id) {
            Some(tx) => tx.send(decision).is_ok(),
            None => false,
        }
    }

    pub fn cancel(&self, request_id: &str) {
        self.pending.lock().unwrap().remove(request_id);
    }
}
