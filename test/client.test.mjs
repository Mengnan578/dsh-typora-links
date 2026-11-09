import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const CLIENT_SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

/** Minimal document stub: capture listeners and fire synthetic gestures. */
function createDocument() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      listeners.set(type, list.filter((item) => item !== handler));
    },
    fire(type, event = {}) {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
  };
}

/** Evaluate client.js in a sandbox and materialize its factory exports. */
function loadClient() {
  let registration;
  const document = createDocument();
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value) {
          registration = value;
        },
      },
    },
    document,
    console: { warn() {} },
    performance: { now: () => Date.now() },
  };
  vm.createContext(sandbox);
  vm.runInContext(CLIENT_SOURCE, sandbox, { filename: 'client.js' });
  assert.ok(registration, 'client registers a module factory');
  const exports = registration.factory(() => {
    throw new Error('client must not require anything');
  });
  return { exports, document };
}

/** Fake DSH client context and Session Remote. */
function createHarness(overrides = {}) {
  const calls = { open: [], preview: [], stat: [], applications: [] };
  class Service {
    openResource(address, options) {
      calls.preview.push({ address, options });
    }
  }
  const service = new Service();
  const remote = {
    workspaceFiles: {
      async stat(sessionId, path) {
        calls.stat.push({ sessionId, path });
        if (overrides.stat !== undefined) return overrides.stat(sessionId, path);
        return { ok: true, value: { absolutePath: '/Users/wfq/Desktop/my-plugin/README.md' } };
      },
    },
    session: {
      async workspacePathApplications(request) {
        calls.applications.push(request);
        if (overrides.applications !== undefined) return overrides.applications(request);
        return {
          ok: true,
          value: [{ id: '/Applications/Typora.app', name: 'Typora', default: true }],
        };
      },
      async openWorkspacePath(request) {
        calls.open.push(request);
        if (overrides.open !== undefined) return overrides.open(request);
        return { ok: true };
      },
    },
  };
  const cleanups = [];
  const ctx = {
    sidebarRight: service,
    remote,
    effect(fn) {
      cleanups.push(fn());
    },
  };
  return { ctx, service, calls, cleanups };
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

function click(document, event = {}) {
  document.fire('pointerdown', { button: 0, ...event });
}

test('parses session and absolute file addresses', () => {
  const { exports } = loadClient();
  const { parseFileAddress } = exports.__test;

  const session = parseFileAddress('dsh-resource://file/session/s-1/docs/a%20b.md?line=3');
  assert.equal(session.scope, 'session');
  assert.equal(session.sessionId, 's-1');
  assert.equal(session.path, 'docs/a b.md');

  const absolute = parseFileAddress('dsh-resource://file/absolute/Users/wfq/note.md');
  assert.equal(absolute.scope, 'absolute');
  assert.equal(absolute.path, '/Users/wfq/note.md');

  assert.equal(parseFileAddress('https://example.com/a.md'), undefined);
  assert.equal(parseFileAddress('dsh-resource://file/session/s-1'), undefined);
  assert.equal(parseFileAddress(undefined), undefined);
});

test('plain click on a markdown link opens Typora without previewing', async () => {
  const { exports, document } = loadClient();
  const { ctx, calls } = createHarness();
  exports.apply(ctx, {});

  click(document);
  ctx.sidebarRight.openResource('dsh-resource://file/session/s-1/README.md');
  await tick();

  assert.equal(calls.stat.length, 1);
  assert.equal(calls.stat[0].sessionId, 's-1');
  assert.equal(calls.stat[0].path, 'README.md');
  assert.equal(calls.applications.length, 1);
  assert.equal(calls.applications[0].path, '/Users/wfq/Desktop/my-plugin/README.md');
  assert.equal(calls.open.length, 1);
  assert.equal(calls.open[0].path, '/Users/wfq/Desktop/my-plugin/README.md');
  assert.equal(calls.open[0].application, '/Applications/Typora.app');
  assert.equal(calls.preview.length, 0);
});

test('modified click keeps the in-app preview', async () => {
  const { exports, document } = loadClient();
  const { ctx, calls } = createHarness();
  exports.apply(ctx, {});

  click(document, { metaKey: true });
  ctx.sidebarRight.openResource('dsh-resource://file/session/s-1/README.md');
  await tick();

  assert.equal(calls.open.length, 0);
  assert.equal(calls.preview.length, 1);
});

test('programmatic opens without a gesture keep the preview', async () => {
  const { exports } = loadClient();
  const { ctx, calls } = createHarness();
  exports.apply(ctx, {});

  ctx.sidebarRight.openResource('dsh-resource://file/session/s-1/README.md');
  await tick();

  assert.equal(calls.open.length, 0);
  assert.equal(calls.preview.length, 1);
});

test('non-markdown and non-file links keep the preview', async () => {
  const { exports, document } = loadClient();
  const { ctx, calls } = createHarness();
  exports.apply(ctx, {});

  click(document);
  ctx.sidebarRight.openResource('dsh-resource://file/session/s-1/notes.txt');
  await tick();

  click(document);
  ctx.sidebarRight.openResource('https://example.com/README.md');
  await tick();

  assert.equal(calls.open.length, 0);
  assert.equal(calls.preview.length, 2);
});

test('a missing file falls back to the preview', async () => {
  const { exports, document } = loadClient();
  const { ctx, calls } = createHarness({
    stat: async () => ({ ok: false, error: { code: 'not-found' } }),
  });
  exports.apply(ctx, {});

  click(document);
  ctx.sidebarRight.openResource('dsh-resource://file/session/s-1/README.md');
  await tick();

  assert.equal(calls.open.length, 0);
  assert.equal(calls.preview.length, 1);
});

test('a rejected native open retries the default app and then previews', async () => {
  const { exports, document } = loadClient();
  const { ctx, calls } = createHarness({ open: async () => ({ ok: false }) });
  exports.apply(ctx, {});

  click(document);
  ctx.sidebarRight.openResource('dsh-resource://file/session/s-1/README.md');
  await tick();

  assert.equal(calls.open.length, 2);
  assert.equal(calls.open[1].path, '/Users/wfq/Desktop/my-plugin/README.md');
  assert.equal(calls.open[1].application, undefined);
  assert.equal(calls.preview.length, 1);
});

test('a file without a Typora association opens with the default app', async () => {
  const { exports, document } = loadClient();
  const { ctx, calls } = createHarness({ applications: async () => ({ ok: true, value: [] }) });
  exports.apply(ctx, {});

  click(document);
  ctx.sidebarRight.openResource('dsh-resource://file/session/s-1/README.md');
  await tick();

  assert.equal(calls.open.length, 1);
  assert.equal(calls.open[0].path, '/Users/wfq/Desktop/my-plugin/README.md');
  assert.equal(calls.open[0].application, undefined);
  assert.equal(calls.preview.length, 0);
});

test('requireExplicitApp refuses to open when Typora is absent', async () => {
  const { exports, document } = loadClient();
  const { ctx, calls } = createHarness({ applications: async () => ({ ok: true, value: [] }) });
  exports.apply(ctx, { requireExplicitApp: true });

  click(document);
  ctx.sidebarRight.openResource('dsh-resource://file/session/s-1/README.md');
  await tick();

  assert.equal(calls.open.length, 0);
  assert.equal(calls.preview.length, 1);
});

test('config extensions replace the default list', async () => {
  const { exports, document } = loadClient();
  const { ctx, calls } = createHarness();
  exports.apply(ctx, { extensions: ['mdx'] });

  click(document);
  ctx.sidebarRight.openResource('dsh-resource://file/session/s-1/README.md');
  await tick();
  assert.equal(calls.preview.length, 1);
  assert.equal(calls.open.length, 0);

  click(document);
  ctx.sidebarRight.openResource('dsh-resource://file/session/s-1/README.mdx');
  await tick();
  assert.equal(calls.open.length, 1);
});

test('the application cache reuses one handler lookup per extension', async () => {
  const { exports, document } = loadClient();
  const { ctx, calls } = createHarness();
  exports.apply(ctx, {});

  click(document);
  ctx.sidebarRight.openResource('dsh-resource://file/session/s-1/README.md');
  await tick();
  click(document);
  ctx.sidebarRight.openResource('dsh-resource://file/session/s-1/README.md');
  await tick();

  assert.equal(calls.open.length, 2);
  assert.equal(calls.applications.length, 1);
});

test('disposing restores the original navigation method and listeners', async () => {
  const { exports, document } = loadClient();
  const { ctx, service, calls, cleanups } = createHarness();
  exports.apply(ctx, {});
  assert.equal(cleanups.length, 1);

  cleanups[0]();

  click(document);
  service.openResource('dsh-resource://file/session/s-1/README.md');
  await tick();

  assert.equal(calls.open.length, 0);
  assert.equal(calls.preview.length, 1);
});

test('matches applications by bundle id and display name', () => {
  const { exports } = loadClient();
  const { applicationMatches } = exports.__test;
  const settings = { appName: 'Typora', bundleId: 'abnerworks.Typora' };
  assert.equal(applicationMatches({ id: 'abnerworks.Typora', name: 'Typora' }, settings), true);
  assert.equal(applicationMatches({ id: '/Applications/Typora.app', name: 'Typora' }, settings), true);
  assert.equal(applicationMatches({ id: 'com.apple.TextEdit', name: 'TextEdit' }, settings), false);
});
