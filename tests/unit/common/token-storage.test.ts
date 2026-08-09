import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs");
vi.mock("node:os");

vi.mock("../../../src/common/encryption.js", () => ({
  encryptToken: vi.fn((token: string) => `encrypted:${token}`),
  decryptToken: vi.fn((encrypted: string) =>
    encrypted.replace("encrypted:", ""),
  ),
}));

import { decryptToken } from "../../../src/common/encryption.js";
import {
  clearToken,
  ensureTokenDir,
  getStoredToken,
  getTokenDir,
  saveToken,
} from "../../../src/common/token-storage.js";

const HOME = "/home/testuser";
const originalPlatform = process.platform;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.XDG_CONFIG_HOME;
  vi.mocked(os.homedir).mockReturnValue(HOME);
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
});

function setPlatform(p: string): void {
  Object.defineProperty(process, "platform", { value: p });
}

const linearDir = path.join(HOME, "linear");
const linearToken = path.join(linearDir, "token");
const xdgDir = path.join(HOME, ".config", "linear");
const xdgToken = path.join(HOME, ".config", "linear", "token");
const legacyPlaintextToken = path.join(HOME, ".linear_api_token");

describe("getTokenDir", () => {
  it("returns ~/linear on macOS", () => {
    setPlatform("darwin");
    expect(getTokenDir()).toBe(linearDir);
  });

  it("returns ~/linear on Windows", () => {
    setPlatform("win32");
    expect(getTokenDir()).toBe(linearDir);
  });

  it("returns ~/.config/linear on Linux when XDG_CONFIG_HOME is unset", () => {
    setPlatform("linux");
    expect(getTokenDir()).toBe(xdgDir);
  });

  it("uses XDG_CONFIG_HOME on Linux when set", () => {
    setPlatform("linux");
    process.env.XDG_CONFIG_HOME = "/custom/config";
    expect(getTokenDir()).toBe(path.join("/custom/config", "linear"));
  });

  it("ignores relative XDG_CONFIG_HOME", () => {
    setPlatform("linux");
    process.env.XDG_CONFIG_HOME = "relative/path";
    expect(getTokenDir()).toBe(xdgDir);
  });
});

describe("ensureTokenDir", () => {
  it("creates directory with 0700 permissions", () => {
    setPlatform("darwin");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    ensureTokenDir();

    expect(fs.mkdirSync).toHaveBeenCalledWith(linearDir, {
      recursive: true,
      mode: 0o700,
    });
  });

  it("fixes permissions if directory exists", () => {
    setPlatform("darwin");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.chmodSync).mockReturnValue(undefined);

    ensureTokenDir();

    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.chmodSync).toHaveBeenCalledWith(linearDir, 0o700);
  });

  it("creates XDG path on Linux", () => {
    setPlatform("linux");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    ensureTokenDir();

    expect(fs.mkdirSync).toHaveBeenCalledWith(xdgDir, {
      recursive: true,
      mode: 0o700,
    });
  });
});

describe("saveToken", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.chmodSync).mockReturnValue(undefined);
  });

  it("writes encrypted token to correct path", () => {
    setPlatform("darwin");
    saveToken("my-api-token");

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      linearToken,
      "encrypted:my-api-token",
      "utf8",
    );
  });

  it("sets file permissions to 0600", () => {
    setPlatform("darwin");
    saveToken("my-api-token");

    expect(fs.chmodSync).toHaveBeenCalledWith(linearToken, 0o600);
  });

  it("writes to XDG path on Linux", () => {
    setPlatform("linux");
    saveToken("my-api-token");

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      xdgToken,
      "encrypted:my-api-token",
      "utf8",
    );
  });
});

describe("getStoredToken", () => {
  it("returns decrypted token when file exists", () => {
    setPlatform("darwin");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("encrypted:my-api-token");

    expect(getStoredToken()).toBe("my-api-token");
  });

  it("returns null when file does not exist", () => {
    setPlatform("darwin");
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(getStoredToken()).toBeNull();
  });

  // Resolution has exactly one source. An absent token file is the end of the
  // lookup, not the start of a search through other directories.
  it("reads only the primary token path", () => {
    setPlatform("darwin");
    vi.mocked(fs.existsSync).mockImplementation(
      (candidate) => candidate === linearToken,
    );
    vi.mocked(fs.readFileSync).mockReturnValue("encrypted:primary-token");

    expect(getStoredToken()).toBe("primary-token");
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync).toHaveBeenCalledWith(linearToken, "utf8");
  });

  it("does not fall back to another directory when the token is absent", () => {
    setPlatform("darwin");
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(getStoredToken()).toBeNull();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("logs a warning to stderr when stored token cannot be decrypted", () => {
    setPlatform("darwin");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("corrupted-data");
    vi.mocked(decryptToken).mockImplementationOnce(() => {
      throw new Error("Invalid encrypted token format");
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = getStoredToken();

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("could not be decrypted"),
    );
    consoleSpy.mockRestore();
  });

  it("returns null silently when file disappears between exists check and read", () => {
    setPlatform("darwin");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const enoent = new Error("ENOENT") as NodeJS.ErrnoException;
    enoent.code = "ENOENT";
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw enoent;
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = getStoredToken();

    expect(result).toBeNull();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns null when token file is missing on Linux", () => {
    setPlatform("linux");
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(getStoredToken()).toBeNull();
  });

  it("reads the XDG token path on Linux", () => {
    setPlatform("linux");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("encrypted:xdg-token");

    expect(getStoredToken()).toBe("xdg-token");
    expect(fs.readFileSync).toHaveBeenCalledWith(xdgToken, "utf8");
  });
});

describe("clearToken", () => {
  it("removes the current and deprecated plaintext token files on macOS", () => {
    setPlatform("darwin");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

    clearToken();

    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    expect(fs.unlinkSync).toHaveBeenCalledWith(linearToken);
    expect(fs.unlinkSync).toHaveBeenCalledWith(legacyPlaintextToken);
  });

  it("removes the current and deprecated plaintext token files on Windows", () => {
    setPlatform("win32");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

    clearToken();

    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    expect(fs.unlinkSync).toHaveBeenCalledWith(linearToken);
    expect(fs.unlinkSync).toHaveBeenCalledWith(legacyPlaintextToken);
  });

  it("removes the deprecated plaintext token when it is the only token", () => {
    setPlatform("darwin");
    vi.mocked(fs.existsSync).mockImplementation(
      (candidate) => candidate === legacyPlaintextToken,
    );
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

    clearToken();

    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
    expect(fs.unlinkSync).toHaveBeenCalledWith(legacyPlaintextToken);
  });

  it("does nothing if token file does not exist", () => {
    setPlatform("darwin");
    vi.mocked(fs.existsSync).mockReturnValue(false);

    clearToken();

    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it("removes the XDG token on Linux", () => {
    setPlatform("linux");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

    clearToken();

    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    expect(fs.unlinkSync).toHaveBeenCalledWith(xdgToken);
    expect(fs.unlinkSync).toHaveBeenCalledWith(legacyPlaintextToken);
  });
});
