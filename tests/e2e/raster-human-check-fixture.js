const TEST_RASTER_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const TEST_RASTER_DIGEST = 'f'.repeat(64);

export function rasterChallengeResponse({ checkId, expiresAt }) {
  return {
    checkId,
    expiresAt,
    challengeFormat: 'raster-png-v1',
    image: {
      mediaType: 'image/png',
      dataUrl: TEST_RASTER_DATA_URL,
      width: 640,
      height: 360,
      digest: TEST_RASTER_DIGEST,
    },
  };
}
