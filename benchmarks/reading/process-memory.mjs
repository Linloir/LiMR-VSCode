import { readFile } from 'node:fs/promises';

/** Linux-only process-tree RSS. Shared pages are counted per process: this is
 * reproducible process accounting, not unique physical memory or JS heap. */
export function sampleProcessMemory(pid) {
  const samples = [];
  let stopped = false, busy = false;
  const sample = async () => {
    if (stopped || busy || process.platform !== 'linux') return;
    busy = true;
    const seen = new Set(), processes = [];
    const visit = async id => {
      if (seen.has(id)) return; seen.add(id);
      try {
        const [status, children, command] = await Promise.all([
          readFile(`/proc/${id}/status`, 'utf8'), readFile(`/proc/${id}/task/${id}/children`, 'utf8'), readFile(`/proc/${id}/cmdline`, 'utf8'),
        ]);
        const rssKiB = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
        processes.push({ pid: id, rssKiB, role: command.match(/--type=([^\0 ]+)/)?.[1] ?? 'main' });
        await Promise.all(children.trim().split(/\s+/).filter(Boolean).map(child => visit(Number(child))));
      } catch { /* Processes can exit while sampled. */ }
    };
    await visit(pid);
    samples.push({ epoch: Date.now(), rssKiB: processes.reduce((sum, item) => sum + item.rssKiB, 0), processes });
    busy = false;
  };
  const timer = setInterval(() => void sample(), 1000);
  void sample();
  return () => { stopped = true; clearInterval(timer); return { intervalMs: 1000, accounting: 'Linux process-tree summed RSS; shared pages counted per process',
    peakKiB: Math.max(0, ...samples.map(sample => sample.rssKiB)), samples }; };
}
