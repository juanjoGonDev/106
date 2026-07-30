(() => {
  const appBaseUrl = globalThis.Minuto106PlayerUI?.appBaseUrl?.();
  const favicon = globalThis.document?.querySelector?.('link[rel~="icon"]');
  if (!appBaseUrl || !favicon) return;
  favicon.href = new URL('assets/favicon.svg', appBaseUrl).toString();
})();
