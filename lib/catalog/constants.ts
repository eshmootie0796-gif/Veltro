export const CATEGORY_SLUGS = {
  visaMastercard: "visa-mastercard",
  giftCardsPremium: "gift-cards-premium",
  aiSubscriptions: "ai-subscriptions",
  cryptocurrency: "cryptocurrency",
  paypalServices: "paypal-services",
  internationalShopping: "international-shopping",
  inAppGamePurchases: "in-app-game-purchases",
  hotelsFlights: "international-hotels-flights",
} as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[keyof typeof CATEGORY_SLUGS];

export const FIELD_TYPES = [
  "text",
  "email",
  "number",
  "select",
  "multi_select",
  "date",
  "url",
  "textarea",
  "boolean",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

type AiServiceDef = {
  catalogKey: string;
  slug: string;
  title: string;
  group: string;
};

/** Predefined AI catalog — admins manage plans/prices only, not arbitrary creation. */
export const AI_SERVICE_CATALOG: readonly AiServiceDef[] = [
  // Assistants and Chatbots
  { catalogKey: "ai.chatgpt", slug: "chatgpt", title: "ChatGPT", group: "assistants" },
  { catalogKey: "ai.claude", slug: "claude", title: "Claude", group: "assistants" },
  { catalogKey: "ai.gemini", slug: "gemini", title: "Gemini", group: "assistants" },
  { catalogKey: "ai.perplexity", slug: "perplexity", title: "Perplexity", group: "assistants" },
  { catalogKey: "ai.monica", slug: "monica", title: "Monica", group: "assistants" },
  { catalogKey: "ai.deepseek", slug: "deepseek", title: "Deepseek", group: "assistants" },
  { catalogKey: "ai.grok", slug: "grok", title: "Grok", group: "assistants" },
  { catalogKey: "ai.you-com", slug: "you-com", title: "You.com", group: "assistants" },
  {
    catalogKey: "ai.microsoft-copilot",
    slug: "microsoft-copilot",
    title: "Microsoft Copilot",
    group: "assistants",
  },
  { catalogKey: "ai.poe", slug: "poe", title: "POE", group: "assistants" },
  { catalogKey: "ai.qwen-ai", slug: "qwen-ai", title: "Qwen AI", group: "assistants" },
  // AI Programming
  { catalogKey: "ai.lovable", slug: "lovable", title: "Lovable", group: "programming" },
  {
    catalogKey: "ai.github-copilot",
    slug: "github-copilot",
    title: "GitHub Copilot",
    group: "programming",
  },
  { catalogKey: "ai.replit", slug: "replit", title: "Replit", group: "programming" },
  { catalogKey: "ai.kimi-ai", slug: "kimi-ai", title: "Kimi AI", group: "programming" },
  { catalogKey: "ai.trae", slug: "trae", title: "Trae", group: "programming" },
  { catalogKey: "ai.v0", slug: "v0", title: "V0", group: "programming" },
  { catalogKey: "ai.cursor", slug: "cursor", title: "Cursor", group: "programming" },
  // Writing
  { catalogKey: "ai.jasper-ai", slug: "jasper-ai", title: "Jasper AI", group: "writing" },
  { catalogKey: "ai.grammarly", slug: "grammarly", title: "Grammarly", group: "writing" },
  // Image
  { catalogKey: "ai.freepik", slug: "freepik", title: "Freepik", group: "image" },
  { catalogKey: "ai.dzine-ai", slug: "dzine-ai", title: "Dzine AI", group: "image" },
  { catalogKey: "ai.krea-ai", slug: "krea-ai", title: "Krea AI", group: "image" },
  { catalogKey: "ai.stability-ai", slug: "stability-ai", title: "Stability AI", group: "image" },
  { catalogKey: "ai.leonardo-ai", slug: "leonardo-ai", title: "Leonardo AI", group: "image" },
  { catalogKey: "ai.midjourney", slug: "midjourney", title: "Midjourney", group: "image" },
  { catalogKey: "ai.nanobanana", slug: "nanobanana", title: "NanoBanana", group: "image" },
  // Audio
  { catalogKey: "ai.beatoven", slug: "beatoven", title: "Beatoven", group: "audio" },
  { catalogKey: "ai.murf-ai", slug: "murf-ai", title: "Murf AI", group: "audio" },
  { catalogKey: "ai.playht", slug: "playht", title: "PlayHT", group: "audio" },
  { catalogKey: "ai.suno", slug: "suno", title: "Suno", group: "audio" },
  { catalogKey: "ai.elevenlabs", slug: "elevenlabs", title: "ElevenLabs", group: "audio" },
  // Video
  { catalogKey: "ai.fliki", slug: "fliki", title: "Fliki", group: "video" },
  { catalogKey: "ai.synthesia", slug: "synthesia", title: "Synthesia", group: "video" },
  { catalogKey: "ai.pika", slug: "pika", title: "Pika", group: "video" },
  { catalogKey: "ai.runway", slug: "runway", title: "Runway", group: "video" },
  { catalogKey: "ai.kling-ai", slug: "kling-ai", title: "Kling AI", group: "video" },
  { catalogKey: "ai.invideo", slug: "invideo", title: "Invideo", group: "video" },
  { catalogKey: "ai.ltx-studio", slug: "ltx-studio", title: "LTX Studio", group: "video" },
  { catalogKey: "ai.descript", slug: "descript", title: "Descript", group: "video" },
  { catalogKey: "ai.sora", slug: "sora", title: "Sora", group: "video" },
  { catalogKey: "ai.heygen", slug: "heygen", title: "HeyGen", group: "video" },
  { catalogKey: "ai.hedra", slug: "hedra", title: "Hedra", group: "video" },
  { catalogKey: "ai.captions", slug: "captions", title: "Captions", group: "video" },
  { catalogKey: "ai.veed", slug: "veed", title: "Veed", group: "video" },
  { catalogKey: "ai.hailuo", slug: "hailuo", title: "Hailuo", group: "video" },
  { catalogKey: "ai.seedance", slug: "seedance", title: "Seedance", group: "video" },
  { catalogKey: "ai.higgsfield", slug: "higgsfield", title: "Higgsfield", group: "video" },
  { catalogKey: "ai.vidu-ai", slug: "vidu-ai", title: "Vidu AI", group: "video" },
  { catalogKey: "ai.wan-ai", slug: "wan-ai", title: "Wan AI", group: "video" },
  // Research
  { catalogKey: "ai.notebook-lm", slug: "notebook-lm", title: "Notebook LM", group: "research" },
  { catalogKey: "ai.genspark", slug: "genspark", title: "Genspark", group: "research" },
  { catalogKey: "ai.gamma", slug: "gamma", title: "Gamma", group: "research" },
  // Automation
  { catalogKey: "ai.manus", slug: "manus", title: "Manus", group: "automation" },
  { catalogKey: "ai.n8n", slug: "n8n", title: "n8n", group: "automation" },
] as const;

export const PAYPAL_SERVICE_CATALOG = [
  {
    catalogKey: "paypal.top-up",
    slug: "paypal-top-up",
    title: "PayPal account top-up",
  },
  {
    catalogKey: "paypal.send-money",
    slug: "paypal-send-money",
    title: "Send money to PayPal account",
  },
  {
    catalogKey: "paypal.receive-money",
    slug: "paypal-receive-money",
    title: "Receive money in PayPal account",
  },
] as const;

export const AI_ACCOUNT_EMAIL_FIELD = {
  key: "account_email",
  labelEn: "Account email",
  labelFa: "ایمیل حساب",
  fieldType: "email" as const,
  isRequired: true,
};
