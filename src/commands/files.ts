import type { Command } from "commander";
import { type CommandOptions, getApiToken } from "../common/auth.js";
import { getLinearEndpoint } from "../common/config-store.js";
import { getRootOpts } from "../common/context.js";
import { handleCommand, outputResult } from "../common/output.js";
import { type DomainMeta, formatDomainUsage } from "../common/usage.js";
import { FileService } from "../services/file-service.js";

/**
 * Both verbs emit a single status line — the same `message` string the
 * JSON envelope already carries, so the text path doesn't introduce new copy.
 */
export function formatFileDownload(result: {
  filePath?: string | null;
}): string {
  const where = result.filePath ?? "(unknown path)";
  return `File downloaded successfully to ${where}\n`;
}

export function formatFileUpload(result: {
  assetUrl?: string | null;
  filename?: string | null;
}): string {
  const url = result.assetUrl ?? "(no URL returned)";
  return `File uploaded successfully: ${url}\n`;
}

export const FILES_META: DomainMeta = {
  name: "files",
  summary: "upload/download file attachments",
  context: [
    "files are binary attachments stored in Linear's storage. upload returns",
    "a URL that can be referenced in issue descriptions or comments.",
  ].join("\n"),
  arguments: {
    url: "Linear storage URL",
    file: "local file path",
  },
  seeAlso: [],
};

export function setupFilesCommands(program: Command): void {
  const files = program
    .command("files")
    .description("Upload and download files from Linear storage.");

  files.action(() => files.help());

  files
    .command("download <url>")
    .description("download a file from Linear storage")
    .option("--output <path>", "output file path")
    .option("--overwrite", "overwrite existing file", false)
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [url, options, command] = args as [
          string,
          CommandOptions & { output?: string; overwrite?: boolean },
          Command,
        ];
        const rootOpts = getRootOpts(command);
        const apiToken = getApiToken(rootOpts);
        const fileService = new FileService(apiToken, getLinearEndpoint());
        const result = await fileService.downloadFile(url, {
          output: options.output,
          overwrite: options.overwrite,
        });

        if (!result.success) {
          throw new Error(result.error || "Download failed");
        }

        outputResult(
          {
            filePath: result.filePath,
            message: `File downloaded successfully to ${result.filePath}`,
          },
          formatFileDownload,
          rootOpts,
        );
      }),
    );

  files
    .command("upload <file>")
    .description("upload a file to Linear storage")
    .action(
      handleCommand(async (...args: unknown[]) => {
        const [filePath, , command] = args as [string, CommandOptions, Command];
        const rootOpts = getRootOpts(command);
        const apiToken = getApiToken(rootOpts);
        const fileService = new FileService(apiToken, getLinearEndpoint());
        const result = await fileService.uploadFile(filePath);

        if (!result.success) {
          throw new Error(result.error || "Upload failed");
        }

        outputResult(
          {
            assetUrl: result.assetUrl,
            filename: result.filename,
            message: `File uploaded successfully: ${result.assetUrl}`,
          },
          formatFileUpload,
          rootOpts,
        );
      }),
    );

  files
    .command("usage")
    .description("show detailed usage for files")
    .action(() => {
      console.log(formatDomainUsage(files, FILES_META));
    });
}
