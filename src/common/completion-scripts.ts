/**
 * Shell completion script templates for the `linear` CLI.
 *
 * Commander.js has no built-in completion generator, so these
 * scripts are hand-authored. They follow a call-back model:
 * the shell completion function shells back out to the binary
 * (`linear __complete -- <words...>`) and the hidden `__complete` command
 * (see `src/commands/completions.ts`) emits one candidate per line in the
 * format `value\tdescription` (tab-separated), with the final line being a
 * "directive" sentinel (`:N`) the shell function strips off.
 *
 * Static command/flag completion is handled directly inside the shell
 * functions via the dynamic call-back, so a single mechanism drives both
 * sub-command completion and dynamic issue-ID completion. When
 * `--no-descriptions` is requested, the templates omit the description
 * column from the rendered candidates.
 *
 * PowerShell is intentionally out of scope (macOS/Linux are the priority for
 * agent workflows). The same template approach can vendor it later if needed.
 *
 * Every exported function here is pure (string in / string out) so the
 * templates are trivially unit-testable.
 */

export type CompletionShell = "bash" | "zsh" | "fish";

const SHELLS: readonly CompletionShell[] = ["bash", "zsh", "fish"];

/** Type guard for the supported shells. */
export function isCompletionShell(value: string): value is CompletionShell {
  return (SHELLS as readonly string[]).includes(value);
}

/** The supported shells, in stable order (for help / error text). */
export function completionShells(): readonly CompletionShell[] {
  return SHELLS;
}

/**
 * The binary name the generated scripts register completion for. Kept as a
 * constant (rather than reading argv[0]) so generated output is deterministic
 * and testable; the install docs assume the binary is on PATH as `linear`.
 */
const PROG = "linear";

/**
 * Generate a Bash completion script.
 *
 * A bash completion script: it calls back into the
 * binary via the hidden `__complete` command, splits each line on a tab into
 * value + description, and feeds the values to `COMPREPLY`. Descriptions are
 * only requested (and rendered) when `noDescriptions` is false.
 */
export function bashCompletionScript(noDescriptions: boolean): string {
  const completeCmd = noDescriptions ? "__completeNoDesc" : "__complete";
  return `# bash completion for ${PROG}                                -*- shell-script -*-

__linear_debug() {
    if [[ -n \${BASH_COMP_DEBUG_FILE:-} ]]; then
        echo "$*" >> "\${BASH_COMP_DEBUG_FILE}"
    fi
}

__linear_get_completion_results() {
    local requestComp lastParam lastChar args

    args=("\${COMP_WORDS[@]:1}")
    requestComp="\${COMP_WORDS[0]} ${completeCmd} \${args[*]}"

    lastParam=\${COMP_WORDS[$((\${#COMP_WORDS[@]}-1))]}
    lastChar=\${lastParam:$((\${#lastParam}-1)):1}
    __linear_debug "lastParam: \${lastParam}, lastChar: \${lastChar}"

    if [[ -z \${cur} && \${lastChar} != = ]]; then
        __linear_debug "Adding extra empty parameter"
        requestComp="\${requestComp} ''"
    fi

    __linear_debug "Calling \${requestComp}"
    local out
    out=$(eval "\${requestComp}" 2>/dev/null)

    # Extract the directive integer from the last line.
    local directive
    directive=\${out##*:}
    out=\${out%:*}
    if [[ \${directive} == "\${out}" ]]; then
        directive=0
    fi
    __linear_debug "The completions are: \${out}"
    __linear_debug "The directive is: \${directive}"

    __linear_completions="\${out}"
    __linear_directive="\${directive}"
}

__linear_process_completion_results() {
    local shellCompDirectiveNoSpace=2
    local shellCompDirectiveNoFileComp=4

    local directive=\${__linear_directive}
    local out=\${__linear_completions}

    if (((directive & shellCompDirectiveNoSpace) != 0)); then
        __linear_debug "Activating no space"
        if [[ $(type -t compopt) == builtin ]]; then
            compopt -o nospace
        fi
    fi
    if (((directive & shellCompDirectiveNoFileComp) != 0)); then
        __linear_debug "Activating no file completion"
        if [[ $(type -t compopt) == builtin ]]; then
            compopt +o default
        fi
    fi

    local completions=()
    local descriptions=()
    local tab=$'\\t'
    while IFS='' read -r line; do
        [[ -z \${line} ]] && continue
        local comp="\${line%%\${tab}*}"
        completions+=("\${comp}")
    done < <(printf "%s\\n" "\${out}")

    local IFS=$'\\n'
    COMPREPLY=($(compgen -W "\${completions[*]}" -- "\${cur}"))
}

__start_linear() {
    local cur prev words cword split

    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"

    local __linear_completions=""
    local __linear_directive=0

    __linear_get_completion_results
    __linear_process_completion_results
}

if [[ $(type -t compopt) = "builtin" ]]; then
    complete -o default -F __start_linear ${PROG}
else
    complete -o default -o nospace -F __start_linear ${PROG}
fi

# ex: ts=4 sw=4 et filetype=sh
`;
}

/**
 * Generate a Zsh completion script.
 *
 * A zsh completion script: a `#compdef` autoload stub that
 * shells back into the binary via `__complete`, parses `value\tdescription`
 * lines, and feeds them to `_describe`. With `noDescriptions` the description
 * column is dropped and `compadd` is used directly.
 */
export function zshCompletionScript(noDescriptions: boolean): string {
  const completeCmd = noDescriptions ? "__completeNoDesc" : "__complete";
  const describeBlock = noDescriptions
    ? `        local -a values
        for line in \${completions[@]}; do
            values+=("\${line%%\${tab}*}")
        done
        compadd -- \${values[@]}`
    : `        _describe "completions" completions`;
  return `#compdef ${PROG}
compdef _linear ${PROG}

# zsh completion for ${PROG}                                  -*- shell-script -*-

__linear_debug() {
    local file="\${BASH_COMP_DEBUG_FILE:-}"
    if [[ -n \${file} ]]; then
        echo "$*" >> "\${file}"
    fi
}

_linear() {
    local shellCompDirectiveNoSpace=2
    local shellCompDirectiveNoFileComp=4

    local lastParam lastChar flagPrefix requestComp out directive
    local -a completions
    local tab=$'\\t'

    __linear_debug "\\n========= starting completion logic =========="

    local words=("\${words[@]:1}")
    requestComp="\${words[1]} ${completeCmd} \${words[2,-1]}"

    lastParam=\${words[-1]}
    lastChar=\${lastParam[-1]}

    if [ -z "\${lastParam}" ]; then
        requestComp="\${requestComp} \\"\\""
    fi

    __linear_debug "Calling \${requestComp}"
    eval out="$(\${requestComp} 2>/dev/null)"

    directive=\${out[(w)-1]##*:}
    if [ "\${directive}" = "\${out[(w)-1]}" ]; then
        directive=0
    fi
    __linear_debug "directive: \${directive}"

    while IFS='\\n' read -r comp; do
        if [ -n "$comp" ]; then
            comp=\${comp//:/\\\\:}
            local tab="$(printf '\\t')"
            comp=\${comp//$tab/:}
            __linear_debug "Adding completion: \${comp}"
            completions+=\${comp}
        fi
    done < <(printf "%s\\n" "\${out[@]}")

    if [ $((directive & shellCompDirectiveNoSpace)) -ne 0 ]; then
        __linear_debug "Activating nospace."
        noSpace="-S ''"
    fi

    if [ $((directive & shellCompDirectiveNoFileComp)) -ne 0 ]; then
        __linear_debug "deactivating file completion"
    fi

    if [ \${#completions[@]} -ne 0 ]; then
${describeBlock}
    fi
}

if [ "$funcstack[1]" = "_linear" ]; then
    _linear
fi

# ex: ts=4 sw=4 et filetype=sh
`;
}

/**
 * Generate a Fish completion script.
 *
 * A fish completion script: a helper that shells back into
 * the binary via `__complete`, splits each line on a tab into value +
 * description, and registers them with `complete`. With `noDescriptions` the
 * description column is omitted.
 */
export function fishCompletionScript(noDescriptions: boolean): string {
  const completeCmd = noDescriptions ? "__completeNoDesc" : "__complete";
  const descArg = noDescriptions ? "" : ' -d "$description"';
  return `# fish completion for ${PROG}                                 -*- shell-script -*-

function __linear_debug
    set -l file "$BASH_COMP_DEBUG_FILE"
    if test -n "$file"
        echo "$argv" >> $file
    end
end

function __linear_perform_completion
    __linear_debug "Starting __linear_perform_completion"

    set -l args (commandline -opc)
    set -l lastArg (commandline -ct)

    __linear_debug "args: $args"
    __linear_debug "last arg: $lastArg"

    set -l requestComp "$args[1] ${completeCmd} $args[2..-1] $lastArg"

    __linear_debug "Calling $requestComp"
    set -l results (eval $requestComp 2> /dev/null)

    # Some directive lines end with a :N directive sentinel; strip it.
    set -l comps $results[1..-2]
    set -l directiveLine $results[-1]

    if test (count $results) -eq 0
        set comps
        set directiveLine ""
    end

    for comp in $comps
        printf "%s\\n" $comp
    end

    printf "%s\\n" "$directiveLine"
end

function __linear_prepare_completions
    set -e __linear_comp_results

    set -l results (__linear_perform_completion)
    __linear_debug "Completion results: $results"

    if test -z "$results"
        __linear_debug "No completion, probably due to a failure"
        return 1
    end

    set -l directive (string sub --start 2 $results[-1])
    set --global __linear_comp_results $results[1..-2]

    __linear_debug "Completions are: $__linear_comp_results"
    __linear_debug "Directive is: $directive"

    if test -z "$directive"
        set directive 0
    end

    set -l compErr (math (math --scale 0 $directive / 1) % 2)
    if test $compErr -eq 1
        __linear_debug "Some completions have errors. Disabling."
        return 1
    end

    return 0
end

complete -c ${PROG} -e
complete -c ${PROG} -n 'true' -f -a '(
    set -l comps (__linear_prepare_completions; and string split \\t -- $__linear_comp_results)
    for c in $comps
        echo $c
    end
)'${descArg}

# ex: ts=4 sw=4 et filetype=sh
`;
}

/**
 * Dispatch to the per-shell template. Pure function: `(shell, flag) -> script`.
 */
export function generateCompletionScript(
  shell: CompletionShell,
  noDescriptions = false,
): string {
  switch (shell) {
    case "bash":
      return bashCompletionScript(noDescriptions);
    case "zsh":
      return zshCompletionScript(noDescriptions);
    case "fish":
      return fishCompletionScript(noDescriptions);
  }
}
