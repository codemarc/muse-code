import { describe, expect, test } from "bun:test";
import {
  defaultKeychainHasMetaCredential,
  defaultMuseAuthPath,
  probeMuseAuth,
} from "./museAuth";

describe("defaultMuseAuthPath", () => {
  test("uses XDG_CONFIG_HOME when set", () => {
    expect(defaultMuseAuthPath({ XDG_CONFIG_HOME: "/custom/cfg" })).toBe(
      "/custom/cfg/muse/auth.json",
    );
  });
});

describe("defaultKeychainHasMetaCredential", () => {
  test("trusts the auth.json pointer off macOS", () => {
    expect(defaultKeychainHasMetaCredential("linux")).toBe(true);
  });
});

describe("probeMuseAuth", () => {
  test("echo provider skips Meta auth", () => {
    const r = probeMuseAuth({
      useEchoProvider: true,
      env: {},
      readAuthFile: () => null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("echo");
    }
  });

  test("accepts META_API_KEY", () => {
    const r = probeMuseAuth({
      useEchoProvider: false,
      env: { META_API_KEY: "secret" },
      readAuthFile: () => null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("env");
    }
  });

  test("accepts stored api_key", () => {
    const r = probeMuseAuth({
      useEchoProvider: false,
      env: {},
      readAuthFile: () =>
        JSON.stringify({
          providers: { meta: { api_key: "mk-test", user_email: "a@b.com" } },
        }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("stored");
      expect(r.detail).toContain("a@b.com");
    }
  });

  test("accepts stored access_token", () => {
    const r = probeMuseAuth({
      useEchoProvider: false,
      env: {},
      readAuthFile: () =>
        JSON.stringify({
          providers: { meta: { access_token: "tok" } },
        }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("stored");
    }
  });

  test("rejects missing auth", () => {
    const r = probeMuseAuth({
      useEchoProvider: false,
      env: {},
      readAuthFile: () => null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.hint).toContain("muse login");
      expect(r.hint).toContain("META_API_KEY");
    }
  });

  test("rejects empty stored credential", () => {
    const r = probeMuseAuth({
      useEchoProvider: false,
      env: {},
      readAuthFile: () => JSON.stringify({ providers: { meta: {} } }),
    });
    expect(r.ok).toBe(false);
  });

  test("accepts Muse 1.0.2 keychain-backed oauth metadata", () => {
    const r = probeMuseAuth({
      useEchoProvider: false,
      env: {},
      readAuthFile: () =>
        JSON.stringify({
          schema_version: 2,
          providers: {
            meta: {
              api_base_url: "https://api.meta.ai/v1",
              mechanism: "oauth",
              obtained_via: "device_code",
              storage: "keychain",
              user_email: "a@b.com",
              user_full_name: "A B",
            },
          },
        }),
      keychainHasMetaCredential: () => true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("keychain");
      expect(r.detail).toContain("a@b.com");
      expect(r.detail).toContain("keychain");
    }
  });

  test("rejects keychain pointer when the keychain item is missing", () => {
    const r = probeMuseAuth({
      useEchoProvider: false,
      env: {},
      readAuthFile: () =>
        JSON.stringify({
          providers: { meta: { storage: "keychain", user_email: "a@b.com" } },
        }),
      keychainHasMetaCredential: () => false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("Keychain");
      expect(r.hint).toContain("muse login");
    }
  });

  test("rejects malformed json", () => {
    const r = probeMuseAuth({
      useEchoProvider: false,
      env: {},
      readAuthFile: () => "{not-json",
    });
    expect(r.ok).toBe(false);
  });
});
