export interface GitWorktreeInfo {
  path: string;
  branch: string;
  isLocked: boolean;
}

export class WorktreeManager {
  private static sanitizeBranch(branch: string): string {
    return branch.replace(/[^a-zA-Z0-9._-]/g, '-');
  }

  public static getWorktreePath(rootPath: string, branch: string): string {
    const safeBranch = this.sanitizeBranch(branch);
    return `${rootPath}/.worktrees/${safeBranch}`;
  }

  public static generateWorktreeCommand(branch: string, baseRef: string = 'HEAD'): string {
    const safeBranch = this.sanitizeBranch(branch);
    return `git worktree add -b ${safeBranch} .worktrees/${safeBranch} ${baseRef}`;
  }

  public static generateRemoveCommand(branch: string): string {
    const safeBranch = this.sanitizeBranch(branch);
    return `git worktree remove --force .worktrees/${safeBranch}`;
  }
}
