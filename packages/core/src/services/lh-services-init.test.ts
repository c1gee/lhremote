// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Oleksii PELYKH

import { afterEach, describe, expect, it, vi } from "vitest";

import { LH_SERVICES_INIT } from "./lh-services-init.js";

interface WebpackModule {
  exports: Record<string, unknown>;
}

type WebpackFactory = (
  module: WebpackModule,
  exports: Record<string, unknown>,
) => void;

interface WebpackRequire {
  (id: string): Record<string, unknown>;
  m: Record<string, WebpackFactory>;
}

interface FakeWindow {
  webpackChunk_linked_helper_front?: {
    push: (chunk: unknown[]) => void;
  };
  __lhrServices?: unknown;
}

interface InitResult {
  lhSvc: Record<string, Record<string, unknown> | null> | null;
  cached: unknown;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function parseFactoryNeedles(snippet: string): string[] {
  const match = /_FACTORY_NEEDLES = \[([\s\S]*?)\];/.exec(snippet);
  if (!match?.[1]) {
    throw new Error("_FACTORY_NEEDLES array not found in LH_SERVICES_INIT");
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

function createWebpackWindow(
  factories: Record<string, WebpackFactory>,
  cache?: unknown,
): { window: FakeWindow; requiredIds: string[] } {
  const requiredIds: string[] = [];
  const wpReq = ((id: string) => {
    requiredIds.push(id);
    const factory = factories[id];
    if (!factory) {
      throw new Error(`unknown webpack module ${id}`);
    }
    const module: WebpackModule = { exports: {} };
    factory(module, module.exports);
    return module.exports;
  }) as WebpackRequire;
  wpReq.m = factories;

  const window: FakeWindow = {
    webpackChunk_linked_helper_front: {
      push(chunk: unknown[]) {
        const runtime = chunk[2];
        if (typeof runtime === "function") {
          (runtime as (req: WebpackRequire) => void)(wpReq);
        }
      },
    },
  };
  if (cache !== undefined) {
    window.__lhrServices = cache;
  }
  return { window, requiredIds };
}

async function runInit(fakeWindow: FakeWindow): Promise<InitResult> {
  vi.stubGlobal("window", fakeWindow);
  const fn = new Function(`
    return (async () => {
      ${LH_SERVICES_INIT}
      return { lhSvc, cached: window.__lhrServices };
    })();
  `) as () => Promise<InitResult>;
  return fn();
}

function authFactory(_module: WebpackModule, exports: Record<string, unknown>): void {
  exports.authService = { userId: 438509, role: "user" };
}

function userFactory(_module: WebpackModule, exports: Record<string, unknown>): void {
  exports.default = {
    currentUserBS: { value: { email: "a@b.c" } },
    fetchUser: () => ({ email: "a@b.c" }),
  };
}

function runningLiFactory(
  _module: WebpackModule,
  exports: Record<string, unknown>,
): void {
  exports.runningLiAccountsService = {
    extendedLinkedInAccountsBS: { value: [] },
    getLinkedInAccount: () => null,
  };
}

function feSettingsFactory(
  _module: WebpackModule,
  exports: Record<string, unknown>,
): void {
  exports.frontendSettingsService = {
    getFrontendSettings: () => ({ selectedWorkspaceId: 20338 }),
    _cacheBS: { value: null },
  };
}

function workspaceFactory(
  _module: WebpackModule,
  exports: Record<string, unknown>,
): void {
  exports.A = {
    _workspacesBS: { value: [] },
    _selectedWorkspaceBS: { value: { id: 20338 } },
  };
}

function poisonFactory(): void {
  const A = 1;
  const userId = 2;
  throw new Error(`unfiltered require of a non-service module ${String(A)} ${String(userId)}`);
}

function tdzWorkspaceFactory(
  _module: WebpackModule,
  exports: Record<string, unknown>,
): void {
  exports.__needle = "_workspacesBS";
  Object.defineProperty(exports, "A", {
    enumerable: true,
    get() {
      throw new ReferenceError("Cannot access 'oe' before initialization");
    },
  });
}

const CORE_FACTORIES: Record<string, WebpackFactory> = {
  auth: authFactory,
  user: userFactory,
  runningLi: runningLiFactory,
  feSettings: feSettingsFactory,
  workspace: workspaceFactory,
};

describe("LH_SERVICES_INIT", () => {
  it("lists only distinctive factory-source needles", () => {
    const needles = parseFactoryNeedles(LH_SERVICES_INIT);

    expect(needles).toEqual([
      "authService",
      "currentUserBS",
      "extendedLinkedInAccountsBS",
      "getFrontendSettings",
      "_workspacesBS",
      "runningLiAccountsService",
      "frontendSettingsService",
    ]);
    expect(needles).not.toContain("A");
    expect(needles).not.toContain("userId");
    expect(needles.every((n) => n.length > 3)).toBe(true);
  });

  it("resolves services from marked factories and skips unmarked modules", async () => {
    const { window, requiredIds } = createWebpackWindow({
      poison: poisonFactory,
      filler: poisonFactory,
      ...CORE_FACTORIES,
    });

    const { lhSvc, cached } = await runInit(window);

    expect(requiredIds).not.toContain("poison");
    expect(requiredIds).not.toContain("filler");
    expect(lhSvc?.auth).toMatchObject({ userId: 438509, role: "user" });
    expect(lhSvc?.user).toMatchObject({
      currentUserBS: { value: { email: "a@b.c" } },
    });
    expect(lhSvc?.runningLi).toHaveProperty("extendedLinkedInAccountsBS");
    expect(lhSvc?.feSettings).toHaveProperty("getFrontendSettings");
    expect(lhSvc?.workspace).toMatchObject({
      _selectedWorkspaceBS: { value: { id: 20338 } },
    });
    expect(cached).toBe(lhSvc);
  });

  it("skips a marked module whose exportKey access throws TDZ", async () => {
    const { window, requiredIds } = createWebpackWindow({
      tdz: tdzWorkspaceFactory,
      ...CORE_FACTORIES,
    });

    const { lhSvc } = await runInit(window);

    expect(requiredIds).toContain("tdz");
    expect(lhSvc?.workspace).toMatchObject({
      _workspacesBS: { value: [] },
    });
  });

  it("does not cache until auth.userId is present", async () => {
    function unreadyAuthFactory(
      _module: WebpackModule,
      exports: Record<string, unknown>,
    ): void {
      exports.authService = { userId: null, role: "user" };
    }

    const { window } = createWebpackWindow({
      ...CORE_FACTORIES,
      auth: unreadyAuthFactory,
    });

    const { lhSvc, cached } = await runInit(window);

    expect(lhSvc?.auth).toMatchObject({ role: "user" });
    expect(lhSvc?.auth?.userId).toBeFalsy();
    expect(cached).toBeUndefined();
    expect(window.__lhrServices).toBeUndefined();
  });

  it("discards a stale cache that has no auth.userId and rescans", async () => {
    const stale = {
      auth: { role: "user" },
      user: { stale: true },
      runningLi: { stale: true },
      feSettings: { stale: true },
      workspace: null,
    };
    const { window } = createWebpackWindow(CORE_FACTORIES, stale);

    const { lhSvc, cached } = await runInit(window);

    expect(lhSvc?.user).not.toMatchObject({ stale: true });
    expect(lhSvc?.auth).toMatchObject({ userId: 438509 });
    expect(cached).toBe(lhSvc);
  });

  it("reuses a cache that already has auth.userId without requiring modules", async () => {
    const hot = {
      auth: { userId: 99, role: "user" },
      user: { sentinel: true },
      runningLi: {},
      feSettings: {},
      workspace: null,
    };
    const { window, requiredIds } = createWebpackWindow(
      { poison: poisonFactory, ...CORE_FACTORIES },
      hot,
    );

    const { lhSvc, cached } = await runInit(window);

    expect(requiredIds).toEqual([]);
    expect(lhSvc).toBe(hot);
    expect(cached).toBe(hot);
    expect(lhSvc?.user).toMatchObject({ sentinel: true });
  });

  it("still resolves when the workspace module is absent", async () => {
    const { window } = createWebpackWindow({
      auth: authFactory,
      user: userFactory,
      runningLi: runningLiFactory,
      feSettings: feSettingsFactory,
    });

    const { lhSvc } = await runInit(window);

    expect(lhSvc?.auth).toMatchObject({ userId: 438509 });
    expect(lhSvc?.workspace).toBeNull();
  });
});
