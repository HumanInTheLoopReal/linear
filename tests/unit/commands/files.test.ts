import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileServiceMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("../../../src/services/file-service.js", () => ({
  FileService: class {
    constructor(apiToken: string, endpoint?: string) {
      fileServiceMocks.constructor(apiToken, endpoint);
    }

    downloadFile = fileServiceMocks.downloadFile;
    uploadFile = fileServiceMocks.uploadFile;
  },
}));

vi.mock("../../../src/common/output.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/common/output.js")>();
  return { ...actual, outputResult: vi.fn() };
});

import { setupFilesCommands } from "../../../src/commands/files.js";

function createProgram(): Command {
  const program = new Command();
  program.option("--api-token <token>");
  setupFilesCommands(program);
  return program;
}

describe("files endpoint configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LINEAR_ENDPOINT", "https://proxy.example/graphql");
    fileServiceMocks.uploadFile.mockResolvedValue({
      success: true,
      assetUrl: "https://uploads.linear.app/asset.png",
      filename: "asset.png",
    });
    fileServiceMocks.downloadFile.mockResolvedValue({
      success: true,
      filePath: "asset.png",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["upload", ["upload", "asset.png"]],
    ["download", ["download", "https://uploads.linear.app/asset.png"]],
  ])("passes the configured endpoint to %s", async (_name, commandArgs) => {
    await createProgram().parseAsync([
      "node",
      "test",
      "--api-token",
      "test-token",
      "files",
      ...commandArgs,
    ]);

    expect(fileServiceMocks.constructor).toHaveBeenCalledWith(
      "test-token",
      "https://proxy.example/graphql",
    );
  });
});
