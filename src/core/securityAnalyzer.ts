/**
 * Security Command Risk Analyzer for Doom Term.
 * Intercepts potentially destructive operations and surfaces the Approval notice.
 */

export interface RiskAnalysis {
  isHighRisk: boolean;
  consequence?: string;
  category?: 'destructive' | 'system' | 'network' | 'privilege';
}

const HIGH_RISK_PATTERNS: { pattern: RegExp; consequence: string; category: RiskAnalysis['category'] }[] = [
  {
    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+/i,
    consequence: 'Recursive forced file deletion without prompt',
    category: 'destructive',
  },
  {
    pattern: /\brm\s+-rf\s+[/~]/i,
    consequence: 'Root / Home directory recursive wipe',
    category: 'destructive',
  },
  {
    pattern: /\bsudo\s+/i,
    consequence: 'Root / elevated host privilege execution',
    category: 'privilege',
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    consequence: 'Hard reset will discard all uncommitted changes in current working tree',
    category: 'destructive',
  },
  {
    pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/i,
    consequence: 'Force cleaning will permanently delete untracked workspace files',
    category: 'destructive',
  },
  {
    pattern: /\bgit\s+push\s+.*--force\b/i,
    consequence: 'Force push will overwrite remote branch history',
    category: 'destructive',
  },
  {
    pattern: /\bdd\s+if=/i,
    consequence: 'Low-level disk read/write block operation',
    category: 'destructive',
  },
  {
    pattern: /\bmkfs(\.[a-z0-9]+)?\s+/i,
    consequence: 'Filesystem formatting operation will wipe storage partition',
    category: 'destructive',
  },
  {
    pattern: /\b(dropdb|drop\s+database|drop\s+table)\b/i,
    consequence: 'Irreversible database drop statement',
    category: 'destructive',
  },
  {
    pattern: /\bchmod\s+(-R\s+)?(777|000)\b/i,
    consequence: 'Insecure or destructive filesystem permission modification',
    category: 'system',
  },
  {
    pattern: /\bkill\s+-9\s+(1|-1)\b/i,
    consequence: 'Terminating PID 1 / init will crash the active session environment',
    category: 'system',
  },
];

export function analyzeCommandRisk(command: string): RiskAnalysis {
  const trimmed = command.trim();
  if (!trimmed) {
    return { isHighRisk: false };
  }

  for (const entry of HIGH_RISK_PATTERNS) {
    if (entry.pattern.test(trimmed)) {
      return {
        isHighRisk: true,
        consequence: entry.consequence,
        category: entry.category,
      };
    }
  }

  return { isHighRisk: false };
}
