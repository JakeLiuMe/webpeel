/**
 * System resource monitor — cgroup-aware for K8s containers.
 *
 * In K8s, os.freemem() gives WRONG numbers because it reads host memory,
 * not the container's cgroup limit. We read /sys/fs/cgroup directly.
 *
 * Three-tier memory management (from Crawl4AI):
 * - Normal: < threshold (85%) — accept all jobs
 * - Pressure: >= threshold (85%) — log warning, reject new render jobs
 * - Critical: >= critical (95%) — reject ALL new jobs
 *
 * Also tracks: CPU usage, connection count, uptime.
 */

import { readFileSync, existsSync } from 'fs';
import os from 'os';
import { createLogger } from './logger.js';

const log = createLogger('monitor');

export interface SystemHealth {
  memory: {
    usedBytes: number;
    totalBytes: number;
    usedPercent: number;
    tier: 'normal' | 'pressure' | 'critical';
  };
  uptime: number;
  isK8s: boolean;
  canAcceptJob: boolean;
  canAcceptRenderJob: boolean;
}

export interface SystemMonitorOptions {
  memoryThresholdPercent?: number;   // enter pressure mode (default: 85)
  criticalThresholdPercent?: number; // enter critical mode (default: 95)
  recoveryThresholdPercent?: number; // exit pressure mode (default: 80) — hysteresis
}

class SystemMonitor {
  private readonly IS_K8S: boolean;
  private readonly MEM_CURRENT = '/sys/fs/cgroup/memory.current';
  private readonly MEM_MAX = '/sys/fs/cgroup/memory.max';
  // cgroup v1 fallback paths
  private readonly MEM_CURRENT_V1 = '/sys/fs/cgroup/memory/memory.usage_in_bytes';
  private readonly MEM_MAX_V1 = '/sys/fs/cgroup/memory/memory.limit_in_bytes';

  private memoryThreshold: number;
  private criticalThreshold: number;
  private recoveryThreshold: number;
  private inPressureMode = false;
  private readonly startTime = Date.now();
  private consecutiveRejects = 0;
  private readonly MAX_CONSECUTIVE_REJECTS = 25; // Firecrawl-style stall detection

  constructor(options: SystemMonitorOptions = {}) {
    this.memoryThreshold = (options.memoryThresholdPercent ?? 85) / 100;
    this.criticalThreshold = (options.criticalThresholdPercent ?? 95) / 100;
    this.recoveryThreshold = (options.recoveryThresholdPercent ?? 80) / 100;

    // Detect K8s by checking for cgroup files
    this.IS_K8S = existsSync(this.MEM_CURRENT) || existsSync(this.MEM_CURRENT_V1);
    if (this.IS_K8S) {
      log.info('K8s cgroup memory monitoring active');
    } else {
      log.info('Using OS-level memory monitoring (non-K8s)');
    }
  }

  /** Read memory from cgroups (K8s) or OS */
  getMemoryUsage(): { usedBytes: number; totalBytes: number; usedPercent: number } {
    if (this.IS_K8S) {
      return this.readCgroupMemory();
    }
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return { usedBytes: used, totalBytes: total, usedPercent: used / total };
  }

  private readCgroupMemory(): { usedBytes: number; totalBytes: number; usedPercent: number } {
    try {
      // Try cgroup v2 first, then v1
      let currentPath = this.MEM_CURRENT;
      let maxPath = this.MEM_MAX;
      if (!existsSync(currentPath)) {
        currentPath = this.MEM_CURRENT_V1;
        maxPath = this.MEM_MAX_V1;
      }

      const current = parseInt(readFileSync(currentPath, 'utf8').trim(), 10);
      const maxStr = readFileSync(maxPath, 'utf8').trim();
      // 'max' in cgroup v2 means no limit set
      const max = maxStr === 'max' || parseInt(maxStr, 10) > os.totalmem() * 10
        ? os.totalmem()
        : parseInt(maxStr, 10);

      return { usedBytes: current, totalBytes: max, usedPercent: current / max };
    } catch (err) {
      // Fallback to OS-level if cgroup read fails
      log.warn('Failed to read cgroup memory, falling back to OS-level');
      const total = os.totalmem();
      const free = os.freemem();
      const used = total - free;
      return { usedBytes: used, totalBytes: total, usedPercent: used / total };
    }
  }

  /** Get full health snapshot */
  getHealth(): SystemHealth {
    const mem = this.getMemoryUsage();

    // Three-tier memory management with hysteresis
    let tier: 'normal' | 'pressure' | 'critical';
    if (mem.usedPercent >= this.criticalThreshold) {
      tier = 'critical';
      this.inPressureMode = true;
    } else if (mem.usedPercent >= this.memoryThreshold) {
      tier = 'pressure';
      this.inPressureMode = true;
    } else if (this.inPressureMode && mem.usedPercent > this.recoveryThreshold) {
      // Hysteresis: stay in pressure until we drop below recovery threshold
      tier = 'pressure';
    } else {
      tier = 'normal';
      this.inPressureMode = false;
    }

    const canAcceptJob = tier !== 'critical';
    const canAcceptRenderJob = tier === 'normal'; // render jobs use more memory

    // Track consecutive rejects for stall detection
    if (!canAcceptJob) {
      this.consecutiveRejects++;
      if (this.consecutiveRejects >= this.MAX_CONSECUTIVE_REJECTS) {
        log.error(`WORKER STALLED — ${this.consecutiveRejects} consecutive job rejections. Memory: ${(mem.usedPercent * 100).toFixed(1)}%`);
      }
    } else {
      this.consecutiveRejects = 0;
    }

    return {
      memory: { ...mem, tier },
      uptime: (Date.now() - this.startTime) / 1000,
      isK8s: this.IS_K8S,
      canAcceptJob,
      canAcceptRenderJob,
    };
  }

  /** Quick check: can we accept a new job? */
  canAccept(requireRender = false): boolean {
    const health = this.getHealth();
    return requireRender ? health.canAcceptRenderJob : health.canAcceptJob;
  }

  /** Check if the worker appears stalled */
  isStalled(): boolean {
    return this.consecutiveRejects >= this.MAX_CONSECUTIVE_REJECTS;
  }
}

/** Singleton system monitor */
export const systemMonitor = new SystemMonitor();
