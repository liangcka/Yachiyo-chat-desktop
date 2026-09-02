use crate::types::{ToolCallStreamDelta, ToolInvocation};

struct AggSlot {
    id: String,
    name: String,
    arguments: String,
}

/// 流式工具调用增量聚合器：跨 SSE chunk 按 index 拼接 id/name/arguments
#[derive(Default)]
pub struct ToolCallAggregator {
    slots: Vec<AggSlot>,
    next_synthetic_id: u32,
}

impl ToolCallAggregator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, delta: &ToolCallStreamDelta) {
        match delta {
            ToolCallStreamDelta::Openai { index, id, name, arguments_fragment } => {
                let slot = self.slot_at(*index);
                if let Some(id) = id {
                    if !id.is_empty() {
                        slot.id = id.clone();
                    }
                }
                if let Some(name) = name {
                    if !name.is_empty() {
                        slot.name = name.clone();
                    }
                }
                if let Some(fragment) = arguments_fragment {
                    slot.arguments.push_str(fragment);
                }
            }
            ToolCallStreamDelta::AnthropicStart { index, block_id, name } => {
                let slot = self.slot_at(*index);
                slot.id = block_id.clone();
                slot.name = name.clone();
            }
            ToolCallStreamDelta::AnthropicArgs { index, partial_json } => {
                self.slot_at(*index).arguments.push_str(partial_json);
            }
            ToolCallStreamDelta::AnthropicStop { .. } => {}
            ToolCallStreamDelta::Gemini { call } => {
                // Gemini functionCall 完整出现；provider 不返回 id，由聚合器分配
                let synthetic_id = format!("call-gemini-{}", self.next_synthetic_id);
                self.next_synthetic_id += 1;
                self.slots.push(AggSlot {
                    id: if call.id.is_empty() { synthetic_id } else { call.id.clone() },
                    name: call.name.clone(),
                    arguments: call.arguments.to_string(),
                });
            }
        }
    }

    fn slot_at(&mut self, index: usize) -> &mut AggSlot {
        while self.slots.len() <= index {
            self.slots.push(AggSlot {
                id: format!("call-{}", self.slots.len()),
                name: String::new(),
                arguments: String::new(),
            });
        }
        &mut self.slots[index]
    }

    /// 收尾：解析累积的 arguments JSON（失败回退空对象），保持插入顺序
    pub fn finish(self) -> Vec<ToolInvocation> {
        self.slots
            .into_iter()
            .filter(|slot| !slot.name.is_empty())
            .map(|slot| ToolInvocation {
                id: slot.id,
                name: slot.name,
                arguments: serde_json::from_str(&slot.arguments).unwrap_or(serde_json::json!({})),
            })
            .collect()
    }
}
