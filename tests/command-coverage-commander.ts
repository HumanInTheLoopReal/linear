import { Command, type ParseOptions } from "commander";
import { recordCliInvocation } from "./command-coverage-recorder.js";

const RECORDER_STATE = Symbol.for("linear.commandCoverageRecorder");

interface RecorderState {
  originalParse: Command["parse"];
  originalParseAsync: Command["parseAsync"];
}

/** Instrument Commander parses and return a function that restores the prototype. */
export function installCommanderCoverageRecorder(): () => void {
  const prototype = Command.prototype as Command & {
    [RECORDER_STATE]?: RecorderState;
  };
  if (prototype[RECORDER_STATE]) return () => {};

  const originalParse = prototype.parse;
  const originalParseAsync = prototype.parseAsync;
  prototype[RECORDER_STATE] = { originalParse, originalParseAsync };

  prototype.parse = function parseWithCommandCoverage(
    this: Command,
    argv?: readonly string[],
    parseOptions?: ParseOptions,
  ): Command {
    const parsed = originalParse.call(this, argv, parseOptions);
    recordCliInvocation(argv ?? process.argv);
    return parsed;
  };

  prototype.parseAsync = async function parseAsyncWithCommandCoverage(
    this: Command,
    argv?: readonly string[],
    parseOptions?: ParseOptions,
  ): Promise<Command> {
    const parsed = await originalParseAsync.call(this, argv, parseOptions);
    recordCliInvocation(argv ?? process.argv);
    return parsed;
  };

  return () => {
    if (prototype[RECORDER_STATE]?.originalParse !== originalParse) return;
    prototype.parse = originalParse;
    prototype.parseAsync = originalParseAsync;
    delete prototype[RECORDER_STATE];
  };
}
