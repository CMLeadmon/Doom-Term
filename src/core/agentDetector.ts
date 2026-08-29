import { SessionNode } from '../types/sessionTree';
import { TokenMeter } from './tokenMeter';
import { AppTelemetry } from '../hud/state';

export interface DetectedAgentInfo {
  isAgent: boolean;
  agent: string;
  agentName: string;
  model: string;
  modelKey: string;
}

/**
 * Detects whether a session node is running an AI Agent CLI or a plain shell,
 * analyzing node kind, titles, command history, and active block commands.
 */
export function detectAgentFromSession(node?: SessionNode): DetectedAgentInfo {
  if (!node) {
    return {
      isAgent: false,
      agent: 'doom',
      agentName: 'BASH · SHELL',
      model: '',
      modelKey: 'claude-3-7-sonnet',
    };
  }

  const titleLower = (node.title || '').toLowerCase();

  // Inspect recent commands in history and blocks
  const commandsToCheck: string[] = [];
  if (node.commandHistory) {
    commandsToCheck.push(...node.commandHistory.slice(-5).map((c) => c.trim().toLowerCase()));
  }
  if (node.blocks) {
    commandsToCheck.push(...node.blocks.slice(-5).map((b) => b.command.trim().toLowerCase()));
  }

  const hasCmd = (pattern: RegExp) => {
    return commandsToCheck.some((cmd) => pattern.test(cmd));
  };

  // 1. Gemini CLI / Google GenAI
  if (hasCmd(/\b(gemini|gemini-cli|google-genai)\b/) || titleLower.includes('gemini')) {
    return {
      isAgent: true,
      agent: 'gemini',
      agentName: 'GEMINI CLI',
      model: '2.5 PRO',
      modelKey: 'gemini-2.0-flash',
    };
  }

  // 2. OpenAI Codex / ChatGPT CLI
  if (hasCmd(/\b(codex|chatgpt|openai)\b/) || titleLower.includes('codex')) {
    return {
      isAgent: true,
      agent: 'codex',
      agentName: 'CODEX',
      model: 'O3-MINI',
      modelKey: 'gpt-4o',
    };
  }

  // 3. OpenCode / DeepSeek / Ollama
  if (hasCmd(/\b(opencode|deepseek|ollama)\b/) || titleLower.includes('opencode')) {
    return {
      isAgent: true,
      agent: 'opencode',
      agentName: 'OPENCODE',
      model: 'DEEPSEEK-R1',
      modelKey: 'local-ollama',
    };
  }

  // 4. Grok CLI / xAI
  if (hasCmd(/\b(grok|xai)\b/) || titleLower.includes('grok')) {
    return {
      isAgent: true,
      agent: 'grok',
      agentName: 'GROK CLI',
      model: 'GROK-3',
      modelKey: 'gpt-4o',
    };
  }

  // 5. GitHub Copilot CLI
  if (hasCmd(/\b(copilot|gh copilot)\b/) || titleLower.includes('copilot')) {
    return {
      isAgent: true,
      agent: 'copilot',
      agentName: 'GITHUB COPILOT',
      model: 'CLAUDE-3.7',
      modelKey: 'claude-3-7-sonnet',
    };
  }

  // 6. Aider
  if (hasCmd(/\baider\b/) || titleLower.includes('aider')) {
    return {
      isAgent: true,
      agent: 'claude',
      agentName: 'AIDER',
      model: 'SONNET-3.7',
      modelKey: 'claude-3-7-sonnet',
    };
  }

  // 7. Claude Code / Anthropic / Antigravity / Generic Agent Node
  if (
    node.kind === 'agent' ||
    hasCmd(/\b(claude|claude-code|anthropic|agy|antigravity)\b/) ||
    titleLower.includes('claude') ||
    titleLower.includes('agent') ||
    (node.agentState && node.agentState !== 'idle')
  ) {
    return {
      isAgent: true,
      agent: 'claude',
      agentName: 'CLAUDE CODE',
      model: 'OPUS-4-6',
      modelKey: 'claude-3-7-sonnet',
    };
  }

  // 8. Plain interactive shell
  return {
    isAgent: false,
    agent: 'doom',
    agentName: 'BASH · SHELL',
    model: '',
    modelKey: 'claude-3-7-sonnet',
  };
}

/**
 * Calculates live telemetry (context usage, rate usage, tokens, shell metrics)
 * for the status bar based on session state and agent detection.
 */
export function calculateSessionTelemetry(
  node: SessionNode | undefined,
  pendingApproval: boolean,
  extraOutputChars: number = 0
): AppTelemetry {
  if (!node) {
    return {
      contextUsed: 0.0,
      rateUsed: 0.0,
      isolation: 'host',
      agent: 'doom',
      agentName: 'BASH · SHELL',
      model: '',
      cwd: '~',
      branch: 'main',
      credentials: [true, true, false],
      pendingApproval: false,
    };
  }

  const agentInfo = detectAgentFromSession(node);
  const now = Date.now();
  const recentCommands = (node.blocks || []).filter((b) => now - b.startedAt < 15 * 60 * 1000).length;

  let totalInputChars = 0;
  let totalOutputChars = extraOutputChars;
  let totalLines = 0;
  let errorCount = 0;

  for (const b of node.blocks || []) {
    totalInputChars += b.command.length;
    const lines = b.snapshot ? b.snapshot.lines : b.liveLines;
    totalLines += lines.length;
    if (b.exitCode !== null && b.exitCode !== 0) {
      errorCount++;
    }
    for (const line of lines) {
      for (const span of line.spans) {
        totalOutputChars += span.text.length;
      }
    }
  }

  // Count TUI lines if present
  if (node.tuiLines && node.tuiLines.length > 0) {
    totalLines += node.tuiLines.length;
    for (const line of node.tuiLines) {
      for (const span of line.spans) {
        totalOutputChars += span.text.length;
      }
    }
  }

  if (agentInfo.isAgent) {
    // LLM Agent Mode
    // Baseline system prompt + MCP tool schemas context overhead
    const baseSystemChars = 14000;
    const effectiveInput = totalInputChars + baseSystemChars;
    const effectiveOutput = totalOutputChars;

    const metrics = TokenMeter.calculateTokens(effectiveInput, effectiveOutput, agentInfo.modelKey);
    const isRunning = node.agentState === 'running' || (node.blocks && node.blocks.some((b) => b.status === 'running'));

    // Dynamic rate usage: active burn while generating, decaying when idle
    const ratePct = isRunning
      ? Math.min(0.85, 0.45 + (recentCommands / 20) * 0.4)
      : Math.min(0.75, Math.max(0.05, (recentCommands / 25) * 0.5));

    return {
      contextUsed: metrics.contextPct,
      rateUsed: ratePct,
      isolation: 'sandbox',
      agent: agentInfo.agent,
      agentName: agentInfo.agentName,
      model: agentInfo.model,
      cwd: node.cwd,
      branch: node.gitBranch,
      credentials: [true, true, false],
      tokens: {
        in: metrics.tokensIn,
        out: metrics.tokensOut,
        cache: metrics.tokensCache,
        limit: metrics.limits,
      },
      pendingApproval,
    };
  }

  // Plain Shell Mode
  const scrollbackCap = 10000;
  const contextPct = Math.min(0.99, totalLines / scrollbackCap);
  const ratePct = Math.min(0.99, recentCommands / 25);

  return {
    contextUsed: contextPct,
    rateUsed: ratePct,
    isolation: 'host',
    agent: 'doom',
    agentName: 'BASH · SHELL',
    model: '',
    cwd: node.cwd,
    branch: node.gitBranch,
    credentials: [true, true, false],
    tokens: undefined,
    shellMetrics: {
      lines: totalLines,
      commands: node.blocks ? node.blocks.length : 0,
      errors: errorCount,
      active: 1,
    },
    pendingApproval,
  };
}
