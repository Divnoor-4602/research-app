// Curated list of models from Vercel AI Gateway with tool calling and reasoning support
export const DEFAULT_CHAT_MODEL = "google/gemini-2.5-flash-preview-05-20";

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
};

export const chatModels: ChatModel[] = [
  // ============================================================================
  // Anthropic - All support tool calling
  // ============================================================================
  {
    id: "anthropic/claude-3-5-haiku-latest",
    name: "Claude 3.5 Haiku",
    provider: "anthropic",
    description: "Fast and affordable, great for everyday tasks",
  },
  {
    id: "anthropic/claude-3-5-sonnet-latest",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    description: "Best balance of speed, intelligence, and cost",
  },
  {
    id: "anthropic/claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    description: "Latest Sonnet with improved reasoning",
  },
  {
    id: "anthropic/claude-opus-4-20250514",
    name: "Claude Opus 4",
    provider: "anthropic",
    description: "Most capable Anthropic model",
  },

  // ============================================================================
  // OpenAI - All support tool calling
  // ============================================================================
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    description: "Fast and cost-effective for simple tasks",
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    description: "Flagship multimodal model",
  },
  {
    id: "openai/gpt-4-turbo",
    name: "GPT-4 Turbo",
    provider: "openai",
    description: "128K context with vision support",
  },
  {
    id: "openai/gpt-4.1",
    name: "GPT-4.1",
    provider: "openai",
    description: "Latest GPT-4 series model",
  },
  {
    id: "openai/gpt-4.1-mini",
    name: "GPT-4.1 Mini",
    provider: "openai",
    description: "Efficient version of GPT-4.1",
  },
  {
    id: "openai/gpt-4.1-nano",
    name: "GPT-4.1 Nano",
    provider: "openai",
    description: "Smallest and fastest GPT-4.1",
  },

  // ============================================================================
  // Google - Gemini models with tool calling
  // ============================================================================
  {
    id: "google/gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "google",
    description: "Fast multimodal with 1M context",
  },
  {
    id: "google/gemini-2.0-flash-lite",
    name: "Gemini 2.0 Flash Lite",
    provider: "google",
    description: "Ultra fast and affordable",
  },
  {
    id: "google/gemini-2.5-pro-preview-05-06",
    name: "Gemini 2.5 Pro",
    provider: "google",
    description: "Most capable Google model",
  },
  {
    id: "google/gemini-2.5-flash-preview-05-20",
    name: "Gemini 2.5 Flash",
    provider: "google",
    description: "Fast with enhanced reasoning",
  },

  // ============================================================================
  // xAI - Grok models with tool calling
  // ============================================================================
  {
    id: "xai/grok-2-1212",
    name: "Grok 2",
    provider: "xai",
    description: "Latest Grok with 128K context",
  },
  {
    id: "xai/grok-2-vision-1212",
    name: "Grok 2 Vision",
    provider: "xai",
    description: "Multimodal Grok with vision",
  },
  {
    id: "xai/grok-3-beta",
    name: "Grok 3 Beta",
    provider: "xai",
    description: "Next-gen Grok model",
  },
  {
    id: "xai/grok-3-mini-beta",
    name: "Grok 3 Mini Beta",
    provider: "xai",
    description: "Efficient Grok 3 variant",
  },

  // ============================================================================
  // DeepSeek - Advanced reasoning models
  // ============================================================================
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek V3",
    provider: "deepseek",
    description: "671B MoE model, excellent reasoning",
  },
  {
    id: "deepseek/deepseek-reasoner",
    name: "DeepSeek R1",
    provider: "deepseek",
    description: "Reasoning model with chain-of-thought",
  },

  // ============================================================================
  // Mistral - European AI with tool calling
  // ============================================================================
  {
    id: "mistral/mistral-large-latest",
    name: "Mistral Large",
    provider: "mistral",
    description: "Flagship Mistral model, 128K context",
  },
  {
    id: "mistral/mistral-small-latest",
    name: "Mistral Small",
    provider: "mistral",
    description: "Fast and efficient",
  },
  {
    id: "mistral/codestral-latest",
    name: "Codestral",
    provider: "mistral",
    description: "Optimized for code generation",
  },
  {
    id: "mistral/ministral-8b-latest",
    name: "Ministral 8B",
    provider: "mistral",
    description: "Compact model for edge deployment",
  },
  {
    id: "mistral/pixtral-large-latest",
    name: "Pixtral Large",
    provider: "mistral",
    description: "Multimodal Mistral with vision",
  },

  // ============================================================================
  // Meta Llama - Open models via providers
  // ============================================================================
  {
    id: "groq/llama-3.3-70b-versatile",
    name: "Llama 3.3 70B (Groq)",
    provider: "meta",
    description: "Fast inference via Groq",
  },
  {
    id: "together/meta-llama/Llama-3.3-70B-Instruct-Turbo",
    name: "Llama 3.3 70B (Together)",
    provider: "meta",
    description: "70B model via Together AI",
  },
  {
    id: "fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct",
    name: "Llama 3.3 70B (Fireworks)",
    provider: "meta",
    description: "70B model via Fireworks",
  },

  // ============================================================================
  // Cohere - Enterprise-focused with tool calling
  // ============================================================================
  {
    id: "cohere/command-r-plus",
    name: "Command R+",
    provider: "cohere",
    description: "Enterprise RAG and tool use",
  },
  {
    id: "cohere/command-r",
    name: "Command R",
    provider: "cohere",
    description: "Efficient enterprise model",
  },

  // ============================================================================
  // Reasoning Models (Extended Thinking)
  // ============================================================================
  {
    id: "anthropic/claude-3-7-sonnet-20250219",
    name: "Claude 3.7 Sonnet (Thinking)",
    provider: "reasoning",
    description: "Extended thinking for complex problems",
  },
  {
    id: "openai/o1",
    name: "OpenAI o1",
    provider: "reasoning",
    description: "Advanced reasoning model",
  },
  {
    id: "openai/o1-mini",
    name: "OpenAI o1 Mini",
    provider: "reasoning",
    description: "Efficient reasoning model",
  },
  {
    id: "openai/o1-pro",
    name: "OpenAI o1 Pro",
    provider: "reasoning",
    description: "Enhanced reasoning capabilities",
  },
  {
    id: "openai/o3-mini",
    name: "OpenAI o3 Mini",
    provider: "reasoning",
    description: "Next-gen reasoning, fast",
  },
  {
    id: "google/gemini-2.0-flash-thinking-exp",
    name: "Gemini 2.0 Flash Thinking",
    provider: "reasoning",
    description: "Experimental reasoning Gemini",
  },
  {
    id: "google/gemini-2.5-flash-preview-04-17-thinking",
    name: "Gemini 2.5 Flash Thinking",
    provider: "reasoning",
    description: "Gemini with extended thinking",
  },
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek R1",
    provider: "reasoning",
    description: "Open-source reasoning model",
  },
  {
    id: "xai/grok-3-mini-beta-thinking",
    name: "Grok 3 Mini Thinking",
    provider: "reasoning",
    description: "Grok with extended reasoning",
  },
];

// Group models by provider for UI
export const modelsByProvider = chatModels.reduce(
  (acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  },
  {} as Record<string, ChatModel[]>
);
