import { ChainedTask, SessionNode } from '../types/sessionTree';

export interface TaskTriggerResult {
  readyTasks: ChainedTask[];
  failedTasks: ChainedTask[];
}

export class TaskPipeline {
  private tasks: ChainedTask[] = [];

  constructor(initialTasks: ChainedTask[] = []) {
    this.tasks = [...initialTasks];
  }

  public getTasks(): ChainedTask[] {
    return [...this.tasks];
  }

  public setTasks(tasks: ChainedTask[]) {
    this.tasks = [...tasks];
  }

  public addTask(nodeId: string, afterNodeIds: string[], command: string): ChainedTask {
    const task: ChainedTask = {
      nodeId,
      afterNodeIds: [...afterNodeIds],
      command,
      status: afterNodeIds.length === 0 ? 'ready' : 'pending',
    };
    this.tasks.push(task);
    return task;
  }

  public removeTask(nodeId: string) {
    this.tasks = this.tasks.filter((t) => t.nodeId !== nodeId);
  }

  /**
   * Evaluates all tasks against the current state of nodes.
   * If all upstream dependencies for a pending task are completed with exitCode === 0 or idle,
   * the task transitions to 'ready'.
   */
  public evaluate(nodes: Record<string, SessionNode>): TaskTriggerResult {
    const readyTasks: ChainedTask[] = [];
    const failedTasks: ChainedTask[] = [];

    this.tasks = this.tasks.map((task) => {
      if (task.status !== 'pending') return task;

      let allSuccess = true;
      let anyFailed = false;

      for (const upstreamId of task.afterNodeIds) {
        const upstream = nodes[upstreamId];
        if (!upstream) {
          anyFailed = true;
          break;
        }

        // Check if upstream has finished its last block with exitCode 0 or is idle
        const lastBlock = upstream.blocks[upstream.blocks.length - 1];
        if (!lastBlock) {
          allSuccess = false;
          break;
        }

        if (lastBlock.status === 'running') {
          allSuccess = false;
          break;
        }

        if (lastBlock.status === 'error' || (lastBlock.exitCode !== null && lastBlock.exitCode !== 0)) {
          anyFailed = true;
          break;
        }
      }

      if (anyFailed) {
        const updated: ChainedTask = { ...task, status: 'failed' };
        failedTasks.push(updated);
        return updated;
      }

      if (allSuccess && task.afterNodeIds.length > 0) {
        const updated: ChainedTask = { ...task, status: 'ready' };
        readyTasks.push(updated);
        return updated;
      }

      return task;
    });

    return { readyTasks, failedTasks };
  }

  public markRunning(nodeId: string) {
    this.tasks = this.tasks.map((t) => (t.nodeId === nodeId ? { ...t, status: 'running' } : t));
  }

  public markCompleted(nodeId: string) {
    this.tasks = this.tasks.map((t) => (t.nodeId === nodeId ? { ...t, status: 'completed' } : t));
  }
}
