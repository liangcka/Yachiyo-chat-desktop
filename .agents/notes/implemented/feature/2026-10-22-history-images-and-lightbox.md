# Agent Note: 上文图片随请求重发与气泡图片放大

Status: implemented

## Problem

请求里只有最后一条用户消息会带图，网关校验也只认这一条；更早发过的图在后续轮次里被丢掉，只发了图、没写字的消息还会因正文为空被整条跳过。模型因此无法联系上文看图，用户追问「刚才那张图」时模型并不知道有过这张图。聊天气泡里的图片最高 18rem，也没有放大入口。

## Decision

- 客户端 `selectRequestImages` 从最新往前给带图的用户消息取图：最后一条的图必带；更早的图按张数（`maximumRequestImages = 4`）与编码体积预算（150 万字符）重发，超出即停。体积预算参照桌面网关 axum `Json` 默认的 2MB 请求体上限，并留出文字余量；网页端请求体上限 3MB，同一预算也满足。
- 没能带上的图（超预算、读不到，或用于摘要请求）在正文前补一句说明，让模型知道那里有过一张图；只发图的消息不再被历史裁剪跳过。
- Pages Functions 校验改为：任意 user 消息都可带图，单次最多 4 张，assistant 消息带图仍判为非法。桌面网关原本就不限制带图的位置，无需改动。
- 气泡图片改为可点击按钮，打开共用的 `ImageLightbox`（与成果面板共用，Esc 关闭）。灯箱经 portal 挂到 body：聊天栏设了 `container-type`，会成为 fixed 元素的包含块。

## Alternatives considered

- 只给最近一张历史图：仍无法比较多张图，收益有限。
- 历史图降采样后再发：需要在请求路径上重新解码编码，代价高；预算内原图已能覆盖常见截图与照片。

## Consequences

- 带图的会话每轮请求都会重发上文的图，输入 token 与请求体积随之增加。
- 只支持单图输入的视觉模型（如 glm-4v-flash）在上文已有图时可能被上游拒绝。

## Verification

- `npm run test:unit`（含 `MessageBubble.test.tsx`、`use-chat-controller.test.tsx` 的上文图片用例）
- `npm run test:functions`（`validation.test.ts` 的上文图片与张数上限用例）
- `npm run typecheck`、`npm run lint`
