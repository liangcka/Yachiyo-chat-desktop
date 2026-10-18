import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useChatController, type ChatRepository, type StreamChatFunction } from "./app/use-chat-controller";
import { ToastRegion } from "./components/ToastRegion";
import { DesktopUpdateNotice } from "./components/desktop/DesktopUpdateNotice";
import { ConversationRepository } from "./data/conversation-repository";
import { YachiyoDatabase } from "./data/db";
import type { Conversation, Locale, StoredImage } from "./domain/chat";
import { PROVIDER_METADATA, type ActiveLlmConfig, type ProviderId } from "./domain/llm";
import {
  ImageProcessingError,
  processImage,
  type ImageProcessingErrorCode,
  type ProcessedImage,
} from "./features/capture/image-processor";
import { copyFor, type UiCopy } from "./i18n/messages";
import { UpdatePrompt } from "./pwa/UpdatePrompt";
import { useOnlineStatus } from "./pwa/use-online-status";
import { usePwaUpdate } from "./pwa/use-pwa-update";
import { clearWebCaches } from "./services/api-origins";
import { isDesktopApp, isNativeApp } from "./services/app-platform";
import { streamChat } from "./services/chat-client";
import { LlmSettingsService } from "./services/llm-settings";
import { projectManager } from "./services/project-manager";
import { SessionClient } from "./services/session-client";
import { checkForUpdate, type AvailableUpdate } from "./services/update-check";
import { SkillSettingsService } from "./services/skill-settings";
import {
  WebSearchSettingsService,
  defaultWebSearchSettings,
  type WebSearchSettings,
} from "./services/web-search-settings";
import { SKILLS } from "./skills";
import type { SharedViewProps } from "./views/layout-types";
import { DesktopLayout } from "./views/desktop/DesktopLayout";

export interface AppRepository extends ChatRepository {
  renameConversation(id: string, title: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  clearAll(): Promise<void>;
}

export interface SessionService {
  check(signal?: AbortSignal): Promise<boolean>;
  authenticate(accessCode: string, signal?: AbortSignal): Promise<void>;
  signOut(signal?: AbortSignal): Promise<void>;
}

export interface AppServices {
  repository: AppRepository;
  session: SessionService;
  streamChat: StreamChatFunction;
  processImage: (file: File) => Promise<ProcessedImage>;
  llmSettings?: LlmSettingsService;
  skillSettings?: SkillSettingsService;
  webSearchSettings?: WebSearchSettingsService;
}

export interface AppProps {
  services?: AppServices;
  autoAiTitle?: boolean;
}

const productionDatabase = new YachiyoDatabase();
const productionLlmService = new LlmSettingsService(productionDatabase);
const productionSkillService = new SkillSettingsService(productionDatabase);
const productionWebSearchService = new WebSearchSettingsService(productionDatabase);
const productionServices: AppServices = {
  processImage,
  repository: new ConversationRepository(productionDatabase),
  session: new SessionClient(),
  streamChat,
  llmSettings: productionLlmService,
  skillSettings: productionSkillService,
  webSearchSettings: productionWebSearchService,
};

interface ToastState {
  id: number;
  message: string;
  tone: "info" | "error";
}

type AuthenticationState = "checking" | "authenticated";

function imageErrorMessage(code: ImageProcessingErrorCode, copy: UiCopy): string {
  if (code === "IMAGE_INVALID") return copy.imageInvalid;
  if (code === "IMAGE_TOO_LARGE") return copy.imageTooLarge;
  return copy.genericFailure;
}

function controllerErrorMessage(code: string, copy: UiCopy): string {
  if (code === "DAILY_QUOTA_EXCEEDED") return copy.quotaReached;
  if (code === "SESSION_REQUIRED") {
    return isDesktopApp() ? copy.desktopKeyRequired : copy.sessionExpired;
  }
  if (code === "WORKSPACE_REQUIRED") return copy.workspaceRequired;
  if (code === "NETWORK_ERROR") return copy.offline;
  if (code === "CONVERSATION_LIMIT") return copy.conversationLimit;
  if (code === "STORAGE_ERROR") return copy.storageFull;
  return copy.genericFailure;
}

export function App({ services, autoAiTitle }: AppProps) {
  const activeServices = services ?? productionServices;
  const llmService = activeServices.llmSettings ?? productionLlmService;
  const skillService = activeServices.skillSettings ?? productionSkillService;
  const webSearchService = activeServices.webSearchSettings ?? productionWebSearchService;
  const { isOnline } = useOnlineStatus();
  const pwa = usePwaUpdate();

  const [authentication, setAuthentication] = useState<AuthenticationState>("authenticated");
  const [composerValue, setComposerValue] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [imageUrls, setImageUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const [llmActiveProvider, setLlmActiveProvider] = useState<ProviderId>();
  const [llmEntries, setLlmEntries] = useState<
    readonly { provider: ProviderId; apiKey: string; model: string; baseUrl?: string }[]
  >([]);
  const [pendingImageDataUrl, setPendingImageDataUrl] = useState<string>();
  const [activeSkillIds, setActiveSkillIds] = useState<string[]>([]);
  const [webSearchSettings, setWebSearchSettings] = useState<WebSearchSettings>(defaultWebSearchSettings);
  const [toast, setToast] = useState<ToastState>();
  const [desktopUpdate, setDesktopUpdate] = useState<AvailableUpdate>();

  const activeLlmConfig = useMemo<ActiveLlmConfig | undefined>(() => {
    if (llmActiveProvider === undefined) return undefined;
    const entry = llmEntries.find((item) => item.provider === llmActiveProvider);
    if (entry === undefined) return undefined;
    return {
      provider: entry.provider,
      apiKey: entry.apiKey,
      model: entry.model,
      ...(entry.baseUrl !== undefined ? { baseUrl: entry.baseUrl } : {}),
    };
  }, [llmActiveProvider, llmEntries]);

  const activeSkills = useMemo(
    () => SKILLS.filter((skill) => activeSkillIds.includes(skill.id)),
    [activeSkillIds],
  );

  const refreshHistoryRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const controller = useChatController({
    repository: activeServices.repository,
    streamChat: activeServices.streamChat,
    activeLlmConfig,
    activeSkills,
    webSearchEnabled: webSearchSettings.enabled,
    webSearchSmart: webSearchSettings.smart,
    autoAiTitle: autoAiTitle ?? (services === undefined),
    onConversationUpdated: () => {
      void refreshHistoryRef.current();
    },
  });
  const setControllerOnline = controller.setOnline;
  const copy = copyFor(controller.locale);
  const handledErrorRef = useRef<string | undefined>(undefined);
  const phaseRef = useRef(controller.phase);
  useEffect(() => {
    phaseRef.current = controller.phase;
  }, [controller.phase]);
  const toastSequenceRef = useRef(0);

  useEffect(() => {
    const previousLanguage = document.documentElement.lang;
    document.documentElement.lang = controller.locale;
    return () => {
      document.documentElement.lang = previousLanguage;
    };
  }, [controller.locale]);

  const showToast = useCallback((message: string, tone: ToastState["tone"] = "info") => {
    setToast({ id: ++toastSequenceRef.current, message, tone });
  }, []);
  const showSessionFailure = useEffectEvent(() => showToast(copy.genericFailure, "error"));

  const readLlmSettings = useCallback(async () => {
    await llmService.migrateKeysToKeystore().catch(() => undefined);
    const [records, active] = await Promise.all([
      llmService.list(),
      llmService.getActiveProvider(),
    ]);
    return {
      active,
      entries: records.map((record) => ({
        provider: record.provider,
        apiKey: record.apiKey,
        model: record.model,
        ...(record.baseUrl !== undefined ? { baseUrl: record.baseUrl } : {}),
      })),
    };
  }, [llmService]);

  const syncWebSearchSettings = useCallback(async () => {
    const webSearch = await webSearchService
      .getWebSearchSettings()
      .catch(() => defaultWebSearchSettings);
    setWebSearchSettings(webSearch);
    return webSearch;
  }, [webSearchService]);

  useEffect(() => {
    let cancelled = false;
    const initApp = async () => {
      try {
        const llmSettings = await readLlmSettings();
        if (!cancelled) {
          setLlmEntries(llmSettings.entries);
          setLlmActiveProvider(llmSettings.active);
          setActiveSkillIds(await skillService.getActiveSkillIds().catch(() => []));
          await syncWebSearchSettings();
        }
      } catch {
        if (!cancelled) showSessionFailure();
      }

      // 若处于联网环境且存在 session 服务，后台静默建立或维持 session
      if (isOnline && activeServices.session) {
        try {
          const authenticated = await activeServices.session.check();
          if (!authenticated) {
            await activeServices.session.authenticate("yachiyo-local-access").catch(() => undefined);
          }
        } catch {
          // 忽略静默鉴权异常，保持界面直接可用
        }
      }

      if (!cancelled) {
        setAuthentication("authenticated");
      }
    };

    void initApp();
    return () => {
      cancelled = true;
    };
  }, [activeServices, isOnline, readLlmSettings, skillService, syncWebSearchSettings]);

  useEffect(() => {
    const timeout = setTimeout(() => setControllerOnline(isOnline), 0);
    return () => clearTimeout(timeout);
  }, [isOnline, setControllerOnline]);

  // 原生壳与桌面端启动自愈：清掉旧版本可能残留的 Service Worker 与缓存，避免升级后仍加载旧资源
  useEffect(() => {
    if (isNativeApp() || isDesktopApp()) void clearWebCaches();
  }, []);

  // 桌面端启动时静默检查一次新版本；网络失败不打扰用户
  useEffect(() => {
    if (!isDesktopApp()) return;
    let cancelled = false;
    void checkForUpdate().then((result) => {
      if (!cancelled && result?.available !== undefined) setDesktopUpdate(result.available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (toast === undefined) return;
    const timeout = setTimeout(() => setToast(undefined), 5_200);
    return () => clearTimeout(timeout);
  }, [toast]);

  const refreshHistory = useCallback(async () => {
    try {
      setConversations(await activeServices.repository.listConversations());
    } catch {
      showToast(copy.storageFull, "error");
    }
  }, [activeServices, copy.storageFull, showToast]);

  useEffect(() => {
    refreshHistoryRef.current = refreshHistory;
  }, [refreshHistory]);

  const refreshLlm = useCallback(async () => {
    try {
      const llmSettings = await readLlmSettings();
      setLlmEntries(llmSettings.entries);
      setLlmActiveProvider(llmSettings.active);
    } catch {
      showToast(copy.genericFailure, "error");
    }
  }, [copy.genericFailure, readLlmSettings, showToast]);

  const handleLlmSave = useCallback(
    async (provider: ProviderId, apiKey: string, model: string, baseUrl?: string) => {
      await llmService.saveProvider(provider, apiKey, model, baseUrl !== undefined ? { baseUrl } : {});
      await refreshLlm();
    },
    [llmService, refreshLlm],
  );

  const handleLlmClear = useCallback(
    async (provider: ProviderId) => {
      await llmService.clear(provider);
      await refreshLlm();
    },
    [llmService, refreshLlm],
  );

  const handleLlmActivate = useCallback(
    async (provider: ProviderId) => {
      await llmService.setActiveProvider(provider);
      setLlmActiveProvider(provider);
    },
    [llmService],
  );

  const handleSkillToggle = useCallback(
    async (id: string, next: boolean) => {
      setActiveSkillIds((current) => {
        const updated = next
          ? [...new Set([...current, id])]
          : current.filter((skillId) => skillId !== id);
        void skillService.setActiveSkillIds(updated).catch(() => undefined);
        return updated;
      });
    },
    [skillService],
  );

  const handleWebSearchSettingsChange = useCallback(
    (partial: Partial<WebSearchSettings>) => {
      setWebSearchSettings((current) => {
        const next = { ...current, ...partial };
        void webSearchService.set(next).catch(() => undefined);
        return next;
      });
    },
    [webSearchService],
  );

  useEffect(() => {
    if (authentication !== "authenticated") return;
    let cancelled = false;
    void activeServices.repository.listConversations().then((items) => {
      if (!cancelled) setConversations(items);
    });
    return () => {
      cancelled = true;
    };
  }, [activeServices, authentication, controller.activeConversation?.id]);

  const blobUrlsRef = useRef<Map<string, string>>(new Map());
  const creatingChatRef = useRef(false);

  // 稳定签名：只有 imageId 集合变化时才触发 Blob 加载 effect
  const messageImageIdsKey = useMemo(
    () =>
      controller.messages.flatMap(({ imageId }) => (imageId === undefined ? [] : [imageId]))
        .sort()
        .join("\n"),
    [controller.messages],
  );
  const messageImageIds = useMemo(() => {
    const key = messageImageIdsKey;
    return key.length === 0 ? [] : key.split("\n");
  }, [messageImageIdsKey]);

  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") {
      return;
    }
    let cancelled = false;
    const missingIds = messageImageIds.filter((id) => !blobUrlsRef.current.has(id));

    if (missingIds.length > 0) {
      const loadImages = async (retryCount = 0) => {
        const entries = await Promise.all(
          missingIds.map(async (id) => {
            if (blobUrlsRef.current.has(id)) return [id, blobUrlsRef.current.get(id)!] as const;
            const image = await activeServices.repository.getImage(id);
            if (image === undefined) return undefined;
            const url = URL.createObjectURL(image.blob);
            blobUrlsRef.current.set(id, url);
            return [id, url] as const;
          }),
        );
        if (!cancelled && entries.some((entry) => entry !== undefined)) {
          setImageUrls(new Map(blobUrlsRef.current));
        }
        const stillMissing = missingIds.filter((id) => !blobUrlsRef.current.has(id));
        if (!cancelled && stillMissing.length > 0 && retryCount < 3) {
          setTimeout(() => {
            if (!cancelled) void loadImages(retryCount + 1);
          }, 150 * (retryCount + 1));
        }
      };
      void loadImages();
    }

    return () => {
      cancelled = true;
    };
  }, [activeServices, messageImageIds]);

  useEffect(() => {
    const cache = blobUrlsRef.current;
    return () => {
      for (const url of cache.values()) {
        URL.revokeObjectURL(url);
      }
      cache.clear();
    };
  }, []);

  useEffect(() => {
    const errorCode = controller.errorCode;
    if (errorCode === undefined) {
      handledErrorRef.current = undefined;
      return;
    }
    if (handledErrorRef.current === errorCode) return;
    handledErrorRef.current = errorCode;
    const timeout = setTimeout(() => {
      if (errorCode === "SESSION_REQUIRED" && activeServices.session) {
        void activeServices.session.authenticate("yachiyo-local-access").catch(() => undefined);
      }
      const isBannerError =
        phaseRef.current === "error" &&
        errorCode !== "DAILY_QUOTA_EXCEEDED" &&
        errorCode !== "SESSION_REQUIRED";
      if (!isBannerError) {
        showToast(controllerErrorMessage(errorCode, copy), "error");
      }
    }, 0);
    return () => clearTimeout(timeout);
  }, [activeServices.session, controller.errorCode, copy, showToast]);

  const handleImage = useCallback(
    (image: ProcessedImage) => {
      const conversationId = controller.activeConversation?.id;
      if (conversationId === undefined) return;
      const imageId = crypto.randomUUID();
      const storedImage: StoredImage = {
        blob: image.blob,
        conversationId,
        height: image.height,
        id: imageId,
        mimeType: image.mimeType,
        width: image.width,
      };
      if (typeof URL.createObjectURL === "function") {
        const url = URL.createObjectURL(image.blob);
        blobUrlsRef.current.set(imageId, url);
        setImageUrls(new Map(blobUrlsRef.current));
      }
      controller.setPendingImage(storedImage);
      setPendingImageDataUrl(image.dataUrl);
    },
    [controller],
  );

  const handleSend = (value: string) => {
    void controller.send(value);
    setComposerValue("");
    setPendingImageDataUrl(undefined);
  };

  const handleRecall = useCallback(async () => {
    const recalled = await controller.recall();
    if (recalled) {
      if (recalled.text !== undefined) {
        setComposerValue(recalled.text);
      }
      if (recalled.imageId) {
        const image = await activeServices.repository.getImage(recalled.imageId);
        if (image) {
          controller.setPendingImage(image);
          if (typeof URL.createObjectURL === "function") {
            const url = URL.createObjectURL(image.blob);
            blobUrlsRef.current.set(image.id, url);
            setImageUrls(new Map(blobUrlsRef.current));
            setPendingImageDataUrl(url);
          }
        }
      }
      showToast(copy.recallSuccess, "info");
      await refreshHistory();
    }
  }, [activeServices, controller, copy.recallSuccess, refreshHistory, showToast]);

  const handleRegenerate = useCallback(
    async (messageId?: string) => {
      await controller.regenerate(messageId);
      await refreshHistory();
    },
    [controller, refreshHistory],
  );

  const handleLocale = async (locale: Locale) => {
    await controller.setLocale(locale);
    await refreshHistory();
  };

  const handleNewChat = async () => {
    if (creatingChatRef.current) return;
    creatingChatRef.current = true;
    try {
      await controller.newConversation();
      setComposerValue("");
      setPendingImageDataUrl(undefined);
      await refreshHistory();
    } finally {
      creatingChatRef.current = false;
    }
  };

  const handleRename = async (id: string, title: string) => {
    await controller.renameConversation(id, title);
    await refreshHistory();
  };

  const handleDelete = async (id: string) => {
    const deletingActive = controller.activeConversation?.id === id;
    await activeServices.repository.deleteConversation(id);
    if (deletingActive) {
      const remaining = await activeServices.repository.listConversations();
      if (remaining[0] === undefined) await controller.newConversation();
      else await controller.selectConversation(remaining[0].id);
    }
    await refreshHistory();
  };

  const handleClearData = async () => {
    for (const url of blobUrlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    blobUrlsRef.current.clear();
    setImageUrls(new Map());
    await activeServices.repository.clearAll();
    await activeServices.repository.setLocale(controller.locale);
    await llmService.clearAll();
    setActiveSkillIds([]);
    await skillService.clear();
    setWebSearchSettings(defaultWebSearchSettings);
    await webSearchService.clear().catch(() => undefined);
    setLlmEntries([]);
    setLlmActiveProvider(undefined);
    await projectManager.clear().catch(() => undefined);
    await controller.newConversation();
    setComposerValue("");
    setPendingImageDataUrl(undefined);
    await refreshHistory();
  };

  const handleSignOut = async () => {
    await controller.stop();
    await activeServices.session.signOut();
    showToast("服务端凭据已清除", "info");
  };

  // 自定义端点或自定义指定的非内置模型图片能力交由上游判定，内置预设模型遵循白名单
  const activeProviderSupportsImage =
    activeLlmConfig === undefined ||
    activeLlmConfig.baseUrl !== undefined ||
    !PROVIDER_METADATA[activeLlmConfig.provider].models.includes(activeLlmConfig.model) ||
    PROVIDER_METADATA[activeLlmConfig.provider].imageModels.includes(activeLlmConfig.model);

  useEffect(() => {
    const handleGlobalPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        authentication !== "authenticated" ||
        controller.phase === "streaming" ||
        controller.phase === "compressing" ||
        controller.phase === "loading"
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      const items = event.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            if (!isOnline || controller.phase === "offline") {
              showToast(copy.offline, "error");
              return;
            }
            if (!activeProviderSupportsImage) {
              showToast(copy.llmNoImageSupport, "error");
              return;
            }
            void (activeServices.processImage ?? processImage)(file)
              .then((image) => handleImage(image))
              .catch((error) => {
                showToast(
                  imageErrorMessage(
                    error instanceof ImageProcessingError ? error.code : "IMAGE_DECODE_FAILED",
                    copy,
                  ),
                  "error",
                );
              });
            return;
          }
        }
      }
    };

    window.addEventListener("paste", handleGlobalPaste);
    return () => {
      window.removeEventListener("paste", handleGlobalPaste);
    };
  }, [
    activeProviderSupportsImage,
    activeServices.processImage,
    authentication,
    controller.phase,
    copy,
    handleImage,
    isOnline,
    showToast,
  ]);

  const sharedProps: SharedViewProps = {
    activeProviderSupportsImage,
    activeSkillIds,
    composerValue,
    controller,
    conversations,
    copy,
    imageUrls,
    isOnline,
    llmActiveProvider,
    llmEntries,
    onClearData: handleClearData,
    onDelete: handleDelete,
    onImage: handleImage,
    onLlmActivate: handleLlmActivate,
    onLlmClear: handleLlmClear,
    onLlmSave: handleLlmSave,
    onLocale: handleLocale,
    onNewChat: handleNewChat,
    onRecall: handleRecall,
    onRegenerate: handleRegenerate,
    onRename: handleRename,
    onSend: handleSend,
    onSignOut: handleSignOut,
    onSkillToggle: handleSkillToggle,
    onWebSearchSettingsChange: handleWebSearchSettingsChange,
    pendingImageDataUrl,
    processImage: activeServices.processImage,
    pwa,
    refreshHistory,
    refreshLlm,
    setComposerValue,
    setPendingImageDataUrl,
    showToast,
    webSearchSettings,
  };

  const authenticatedContent =
    controller.phase === "loading" ? (
      <div aria-label={copy.verifying} className="chat-loading" role="status">
        <span />
        <span />
        <span />
      </div>
    ) : (
      <div className="layout-transition-view layout-transition-view--desktop">
        <DesktopLayout {...sharedProps} />
      </div>
    );

  return (
    <main
      className="app-shell app-shell--desktop"
      aria-label="Yachiyo Chat"
    >
      <div className="chat-stage chat-stage--desktop">
        {authentication === "checking" ? (
          <div aria-label={copy.verifying} className="chat-loading" role="status">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <>
            {authenticatedContent}
            <UpdatePrompt
              copy={copy}
              needRefresh={pwa.needRefresh}
              offlineReady={pwa.offlineReady}
              onConfirmOfflineReady={() => pwa.setOfflineReady(false)}
              onDismissUpdate={() => pwa.setNeedRefresh(false)}
              onUpdate={() => void pwa.updateServiceWorker(true)}
            />
            {desktopUpdate !== undefined ? (
              <DesktopUpdateNotice
                copy={copy}
                update={desktopUpdate}
                onDismiss={() => setDesktopUpdate(undefined)}
              />
            ) : null}
          </>
        )}
        <ToastRegion
          announcementId={toast?.id}
          message={toast?.message}
          tone={toast?.tone}
        />
      </div>
    </main>
  );
}
