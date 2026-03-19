export async function waitForContentStable(page: any, options?: { timeoutMs?: number; quietMs?: number }): Promise<void> {
  const timeout = options?.timeoutMs ?? 5000;
  const quiet = options?.quietMs ?? 500;
  const start = Date.now();
  await page.evaluate(({ quietMs, timeoutMs }: { quietMs: number; timeoutMs: number }) => {
    return new Promise<void>((resolve) => {
      let lastMutation = Date.now();
      let settled = false;
      const observer = new MutationObserver(() => { lastMutation = Date.now(); });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      const check = () => {
        const now = Date.now();
        if (now - lastMutation >= quietMs || settled) { observer.disconnect(); resolve(); return; }
        if (now - lastMutation > timeoutMs) { observer.disconnect(); resolve(); return; }
        requestAnimationFrame(check);
      };
      setTimeout(() => { settled = true; observer.disconnect(); resolve(); }, timeoutMs);
      setTimeout(check, quietMs);
    });
  }, { quietMs: quiet, timeoutMs: Math.max(0, timeout - (Date.now() - start)) });
}
