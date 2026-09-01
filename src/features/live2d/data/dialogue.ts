import type { AiReactionPreset, DialogueItem, TimedDialogue } from "../types";

export const CHARACTERS_DEFAULT_DIALOGUES: DialogueItem[][] = [
  // 0: 高松 灯 (Tomori)
  [
    { text: "即便迷茫，也要前进！", motion: "kime01" },
    { text: "能和我组一辈子的乐队吗？", motion: "kandou01" },
    { text: "这个笔记本，封面有各种图案……我有全部种类。", motion: "smile02" },
    { text: "我能做的就只有拼命去唱了，因为我的歌，就是内心的呐喊！", motion: "sing01" },
    { text: "只要将无数个瞬间积攒起来……我想就能成为一辈子。", motion: "thinking01" },
    { text: "要是创可贴，也能贴在心灵上就好了……", motion: "shame01" },
    { text: "小爱她非常迷茫，我也想成为她那样的迷路的孩子……", motion: "sad04" },
    { text: "即使我们家最近的车站不一样，小立希也总会送我到家门口。", motion: "smile01" },
    { text: "买了好多的便签……感觉可以用便签来排列话语……", motion: "smile01" },
    { text: "迷路也不要紧，迷茫也要前进！", motion: "kime01" },
  ],
  // 1: 千早 爱音 (Anon)
  [
    { text: "就算失败一次，也要有重来的信心！不然人生这么长，怎么过得下去？", motion: "kime02" },
    { text: "那么～要不要一起前进？一起在迷失之中前进～", motion: "smile01" },
    { text: "我很擅长写作文的！", motion: "smile03" },
    { text: "我不会退出了，爽世世也不要退出哦～", motion: "smile03" },
    { text: "虽然练习很辛苦……但我可没说过我要放弃！", motion: "cry01" },
    { text: "狸希～！这里有杏仁豆腐奶昔，还有杏仁豆腐汉堡哦！", motion: "smile03" },
    { text: "如果我没有邀请迷住大家的灯灯，或许现在就不会有 MyGO!!!!! 的诞生了哦？", motion: "smile02" },
    { text: "今天有努力练习，所以买了一份草莓豪华可丽饼～♪", motion: "smile01" },
    { text: "就算迷茫，也要前进！", motion: "kime01" },
  ],
  // 2: 要 乐奈 (Rana)
  [
    { text: "有趣的女人。", motion: "smile01" },
    { text: "抹茶芭菲！", motion: "smile04" },
    { text: "这是外婆的吉他。", motion: "serious01" },
    { text: "不开始吗？乐队。", motion: "thinking01" },
    { text: "外婆说归宿这东西，总会有人再创造出来。", motion: "thinking01" },
    { text: "想吃的时候就吃，这样会很幸福。", motion: "smile01" },
    { text: "好闻的弦能弹出好的声音。", motion: "smile04" },
    { text: "有抹茶饮料的活动。我要去。", motion: "smile04" },
    { text: "不错的长椅。蜷缩着睡觉的时候，大小刚好合适。", motion: "smile02" },
  ],
  // 3: 长崎 爽世 (Soyo)
  [
    { text: "暖暖的感觉，就像春天的阳光一样。珍贵的，特别的，无可替代的归宿。", motion: "smile01" },
    { text: "我想，小灯的歌词其实也是我的呐喊。", motion: "kandou01" },
    { text: "我真的很重视大家，很喜欢大家……", motion: "smile02" },
    { text: "大家可要注意身体健康啊～", motion: "smile02" },
    { text: "因为某人曾经说过「要一辈子组乐队」这种话，所以我想要保持健康。", motion: "serious04" },
    { text: "偶尔什么也不做，悠闲地度过也不错吧？", motion: "smile02" },
    { text: "小灯，给你磅蛋糕。我今天在学校的课堂上做的。", motion: "smile04" },
    { text: "要不要去那边的咖啡厅里买点喝的？给大家带点慰劳品吧。", motion: "smile04" },
  ],
  // 4: 椎名 立希 (Taki)
  [
    { text: "灯的歌，让人感动……唱得太棒了！", motion: "kandou01" },
    { text: "节奏不能再放慢一点了，要的就是那种冲刺感。", motion: "kime01" },
    { text: "无法用语言描述的心情，都被灯转化成了歌声……", motion: "smile01" },
    { text: "我们已经决定了要一起前进。", motion: "kime01" },
    { text: "就算我们都成为了大学生，我也希望能作为 MyGO!!!!! 继续活动呢。", motion: "smile03" },
    { text: "只要站上舞台，对我来说就足够了……", motion: "smile04" },
    { text: "新曲的练习很顺利……接下来也要全力以赴。", motion: "serious01" },
  ],
];

export const TIMED_DIALOGUES: TimedDialogue[] = [
  {
    hourStart: 6,
    hourEnd: 8,
    dialogues: [
      [{ text: "早上好。要准备开始新的一天了……", motion: "smile01" }],
      [{ text: "早上好！今天也是元气满满的一天～", motion: "smile02" }],
      [{ text: "早上好。早餐吃荞麦面。", motion: "smile01" }],
      [{ text: "早上好！早睡早起有益健康哦～", motion: "smile02" }],
      [{ text: "早安。虽然还有点困，但加油吧。", motion: "serious01" }],
    ],
  },
  {
    hourStart: 12,
    hourEnd: 13,
    dialogues: [
      [{ text: "中午了。稍微休息一下吃点东西吧。", motion: "smile01" }],
      [{ text: "午休时间到了！今天吃什么好吃的呢～", motion: "smile02" }],
      [{ text: "中午。抹茶冰淇淋时间。", motion: "smile04" }],
      [{ text: "午休时间，记得好好补充能量哦。", motion: "smile04" }],
      [{ text: "中午了，别忘了准时吃饭。", motion: "serious01" }],
    ],
  },
  {
    hourStart: 18,
    hourEnd: 21,
    dialogues: [
      [{ text: "傍晚的天空很美……今天也辛苦了。", motion: "smile02" }],
      [{ text: "晚上好！今天有什么有趣的见闻吗～", motion: "smile03" }],
      [{ text: "天黑了。想弹吉他。", motion: "smile04" }],
      [{ text: "晚上好，忙碌了一天，好好放松一下吧。", motion: "smile01" }],
      [{ text: "晚上好。今天的工作和学习还顺利吗？", motion: "serious01" }],
    ],
  },
  {
    hourStart: 22,
    hourEnd: 5,
    dialogues: [
      [{ text: "已经很晚了……早点休息，明天还要一起前进呢。", motion: "smile01" }],
      [{ text: "这么晚还不睡会有黑眼圈哦！赶紧去休息吧～", motion: "serious01" }],
      [{ text: "困了。晚安。", motion: "smile02" }],
      [{ text: "熬夜可是健康的大敌，快点睡觉哦～", motion: "serious01" }],
      [{ text: "很晚了。不要再通宵了，快去睡吧。", motion: "serious01" }],
    ],
  },
];

export const AI_REACTION_PRESETS: AiReactionPreset[] = [
  // 0: 灯 (Tomori)
  {
    streaming: [
      { text: "正在努力构思回答中……请稍等一下。", motion: "thinking01" },
      { text: "把想说的话……一点点排列出来……", motion: "thinking02" },
      { text: "这是心中的歌词……正在唱给你听。", motion: "sing01" },
    ],
    completed: [
      { text: "回答完成啦！希望能帮上你的忙……！", motion: "smile01" },
      { text: "这是我竭尽全力写下的心声哦。", motion: "kandou01" },
      { text: "就算迷茫，也找到了答案呢！", motion: "kime01" },
    ],
    error: [
      { text: "诶……发生错误了……如果把眼泪收集起来就好了……", motion: "sad01" },
      { text: "怎么会这样……让我再试一次吧……！", motion: "cry01" },
    ],
    idle: [
      { text: "有什么我可以帮忙的吗？我们一起前进吧。", motion: "smile01" },
      { text: "在这里静静地陪伴着你……", motion: "thinking01" },
    ],
  },
  // 1: 爱音 (Anon)
  {
    streaming: [
      { text: "正在飞速思考中～答案马上就来！", motion: "thinking01" },
      { text: "哼哼，等本爱音为你组织出最完美的解答！", motion: "smile02" },
      { text: "努力检索中……可不要小看我的实力哦！", motion: "wink01" },
    ],
    completed: [
      { text: "搞定！不愧是我～快看看怎么样！", motion: "smile01" },
      { text: "当当～回答出炉！有帮到你吧？", motion: "smile03" },
      { text: "只要不放弃，就一定能解决问题！", motion: "kime02" },
    ],
    error: [
      { text: "呜哇！好像连接出错啦……再试一次看看？", motion: "surprised01" },
      { text: "就算失败一次，也要有重来的信心！不要慌～", motion: "kime01" },
    ],
    idle: [
      { text: "在想什么呢？要不要跟我聊聊天～？", motion: "smile01" },
      { text: "随时准备好为你效劳啦～", motion: "wink01" },
    ],
  },
  // 2: 乐奈 (Rana)
  {
    streaming: [
      { text: "正在想……", motion: "thinking01" },
      { text: "弹奏旋律中……", motion: "kime01" },
    ],
    completed: [
      { text: "写好了。抹茶芭菲。", motion: "smile04" },
      { text: "完成了。拿去吧。", motion: "smile01" },
    ],
    error: [
      { text: "坏掉了。好无聊。", motion: "sad01" },
      { text: "出现问题了。", motion: "serious01" },
    ],
    idle: [
      { text: "不提问吗？", motion: "thinking01" },
      { text: "好闻的味道。", motion: "smile04" },
    ],
  },
  // 3: 爽世 (Soyo)
  {
    streaming: [
      { text: "正在为您整理思绪，请稍候片刻呢……", motion: "thinking01" },
      { text: "仔细斟酌每句话……希望能给您最好的回应。", motion: "serious01" },
    ],
    completed: [
      { text: "回复已经准备好了，希望能让您满意～", motion: "smile01" },
      { text: "整理完毕了，有任何疑问都可以继续告诉我哦。", motion: "smile02" },
    ],
    error: [
      { text: "哎呀，似乎遇到了网络问题呢……请再尝试一次吧。", motion: "sad01" },
      { text: "请不要着急，我们重新连接一下吧。", motion: "serious02" },
    ],
    idle: [
      { text: "如果感到疲惫的话，记得喝杯红茶放松一下哦。", motion: "smile04" },
      { text: "我随时都在这里陪伴着您呢。", motion: "smile01" },
    ],
  },
  // 4: 立希 (Taki)
  {
    streaming: [
      { text: "正在构思中，等我一下……", motion: "serious01" },
      { text: "正在高速处理中……马上就好。", motion: "thinking01" },
    ],
    completed: [
      { text: "完成了。拿去看看吧。", motion: "smile01" },
      { text: "回答生成好了，希望对你有用。", motion: "smile04" },
    ],
    error: [
      { text: "切……请求好像失败了，再试一次吧。", motion: "angry01" },
      { text: "出了点意外……别担心，重新发送就好。", motion: "serious02" },
    ],
    idle: [
      { text: "有什么问题随时问，别一个人憋着。", motion: "serious01" },
      { text: "今天也要加油搞定所有任务啊。", motion: "smile04" },
    ],
  },
];

export function getRandomDefaultDialogue(charIndex: number): DialogueItem {
  const safeIdx = Math.max(0, Math.min(charIndex, CHARACTERS_DEFAULT_DIALOGUES.length - 1));
  const list = CHARACTERS_DEFAULT_DIALOGUES[safeIdx] ?? CHARACTERS_DEFAULT_DIALOGUES[0];
  const item = list[Math.floor(Math.random() * list.length)];
  return item ?? { text: "即便迷茫，也要前进！", motion: "kime01" };
}

export function getTimedDialogue(charIndex: number, date = new Date()): DialogueItem | null {
  const hour = date.getHours();
  const safeIdx = Math.max(0, Math.min(charIndex, 4));

  for (const timed of TIMED_DIALOGUES) {
    const inRange =
      timed.hourStart <= timed.hourEnd
        ? hour >= timed.hourStart && hour <= timed.hourEnd
        : hour >= timed.hourStart || hour <= timed.hourEnd;

    if (inRange) {
      const charDialogues = timed.dialogues[safeIdx];
      if (charDialogues && charDialogues.length > 0) {
        return charDialogues[Math.floor(Math.random() * charDialogues.length)] ?? null;
      }
    }
  }
  return null;
}

export function getAiReactionDialogue(
  charIndex: number,
  reaction: "streaming" | "completed" | "error" | "idle",
): DialogueItem {
  const safeIdx = Math.max(0, Math.min(charIndex, AI_REACTION_PRESETS.length - 1));
  const preset = AI_REACTION_PRESETS[safeIdx] ?? AI_REACTION_PRESETS[0];
  const list = preset[reaction];
  if (list && list.length > 0) {
    return list[Math.floor(Math.random() * list.length)] ?? { text: "...", motion: "idle01" };
  }
  return { text: "...", motion: "idle01" };
}
