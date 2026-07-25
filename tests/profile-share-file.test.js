import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync('public/profile-share.js', 'utf8');

function loadProfileShare(overrides = {}) {
  const context = {
    Blob,
    Date,
    Error,
    File,
    Map,
    Object,
    Promise,
    String,
    URL,
    globalThis: null,
    location: { href: 'https://example.test/106/player/Juan' },
    ...overrides,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'public/profile-share.js' });
  return { api: context.Minuto106ProfileShare, context };
}

function pngResponse({ ok = true, type = 'image/png; charset=binary', bytes = [1, 2, 3] } = {}) {
  return {
    ok,
    headers: { get: () => type },
    blob: async () => new Blob([Uint8Array.from(bytes)], { type: 'image/png' }),
  };
}

function fakeButton() {
  return { dataset: {}, disabled: false, textContent: 'Compartir perfil' };
}

describe('profile image file sharing', () => {
  it('builds safe deterministic PNG filenames', () => {
    const { api } = loadProfileShare();
    expect(api.fileName('  Júán Pérez  ', 'TROPHIES')).toBe('minuto-106-juan-perez-trophies.png');
    expect(api.fileName('', '')).toBe('minuto-106-jugador-overview.png');
  });

  it('downloads the generated PNG as a shareable File', async () => {
    const { api } = loadProfileShare();
    const fetchImpl = vi.fn(async () => pngResponse());
    const file = await api.prepareFile({
      url: 'https://api.example/player-share/Juan/card.png?v=7',
      nick: 'Juan',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example/player-share/Juan/card.png?v=7',
      { headers: { accept: 'image/png' } },
    );
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('minuto-106-juan-overview.png');
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(3);
  });

  it.each([
    [{}, 'No se ha podido preparar'],
    [{ url: 'https://api.example/card.png', fetchImpl: null }, 'El navegador no permite preparar'],
    [{ url: 'https://api.example/card.png', fetchImpl: async () => pngResponse({ ok: false }) }, 'No se ha podido generar'],
    [{ url: 'https://api.example/card.png', fetchImpl: async () => pngResponse({ type: 'image/jpeg' }) }, 'No se ha podido generar'],
    [{ url: 'https://api.example/card.png', fetchImpl: async () => pngResponse({ bytes: [] }) }, 'está vacía'],
  ])('rejects invalid image preparation %#', async (options, message) => {
    const { api } = loadProfileShare();
    await expect(api.prepareFile(options)).rejects.toThrow(message);
  });

  it('shares the current PNG with text containing the public URL', async () => {
    const { api } = loadProfileShare();
    const file = new File([new Uint8Array([1])], 'profile.png', { type: 'image/png' });
    const nativeShare = vi.fn(async () => {});
    const navigatorLike = {
      canShare: vi.fn(() => true),
      share: nativeShare,
    };

    await expect(api.share({
      title: 'Juan · Minuto 106',
      text: 'Juan suma 2 trofeos.',
      url: 'https://example.test/106/player/Juan',
      file,
      navigatorLike,
    })).resolves.toBe(true);

    expect(navigatorLike.canShare).toHaveBeenCalledWith({ files: [file] });
    expect(nativeShare).toHaveBeenCalledWith({
      title: 'Juan · Minuto 106',
      text: 'Juan suma 2 trofeos.\nhttps://example.test/106/player/Juan',
      files: [file],
    });
  });

  it('treats cancellation as a completed non-share without opening a fallback', async () => {
    const { api } = loadProfileShare();
    const file = new File([new Uint8Array([1])], 'profile.png', { type: 'image/png' });
    const fallback = vi.fn();
    const navigatorLike = {
      canShare: () => true,
      share: async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); },
    };

    await expect(api.share({ file, navigatorLike, fallback })).resolves.toBe(false);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back to the existing text and URL share flow when files are unsupported or fail', async () => {
    const { api } = loadProfileShare();
    const file = new File([new Uint8Array([1])], 'profile.png', { type: 'image/png' });
    const fallback = vi.fn(async () => true);

    await expect(api.share({
      title: 'Juan',
      text: 'Palmarés',
      url: 'https://example.test/106/player/Juan',
      file,
      navigatorLike: { canShare: () => false, share: vi.fn() },
      fallback,
    })).resolves.toBe(true);
    expect(fallback).toHaveBeenLastCalledWith({ title: 'Juan', text: 'Palmarés', url: 'https://example.test/106/player/Juan' });

    await expect(api.share({
      file,
      navigatorLike: { canShare: () => true, share: async () => { throw new Error('native failure'); } },
      fallback,
    })).resolves.toBe(true);
    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it('prepares once, updates the button state and bridges the existing UI share call', async () => {
    let release;
    const responseReady = new Promise((resolve) => { release = resolve; });
    const fetchImpl = vi.fn(async () => {
      await responseReady;
      return pngResponse();
    });
    const nativeShare = vi.fn(async () => {});
    const fallback = vi.fn(async () => true);
    const ui = { share: fallback };
    const navigator = { canShare: () => true, share: nativeShare };
    const { api, context } = loadProfileShare({ Minuto106UI: ui, navigator });
    const button = fakeButton();
    const shareUrl = 'https://example.test/106/player/Juan/trophies';

    const preparation = api.bindButton({
      button,
      url: shareUrl,
      cardUrl: 'https://api.example/player-share/Juan/trophies.png?v=19',
      nick: 'Juan',
      section: 'trophies',
      readyLabel: 'Compartir perfil',
      fetchImpl,
    });

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Preparando...');
    release();
    const file = await preparation;
    expect(file.name).toBe('minuto-106-juan-trophies.png');
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Compartir perfil');

    await context.Minuto106UI.share({
      title: 'Juan · Minuto 106',
      text: 'Palmarés actualizado.',
      url: shareUrl,
    });

    expect(nativeShare).toHaveBeenCalledWith({
      title: 'Juan · Minuto 106',
      text: `Palmarés actualizado.\n${shareUrl}`,
      files: [file],
    });
    expect(fallback).not.toHaveBeenCalled();

    await api.bindButton({
      button,
      url: shareUrl,
      cardUrl: 'https://api.example/player-share/Juan/trophies.png?v=19',
      nick: 'Juan',
      section: 'trophies',
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('releases the button and retains text sharing when image preparation fails', async () => {
    const fallback = vi.fn(async () => true);
    const ui = { share: fallback };
    const navigator = { canShare: () => true, share: vi.fn() };
    const { api, context } = loadProfileShare({ Minuto106UI: ui, navigator });
    const button = fakeButton();
    const shareUrl = 'https://example.test/106/player/Juan';

    await expect(api.bindButton({
      button,
      url: shareUrl,
      cardUrl: 'https://api.example/player-share/Juan/card.png?v=20',
      nick: 'Juan',
      fetchImpl: async () => pngResponse({ ok: false }),
    })).resolves.toBeNull();

    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Compartir perfil');
    await context.Minuto106UI.share({ title: 'Juan', text: 'Perfil', url: shareUrl });
    expect(fallback).toHaveBeenCalledWith({ title: 'Juan', text: 'Perfil', url: shareUrl });
    expect(navigator.share).not.toHaveBeenCalled();
  });

  it('rejects unsafe canShare implementations and returns false without any available fallback', async () => {
    const { api } = loadProfileShare();
    const file = new File([new Uint8Array([1])], 'profile.png', { type: 'image/png' });
    expect(api.canShareFile(file, { canShare: () => { throw new Error('unsupported'); }, share() {} })).toBe(false);
    expect(api.canShareFile(null, {})).toBe(false);
    await expect(api.share({ file, navigatorLike: {} })).resolves.toBe(false);
  });
});
