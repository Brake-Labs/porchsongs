import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for `applyUpdate`, the Reload button's handler.
 *
 * The bug these exist for: vite-plugin-pwa's `prompt` mode ignores the `reloadPage`
 * argument to `updateSW()` and only sends SKIP_WAITING. Its reload comes from a
 * `controlling` listener attached inside the `waiting` event handler, so a banner
 * raised by the build-id check instead of by `onNeedRefresh` had no waiting worker
 * to message and no listener to reload. Clicking Reload did nothing at all.
 */

const updateSW = vi.fn().mockResolvedValue(undefined);
let registeredOptions: { onRegisteredSW?: (u: string, r: unknown) => void } = {};

vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: typeof registeredOptions) => {
    registeredOptions = options;
    return updateSW;
  },
}));

type FakeWorker = { state: string; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };

function makeRegistration(opts: {
  waiting?: FakeWorker | null;
  installing?: FakeWorker | null;
  update?: () => Promise<void>;
}) {
  return {
    waiting: opts.waiting ?? null,
    installing: opts.installing ?? null,
    update: vi.fn(opts.update ?? (() => Promise.resolve())),
  };
}

function makeWorker(state = 'installed'): FakeWorker {
  return { state, addEventListener: vi.fn(), removeEventListener: vi.fn() };
}

const reload = vi.fn();
let swListeners: Record<string, (() => void)[]>;

beforeEach(() => {
  vi.resetModules();
  reload.mockClear();
  updateSW.mockClear();
  registeredOptions = {};
  swListeners = {};
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      addEventListener: (type: string, fn: () => void) => {
        (swListeners[type] ??= []).push(fn);
      },
      removeEventListener: vi.fn(),
      getRegistrations: vi.fn().mockResolvedValue([]),
      register: vi.fn(),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Register, then hand the module the registration the browser would have given it. */
async function setup(registration: unknown) {
  const mod = await import('./registerSW');
  mod.registerServiceWorker();
  // Let the dynamic import of the virtual module resolve.
  await vi.waitFor(() => expect(registeredOptions.onRegisteredSW).toBeTypeOf('function'));
  registeredOptions.onRegisteredSW?.('/sw.js', registration);
  return mod;
}

describe('applyUpdate', () => {
  it('reloads when there is no service worker at all', async () => {
    // Firefox private windows and any browser with service workers disabled.
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    const mod = await import('./registerSW');
    mod.registerServiceWorker();
    await mod.applyUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('asks for an update before deciding there is nothing to activate', async () => {
    // The banner is raised by the build-id check, which does not await its own
    // update check, so the worker may not have looked yet when Reload is clicked.
    const reg = makeRegistration({});
    const mod = await setup(reg);

    await mod.applyUpdate();

    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it('reloads rather than leaving the click unanswered when no worker is waiting', async () => {
    // This is the reported bug: previously this path called updateSW(true), which
    // sends SKIP_WAITING to nothing and never reloads.
    const reg = makeRegistration({});
    const mod = await setup(reg);

    await mod.applyUpdate();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(updateSW).not.toHaveBeenCalled();
  });

  it('still reloads when the update check itself throws', async () => {
    const reg = makeRegistration({ update: () => Promise.reject(new Error('offline')) });
    const mod = await setup(reg);

    await mod.applyUpdate();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('activates a waiting worker and reloads when it takes control', async () => {
    const reg = makeRegistration({ waiting: makeWorker() });
    const mod = await setup(reg);

    await mod.applyUpdate();

    expect(updateSW).toHaveBeenCalledTimes(1);
    // No reload yet: it waits for the new worker to take over.
    expect(reload).not.toHaveBeenCalled();

    swListeners.controllerchange?.forEach(fn => fn());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads on a timeout if control never changes', async () => {
    vi.useFakeTimers();
    const reg = makeRegistration({ waiting: makeWorker() });
    const mod = await setup(reg);

    await mod.applyUpdate();
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads only once when control changes and the timeout both fire', async () => {
    vi.useFakeTimers();
    const reg = makeRegistration({ waiting: makeWorker() });
    const mod = await setup(reg);

    await mod.applyUpdate();
    swListeners.controllerchange?.forEach(fn => fn());
    await vi.advanceTimersByTimeAsync(3_000);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits out an in-flight install before giving up on a waiting worker', async () => {
    // registration.update() resolving does not mean a worker is ready: one that was
    // found still has to finish installing before it lands in `waiting`.
    const installing = makeWorker('installing');
    const reg = makeRegistration({ installing });
    const mod = await setup(reg);

    const applied = mod.applyUpdate();
    await vi.waitFor(() => expect(installing.addEventListener).toHaveBeenCalled());

    // The worker finishes installing and becomes the waiting one.
    installing.state = 'installed';
    reg.waiting = makeWorker();
    const handler = installing.addEventListener.mock.calls[0]?.[1] as () => void;
    handler();
    await applied;

    expect(updateSW).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
