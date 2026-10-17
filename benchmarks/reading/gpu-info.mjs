// Browser-target queries only, outside every source-load and reading interval.
// The flag requests a policy; only this raw response establishes actual status.
export async function captureGPU(browser, label) {
  const startedAt = new Date().toISOString(); let session, timeout;
  try {
    session = await browser.newBrowserCDPSession();
    const info = await Promise.race([
      session.send('SystemInfo.getInfo'),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('SystemInfo.getInfo exceeded 5000 ms')), 5000); }),
    ]);
    const observed = !!info?.gpu && Array.isArray(info.gpu.devices) && !!info.gpu.featureStatus;
    return { label, startedAt, finishedAt: new Date().toISOString(), observed,
      error: observed ? undefined : 'SystemInfo reply lacks GPU devices/featureStatus.', info };
  } catch (error) {
    return { label, startedAt, finishedAt: new Date().toISOString(), observed: false, error: error.stack ?? String(error) };
  } finally { clearTimeout(timeout); await session?.detach().catch(() => {}); }
}
