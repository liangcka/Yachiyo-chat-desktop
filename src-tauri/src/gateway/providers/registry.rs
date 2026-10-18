use crate::types::ProviderId;

#[derive(Debug, Clone)]
pub struct ProviderConfig {
    pub id: ProviderId,
    pub endpoint: &'static str,
    pub default_model: &'static str,
    pub allowed_models: &'static [&'static str],
    pub supports_image: bool,
    pub image_models: &'static [&'static str],
}

pub const STEPFUN_CONFIG: ProviderConfig = ProviderConfig {
    id: ProviderId::Stepfun,
    endpoint: "https://api.stepfun.com/step_plan/v1/chat/completions",
    default_model: "step-3.7-flash",
    allowed_models: &[
        "step-3.7-flash",
        "step-3.5-flash",
        "step-3.5-flash-2603",
        "step-2-16k",
        "step-1-8k",
        "step-1v-8k",
        "step-plan",
    ],
    supports_image: true,
    image_models: &["step-3.7-flash"],
};

pub const DEEPSEEK_CONFIG: ProviderConfig = ProviderConfig {
    id: ProviderId::Deepseek,
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    default_model: "deepseek-v4-flash",
    allowed_models: &["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-vision-exp"],
    supports_image: true,
    image_models: &["deepseek-v4-flash-vision-exp"],
};

pub const GLM_CONFIG: ProviderConfig = ProviderConfig {
    id: ProviderId::Glm,
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    default_model: "glm-5.3-flash",
    allowed_models: &[
        "glm-5.3",
        "glm-5.3-flash",
        "glm-5.2",
        "glm-4.7-flash",
        "glm-4.6",
        "glm-4.6v-flash",
        "glm-4v-flash",
    ],
    supports_image: true,
    image_models: &["glm-5.3-flash", "glm-4.6v-flash", "glm-4v-flash"],
};

pub const OPENAI_CONFIG: ProviderConfig = ProviderConfig {
    id: ProviderId::Openai,
    endpoint: "https://api.openai.com/v1/chat/completions",
    default_model: "gpt-5.6-luna",
    allowed_models: &[
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.5",
        "gpt-4.1",
        "gpt-4.1-mini",
    ],
    supports_image: true,
    image_models: &[
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.5",
        "gpt-4.1",
        "gpt-4.1-mini",
    ],
};

pub const CLAUDE_CONFIG: ProviderConfig = ProviderConfig {
    id: ProviderId::Claude,
    endpoint: "https://api.anthropic.com/v1/messages",
    default_model: "claude-sonnet-5-5",
    allowed_models: &[
        "claude-fable-5-1",
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
        "claude-fable-5",
        "claude-opus-5",
        "claude-sonnet-5",
        "claude-haiku-4-5",
    ],
    supports_image: true,
    image_models: &[
        "claude-fable-5-1",
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
        "claude-fable-5",
        "claude-opus-5",
        "claude-sonnet-5",
        "claude-haiku-4-5",
    ],
};

pub const GEMINI_CONFIG: ProviderConfig = ProviderConfig {
    id: ProviderId::Gemini,
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    default_model: "gemini-3.7-flash",
    allowed_models: &[
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-pro",
        "gemini-3.1-flash-lite",
    ],
    supports_image: true,
    image_models: &[
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-pro",
        "gemini-3.1-flash-lite",
    ],
};

pub fn get_provider_config(provider: ProviderId) -> &'static ProviderConfig {
    match provider {
        ProviderId::Stepfun => &STEPFUN_CONFIG,
        ProviderId::Deepseek => &DEEPSEEK_CONFIG,
        ProviderId::Glm => &GLM_CONFIG,
        ProviderId::Openai => &OPENAI_CONFIG,
        ProviderId::Claude => &CLAUDE_CONFIG,
        ProviderId::Gemini => &GEMINI_CONFIG,
    }
}
