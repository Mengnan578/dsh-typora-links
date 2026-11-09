/**
 * dsh-typora-links — client half.
 *
 * A plain click on a local Markdown link in the DSH conversation opens the
 * file in Typora instead of the right-sidebar preview. Modified clicks
 * (Cmd/Ctrl/Shift/Alt) keep the shipped preview behavior, and every failure
 * falls back to that preview so a click is never lost.
 *
 * The plugin is browser-only: it wraps the Sidebar navigation service and
 * reuses DSH's authenticated Session Remote to stat the file, resolve the
 * Typora application entry, and hand the path to the native opener.
 */
window.__ModuleLoader__.load({
  id: 'dsh-typora-links',
  factory(require) {
    const NS = 'typora-links';
    const FILE_ADDRESS_PREFIX = 'dsh-resource://file/';

    const DEFAULTS = Object.freeze({
      appName: 'Typora',
      bundleId: 'abnerworks.Typora',
      extensions: Object.freeze(['.md', '.markdown']),
      gestureWindowMs: 900,
      requireExplicitApp: false,
    });

    /** Services this plugin needs; a missing one fails the plugin instead of misbehaving. */
    const inject = ['remote', 'remote.session', 'remote.workspaceFiles', 'sidebarRight'];

    function warn(...args) {
      try {
        console.warn(`[${NS}]`, ...args);
      } catch {
        // A console-less host must not break the fallback path.
      }
    }

    function now() {
      return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    }

    function isDriveSegment(segment) {
      return /^[A-Za-z]:$/.test(segment);
    }

    /**
     * Parse a `dsh-resource://file/...` address. This mirrors the grammar of
     * DSH's shared workspace-path helper so the plugin needs no internal
     * module import and stays a self-contained bundle.
     *
     * @param address - candidate resource address.
     * @returns `{ scope, sessionId?, path }` or undefined.
     */
    function parseFileAddress(address) {
      try {
        if (typeof address !== 'string' || !address.startsWith(FILE_ADDRESS_PREFIX)) return undefined;
        const end = address.search(/[?#]/);
        const [scope, ...rest] = address
          .slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end)
          .split('/');
        if (scope === 'session') {
          const [id, ...segments] = rest;
          if (id === undefined || id === '' || segments.length === 0) return undefined;
          return {
            scope,
            sessionId: decodeURIComponent(id),
            path: segments.map(decodeURIComponent).join('/'),
          };
        }
        if (scope === 'absolute') {
          const unc = rest[0] === '' && rest.length > 1;
          const segments = (unc ? rest.slice(1) : rest).map(decodeURIComponent);
          if (segments.length === 0 || segments[0] === '') return undefined;
          return {
            scope,
            path: unc
              ? `//${segments.join('/')}`
              : isDriveSegment(segments[0])
                ? segments.join('/')
                : `/${segments.join('/')}`,
          };
        }
        return undefined;
      } catch {
        return undefined;
      }
    }

    function normalizeExtension(value) {
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim().toLowerCase();
      if (trimmed === '') return undefined;
      return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
    }

    /**
     * Merge the optional bundle config over the shipped defaults.
     *
     * @param config - the plugin row's `config` object, when present.
     * @returns normalized settings.
     */
    function normalizeConfig(config) {
      const source = config !== null && typeof config === 'object' ? config : {};
      const configured = Array.isArray(source.extensions)
        ? source.extensions.map(normalizeExtension).filter(Boolean)
        : [];
      return {
        appName: typeof source.appName === 'string' ? source.appName.trim() : DEFAULTS.appName,
        bundleId: typeof source.bundleId === 'string' ? source.bundleId.trim() : DEFAULTS.bundleId,
        extensions: configured.length > 0 ? configured : DEFAULTS.extensions.slice(),
        gestureWindowMs:
          Number.isFinite(source.gestureWindowMs) && source.gestureWindowMs > 0
            ? source.gestureWindowMs
            : DEFAULTS.gestureWindowMs,
        requireExplicitApp: source.requireExplicitApp === true,
      };
    }

    function matchesExtension(filePath, extensions) {
      if (typeof filePath !== 'string') return false;
      const lower = filePath.toLowerCase();
      return extensions.some((extension) => lower.endsWith(extension));
    }

    function applicationMatches(application, settings) {
      if (application === null || typeof application !== 'object') return false;
      const id = typeof application.id === 'string' ? application.id : '';
      const name = typeof application.name === 'string' ? application.name : '';
      const idLower = id.toLowerCase();
      const nameLower = name.toLowerCase();
      if (settings.bundleId !== '') {
        const wanted = settings.bundleId.toLowerCase();
        if (idLower === wanted || idLower.includes(wanted)) return true;
      }
      if (settings.appName !== '') {
        const wanted = settings.appName.toLowerCase();
        if (nameLower === wanted || idLower.includes(wanted)) return true;
      }
      return false;
    }

    function findApplication(applications, settings) {
      if (!Array.isArray(applications)) return undefined;
      return applications.find((application) => applicationMatches(application, settings));
    }

    function apply(ctx, config) {
      const settings = normalizeConfig(config);
      /** Extension -> resolved application id, filled on first successful lookup. */
      const applicationCache = new Map();
      let lastGesture = null;

      /**
       * Record a real pointer gesture. Modified gestures are recorded too, so
       * the wrapper can tell "modified click" from "no click at all".
       */
      function noteGesture(event) {
        if (event === null || typeof event !== 'object') return;
        if (typeof event.button === 'number' && event.button !== 0) return;
        lastGesture = {
          at: now(),
          modified:
            event.metaKey === true ||
            event.ctrlKey === true ||
            event.shiftKey === true ||
            event.altKey === true,
        };
      }

      /** Consume the pending gesture: one open per gesture, unmodified, still fresh. */
      function takeGesture() {
        const gesture = lastGesture;
        lastGesture = null;
        if (gesture === null) return false;
        if (gesture.modified) return false;
        return now() - gesture.at <= settings.gestureWindowMs;
      }

      /** Ask macOS for the file's handlers and pick the configured application. */
      async function resolveApplication(absolutePath) {
        if (settings.appName === '' && settings.bundleId === '') return undefined;
        const extension = settings.extensions.find((candidate) =>
          absolutePath.toLowerCase().endsWith(candidate),
        );
        if (extension === undefined) return undefined;
        if (applicationCache.has(extension)) return applicationCache.get(extension);

        const listed = await ctx.remote.session.workspacePathApplications({ path: absolutePath });
        if (listed === null || typeof listed !== 'object' || listed.ok !== true) return undefined;
        const match = findApplication(listed.value, settings);
        if (match === undefined) return undefined;
        applicationCache.set(extension, match.id);
        return match.id;
      }

      /**
       * Try to send one address to Typora.
       *
       * @param address - raw `dsh-resource://...` address from the navigation call.
       * @returns whether the native open was acknowledged.
       */
      async function openInTypora(address) {
        const parsed = parseFileAddress(address);
        if (parsed === undefined || parsed.scope !== 'session') return false;
        if (!matchesExtension(parsed.path, settings.extensions)) return false;

        const stat = await ctx.remote.workspaceFiles.stat(parsed.sessionId, parsed.path);
        if (stat === null || typeof stat !== 'object' || stat.ok !== true) return false;
        if (stat.value === null || typeof stat.value !== 'object') return false;
        const absolutePath = stat.value.absolutePath;
        if (typeof absolutePath !== 'string' || absolutePath === '') return false;

        let application;
        try {
          application = await resolveApplication(absolutePath);
        } catch (error) {
          if (settings.requireExplicitApp) return false;
          warn('application lookup failed; falling back to the default application', error);
        }
        if (application === undefined && settings.requireExplicitApp) return false;

        const request =
          application === undefined ? { path: absolutePath } : { path: absolutePath, application };
        const opened = await ctx.remote.session.openWorkspacePath(request);
        if (opened !== null && typeof opened === 'object' && opened.ok === true) return true;

        if (application !== undefined) {
          // A stale handler id should not lose the click: retry the default opener once.
          applicationCache.clear();
          const fallback = await ctx.remote.session.openWorkspacePath({ path: absolutePath });
          return fallback !== null && typeof fallback === 'object' && fallback.ok === true;
        }
        return false;
      }

      /**
       * Wrap `ctx.sidebarRight.openResource`, the single entry the conversation
       * uses for file links. Tab-scoped navigation (`openResourceIn`) bypasses
       * this method, so the file tree and tab strip keep their shipped preview.
       *
       * @returns a disposer restoring the original method.
       */
      function installWrapper() {
        const service = ctx.sidebarRight;
        if (service === null || typeof service !== 'object' || typeof service.openResource !== 'function') {
          warn('ctx.sidebarRight.openResource is unavailable; preview behavior stays untouched');
          return () => {};
        }
        const own = Object.prototype.hasOwnProperty.call(service, 'openResource');
        const holder = own ? service : Object.getPrototypeOf(service);
        if (holder === null || typeof holder !== 'object') {
          warn('could not locate the openResource holder; preview behavior stays untouched');
          return () => {};
        }
        const descriptor = Object.getOwnPropertyDescriptor(holder, 'openResource');
        if (descriptor !== undefined && descriptor.writable === false && descriptor.set === undefined) {
          warn('openResource is not writable; preview behavior stays untouched');
          return () => {};
        }
        const original = holder.openResource;
        if (typeof original !== 'function') {
          warn('openResource is not callable; preview behavior stays untouched');
          return () => {};
        }

        /**
         * @param address - resource address passed by the conversation.
         * @param options - placement and navigation parameters.
         */
        function openResource(address, options) {
          const self = this;
          if (!takeGesture()) return original.call(self, address, options);
          openInTypora(address).then(
            (opened) => {
              if (!opened) original.call(self, address, options);
            },
            (error) => {
              warn('native open failed; falling back to the preview', error);
              original.call(self, address, options);
            },
          );
          return undefined;
        }

        try {
          holder.openResource = openResource;
        } catch (error) {
          warn('could not wrap openResource; preview behavior stays untouched', error);
          return () => {};
        }
        return () => {
          try {
            if (holder.openResource === openResource) holder.openResource = original;
          } catch (error) {
            warn('could not restore the original openResource', error);
          }
        };
      }

      const disposers = [];
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('pointerdown', noteGesture, true);
        disposers.push(() => document.removeEventListener('pointerdown', noteGesture, true));
        document.addEventListener('click', noteGesture, true);
        disposers.push(() => document.removeEventListener('click', noteGesture, true));
      }
      disposers.push(installWrapper());

      const teardown = () => {
        while (disposers.length > 0) {
          const dispose = disposers.pop();
          try {
            dispose();
          } catch (error) {
            warn('cleanup failed', error);
          }
        }
      };
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => teardown, `${NS}: gesture capture and openResource wrapper`);
      }
    }

    return {
      inject,
      apply,
      // Exposed for the package's own Node test suite; DSH ignores extra exports.
      __test: { parseFileAddress, matchesExtension, applicationMatches, normalizeConfig },
    };
  },
});
