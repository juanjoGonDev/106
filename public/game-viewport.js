const STABILIZATION_FRAMES = 2;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calculateCenteredScrollTop({
  elementTop,
  elementHeight,
  scrollY,
  viewportOffsetTop,
  viewportHeight,
  maxScrollY,
}) {
  const values = [
    elementTop,
    elementHeight,
    scrollY,
    viewportOffsetTop,
    viewportHeight,
    maxScrollY,
  ];
  if (values.some((value) => !Number.isFinite(Number(value)))) {
    throw new TypeError('Viewport measurements must be finite numbers.');
  }

  const safeViewportHeight = Math.max(1, Number(viewportHeight));
  const safeElementHeight = Math.max(0, Number(elementHeight));
  const elementCenterInDocument = Number(scrollY) + Number(elementTop) + safeElementHeight / 2;
  const requestedScrollTop = elementCenterInDocument
    - Math.max(0, Number(viewportOffsetTop))
    - safeViewportHeight / 2;

  return clamp(requestedScrollTop, 0, Math.max(0, Number(maxScrollY)));
}

function readScrollY(windowRef) {
  return Number(windowRef.scrollY ?? windowRef.pageYOffset ?? 0);
}

function centerTimerStage(documentRef, windowRef, timerStage) {
  const bounds = timerStage.getBoundingClientRect();
  const viewport = windowRef.visualViewport;
  const viewportHeight = Number(viewport?.height || documentRef.documentElement.clientHeight || windowRef.innerHeight || 1);
  const viewportOffsetTop = Number(viewport?.offsetTop || 0);
  const maxScrollY = Math.max(
    0,
    Number(documentRef.documentElement.scrollHeight || 0)
      - Number(documentRef.documentElement.clientHeight || windowRef.innerHeight || viewportHeight),
  );
  const top = calculateCenteredScrollTop({
    elementTop: bounds.top,
    elementHeight: bounds.height,
    scrollY: readScrollY(windowRef),
    viewportOffsetTop,
    viewportHeight,
    maxScrollY,
  });

  windowRef.scrollTo({ top: Math.round(top), left: 0, behavior: 'auto' });
}

export function installGameplayViewportController(
  documentRef = globalThis.document,
  windowRef = globalThis.window,
) {
  if (!documentRef || !windowRef) return () => {};

  const playingPanel = documentRef.querySelector('#playing');
  const timerStage = documentRef.querySelector('#playing .timer-stage');
  if (!playingPanel || !timerStage || !windowRef.MutationObserver) return () => {};

  let centeringSequence = 0;

  const centerNow = () => {
    if (!playingPanel.classList.contains('active')) return;
    centerTimerStage(documentRef, windowRef, timerStage);
  };

  const stabilizeGameplay = () => {
    centeringSequence += 1;
    const sequence = centeringSequence;
    centerNow();
    playingPanel.focus({ preventScroll: true });

    let framesLeft = STABILIZATION_FRAMES;
    const afterFrame = () => {
      if (sequence !== centeringSequence || !playingPanel.classList.contains('active')) return;
      centerNow();
      framesLeft -= 1;
      if (framesLeft > 0) windowRef.requestAnimationFrame(afterFrame);
    };
    windowRef.requestAnimationFrame(afterFrame);
  };

  const observer = new windowRef.MutationObserver(() => {
    if (playingPanel.classList.contains('active')) stabilizeGameplay();
    else centeringSequence += 1;
  });
  observer.observe(playingPanel, {
    attributes: true,
    attributeFilter: ['class'],
  });

  const onOrientationChange = () => {
    if (playingPanel.classList.contains('active')) stabilizeGameplay();
  };
  windowRef.addEventListener('orientationchange', onOrientationChange);

  return () => {
    centeringSequence += 1;
    observer.disconnect();
    windowRef.removeEventListener('orientationchange', onOrientationChange);
  };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  installGameplayViewportController(document, window);
}
