export interface ModelTokenConfig {
  provider: string;
  model: string;
  contextLimit: number;
  inputLimit: number;
  outputLimit: number;
  charsPerToken: number;
}

export const PROVIDER_MODELS: Record<string, ModelTokenConfig> = {
  'claude-3-7-sonnet': {
    provider: 'anthropic',
    model: 'Claude 3.7 Sonnet',
    contextLimit: 200000,
    inputLimit: 200000,
    outputLimit: 64000,
    charsPerToken: 3.6,
  },
  'claude-3-5-sonnet': {
    provider: 'anthropic',
    model: 'Claude 3.5 Sonnet',
    contextLimit: 200000,
    inputLimit: 200000,
    outputLimit: 8192,
    charsPerToken: 3.6,
  },
  'claude-3-opus': {
    provider: 'anthropic',
    model: 'Claude 3 Opus',
    contextLimit: 200000,
    inputLimit: 200000,
    outputLimit: 4096,
    charsPerToken: 3.5,
  },
  'gpt-4o': {
    provider: 'openai',
    model: 'GPT-4o',
    contextLimit: 128000,
    inputLimit: 128000,
    outputLimit: 16384,
    charsPerToken: 3.8,
  },
  'gemini-2.0-flash': {
    provider: 'google',
    model: 'Gemini 2.0 Flash',
    contextLimit: 1048576,
    inputLimit: 1048576,
    outputLimit: 8192,
    charsPerToken: 4.0,
  },
  'local-ollama': {
    provider: 'ollama',
    model: 'Llama 3.3 70B',
    contextLimit: 32768,
    inputLimit: 32768,
    outputLimit: 4096,
    charsPerToken: 3.7,
  },
};

export interface TokenMetrics {
  tokensIn: number;
  tokensOut: number;
  tokensCache: number;
  totalTokens: number;
  contextPct: number;
  limits: [number, number, number, number]; // in, out, cache, max
}

export class TokenMeter {
  public static calculateTokens(
    totalInputChars: number,
    totalOutputChars: number,
    modelKey: string = 'claude-3-7-sonnet'
  ): TokenMetrics {
    const config = PROVIDER_MODELS[modelKey] || PROVIDER_MODELS['claude-3-7-sonnet'];
    const tokensIn = Math.max(800, Math.round(totalInputChars / config.charsPerToken) + 800);
    const tokensOut = Math.round(totalOutputChars / config.charsPerToken);
    const tokensCache = Math.round(tokensIn * 0.65);
    const totalTokens = tokensIn + tokensOut + tokensCache;
    const contextPct = Math.min(0.99, totalTokens / config.contextLimit);

    return {
      tokensIn,
      tokensOut,
      tokensCache,
      totalTokens,
      contextPct,
      limits: [config.inputLimit, config.outputLimit, Math.round(config.contextLimit * 0.5), config.contextLimit],
    };
  }
}
