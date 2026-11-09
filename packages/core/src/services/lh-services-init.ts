// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

/**
 * CDP snippet that resolves LinkedHelper frontend service singletons
 * via the webpack module registry and exposes them on `lhSvc`.
 *
 * Injected into launcher `Runtime.evaluate` expressions. First successful
 * scan (with `auth.userId` present) is cached on `window.__lhrServices`.
 *
 * **Why marker-based?** Webpack module IDs are not stable across
 * LinkedHelper releases. Between v2.113.11 and v2.113.28, three of
 * the four service modules we depend on shifted IDs. The only
 * reliable way to locate services is to scan for module exports
 * with characteristic fields (e.g. `_workspacesBS` for the workspace
 * service). See `research/linkedhelper/architecture/V2113-WEBPACK-MODULE-IDS.md`.
 *
 * **Why factory-source filtering?** On LinkedHelper 2.130, requiring
 * every webpack module executes factories that hang the renderer, and
 * reading a minified export such as `A` can throw
 * `Cannot access 'oe' before initialization`. Only modules whose
 * factory source contains a distinctive needle are required. Short
 * tokens such as `A` or `userId` are not needles — they match almost
 * every minified module.
 *
 * Each resolved service is exposed under a dotless alias:
 *
 * - `lhSvc.auth` — authService (userId, role, isLoggedIn)
 * - `lhSvc.user` — userService (currentUserBS, fetchUser)
 * - `lhSvc.runningLi` — runningLiAccountsService
 *   (extendedLinkedInAccountsBS, getLinkedInAccount, startLinkedInAccountLocal)
 * - `lhSvc.feSettings` — frontendSettingsService (getFrontendSettings, _cacheBS)
 * - `lhSvc.workspace` — workspaceService
 *   (_workspacesBS, _selectedWorkspaceBS, api, refreshWorkspaces); may be
 *   `null` on LinkedHelper versions that predate workspaces
 *
 * Callers must check `lhSvc` for null and handle the failure case.
 */
export const LH_SERVICES_INIT = `
    const _wpDeadline = Date.now() + 15000;
    while (!window.webpackChunk_linked_helper_front && Date.now() < _wpDeadline) {
      await new Promise(r => setTimeout(r, 250));
    }
    let lhSvc = null;
    let _cached = undefined;
    try { _cached = window.__lhrServices; } catch (_e) { _cached = undefined; }
    let _cachedUserId = undefined;
    try { _cachedUserId = _cached && _cached.auth && _cached.auth.userId; } catch (_e) { _cachedUserId = undefined; }
    if (_cached && _cachedUserId) {
      lhSvc = _cached;
    } else {
      if (_cached) {
        try { window.__lhrServices = undefined; } catch (_e) {}
      }
      if (window.webpackChunk_linked_helper_front) {
        let _wpReq = null;
        window.webpackChunk_linked_helper_front.push(
          [[Symbol()], {}, (req) => { _wpReq = req; }]
        );
        if (_wpReq) {
          const _FACTORY_NEEDLES = [
            'authService',
            'currentUserBS',
            'extendedLinkedInAccountsBS',
            'getFrontendSettings',
            '_workspacesBS',
            'runningLiAccountsService',
            'frontendSettingsService',
          ];
          const _specs = {
            auth:        { exportKey: 'authService',              markers: ['userId', 'role'] },
            user:        { exportKey: 'default',                  markers: ['currentUserBS', 'fetchUser'] },
            runningLi:   { exportKey: 'runningLiAccountsService', markers: ['extendedLinkedInAccountsBS', 'getLinkedInAccount'] },
            feSettings:  { exportKey: 'frontendSettingsService',  markers: ['getFrontendSettings', '_cacheBS'] },
            workspace:   { exportKey: 'A',                        markers: ['_workspacesBS', '_selectedWorkspaceBS'] },
          };
          const _resolved = {};
          for (const _id of Object.keys(_wpReq.m || {})) {
            let _factory;
            try { _factory = _wpReq.m[_id]; } catch (_e) { continue; }
            let _src = '';
            try {
              _src = typeof _factory === 'function'
                ? Function.prototype.toString.call(_factory)
                : '';
            } catch (_e) { continue; }
            if (!_src || !_FACTORY_NEEDLES.some(_n => _src.includes(_n))) continue;
            try {
              const _mod = _wpReq(_id);
              if (!_mod) continue;
              for (const _name of Object.keys(_specs)) {
                if (_resolved[_name]) continue;
                const _spec = _specs[_name];
                try {
                  const _v = _mod[_spec.exportKey];
                  if (_v && typeof _v === 'object' && _spec.markers.every(m => m in _v)) {
                    _resolved[_name] = _v;
                    continue;
                  }
                  for (const _k of Object.keys(_mod)) {
                    const _w = _mod[_k];
                    if (!_w || typeof _w !== 'object') continue;
                    if (_spec.markers.every(m => m in _w)) {
                      _resolved[_name] = _w;
                      break;
                    }
                  }
                } catch (_e) { continue; }
              }
            } catch (_e) { continue; }
            if (Object.keys(_resolved).length === Object.keys(_specs).length) break;
          }
          if (_resolved.auth && _resolved.user && _resolved.runningLi && _resolved.feSettings) {
            // workspace may legitimately be missing on pre-2.113.x launchers
            lhSvc = {
              auth: _resolved.auth,
              user: _resolved.user,
              runningLi: _resolved.runningLi,
              feSettings: _resolved.feSettings,
              workspace: _resolved.workspace || null,
            };
            let _readyUserId = undefined;
            try { _readyUserId = lhSvc.auth && lhSvc.auth.userId; } catch (_e) { _readyUserId = undefined; }
            if (_readyUserId) {
              window.__lhrServices = lhSvc;
            }
          }
        }
      }
    }`;
