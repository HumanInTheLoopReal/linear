#!/usr/bin/env bash
#
# Linear CLI installation script
# Usage: curl -fsSL https://raw.githubusercontent.com/HumanInTheLoopReal/linear/main/install.sh | bash
#
# IMPORTANT: This script must be EXECUTED, never SOURCED
#   WRONG:   source install.sh   (will exit your shell on errors)
#   CORRECT: bash install.sh
#   CORRECT: curl -fsSL ... | bash
#
# Environment variable overrides:
#   LINEAR_INSTALL_SOURCE=registry           - install channel (npm registry
#                                              is the only one today)
#   LINEAR_INSTALL_VERSION=<semver>          - pin to a specific release
#   LINEAR_INSTALL_PREFIX=<dir>              - override npm prefix
#   LINEAR_INSTALL_SKIP_NODE_CHECK=1         - skip Node version check
#                                              (nvm/asdf users who manage
#                                              Node themselves)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
GITHUB_REPO="HumanInTheLoopReal/linear"
NPM_PACKAGE="@humanintheloop/linear"
REQUIRED_NODE_MAJOR=22

# Resolved at runtime — recorded for PATH-precedence warnings.
LAST_INSTALL_PATH=""

log_info() {
    echo -e "${BLUE}==>${NC} $1" >&2
}

log_success() {
    echo -e "${GREEN}==>${NC} $1" >&2
}

log_warning() {
    echo -e "${YELLOW}==>${NC} $1" >&2
}

log_error() {
    echo -e "${RED}Error:${NC} $1" >&2
}

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------

detect_platform() {
    # Reject Windows shells that masquerade as POSIX — point at install.ps1.
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*)
            log_error "Windows detected ($(uname -s))."
            echo "" >&2
            echo "  This bash installer is for macOS/Linux/FreeBSD." >&2
            echo "  On Windows, use the PowerShell installer:" >&2
            echo "" >&2
            echo "    irm https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.ps1 | iex" >&2
            echo "" >&2
            exit 1
            ;;
    esac

    # Detect WSL (Windows Subsystem for Linux). WSL reports uname -s as Linux
    # but installs into the Linux filesystem, which native Windows shells
    # cannot reach. Warn with a 5-second cancel window in interactive mode.
    if [ -f /proc/version ] && grep -qi 'microsoft\|wsl' /proc/version 2>/dev/null; then
        log_warning "WSL (Windows Subsystem for Linux) detected."
        echo "" >&2
        echo "  This will install the Linux version of linear, usable only inside WSL." >&2
        echo "  If you want linear available in native Windows (PowerShell, cmd), use:" >&2
        echo "" >&2
        echo "    irm https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.ps1 | iex" >&2
        echo "" >&2
        if [ -t 0 ]; then
            echo "  Continuing with Linux install for WSL in 5 seconds... (Ctrl+C to cancel)" >&2
            sleep 5
        else
            echo "  Continuing with Linux install (non-interactive mode)..." >&2
        fi
    fi

    local os
    case "$(uname -s)" in
        Darwin)  os="darwin" ;;
        Linux)   os="linux" ;;
        FreeBSD) os="freebsd" ;;
        *)
            log_error "Unsupported operating system: $(uname -s)"
            exit 1
            ;;
    esac

    local arch
    case "$(uname -m)" in
        x86_64|amd64)         arch="amd64" ;;
        aarch64|arm64)        arch="arm64" ;;
        armv7*|armv6*|armhf|arm) arch="arm" ;;
        *)
            log_error "Unsupported architecture: $(uname -m)"
            exit 1
            ;;
    esac

    echo "${os}_${arch}"
}

# ---------------------------------------------------------------------------
# Node check
# ---------------------------------------------------------------------------

print_node_install_help() {
    local system
    system=$(uname -s)

    echo "" >&2
    echo "  Linear CLI requires Node.js >= ${REQUIRED_NODE_MAJOR}." >&2
    echo "  Install Node, then re-run this installer:" >&2
    echo "" >&2

    case "$system" in
        Darwin)
            echo "    macOS:" >&2
            echo "      brew install node" >&2
            echo "      # or: download from https://nodejs.org/" >&2
            ;;
        Linux)
            echo "    Linux:" >&2
            echo "      Debian/Ubuntu: sudo apt-get install -y nodejs npm" >&2
            echo "      Fedora/RHEL:   sudo dnf install -y nodejs npm" >&2
            echo "      Arch:          sudo pacman -S nodejs npm" >&2
            echo "      # or: use nvm/asdf — see https://nodejs.org/" >&2
            ;;
        FreeBSD)
            echo "    FreeBSD:" >&2
            echo "      pkg install -y node npm" >&2
            ;;
        *)
            echo "    https://nodejs.org/" >&2
            ;;
    esac

    echo "" >&2
    echo "  If you manage Node via nvm/asdf and the check is mis-firing," >&2
    echo "  re-run with LINEAR_INSTALL_SKIP_NODE_CHECK=1." >&2
    echo "" >&2
}

check_node() {
    if [ "${LINEAR_INSTALL_SKIP_NODE_CHECK:-0}" = "1" ]; then
        log_warning "LINEAR_INSTALL_SKIP_NODE_CHECK=1 set — skipping Node version check"
        return 0
    fi

    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.js not found on PATH."
        print_node_install_help
        return 1
    fi

    local raw_version
    raw_version=$(node --version 2>/dev/null || true)
    if [ -z "$raw_version" ]; then
        log_error "Could not parse 'node --version' output."
        print_node_install_help
        return 1
    fi

    # node --version emits e.g. "v22.5.1". Strip leading v, split on dot.
    local version="${raw_version#v}"
    local major="${version%%.*}"

    if ! [ "$major" -ge 0 ] 2>/dev/null; then
        log_error "Could not parse Node major version from '$raw_version'."
        print_node_install_help
        return 1
    fi

    if [ "$major" -lt "$REQUIRED_NODE_MAJOR" ]; then
        log_error "Node.js >= ${REQUIRED_NODE_MAJOR} required (found: ${raw_version})."
        print_node_install_help
        return 1
    fi

    log_info "Node detected: ${raw_version}"
    return 0
}

check_npm() {
    if ! command -v npm >/dev/null 2>&1; then
        log_error "npm not found on PATH (should ship alongside Node.js)."
        echo "" >&2
        echo "  Reinstall Node.js from https://nodejs.org/ — npm is bundled." >&2
        echo "" >&2
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Install paths
# ---------------------------------------------------------------------------

# Resolve the directory npm will drop the global bin into. Honours
# LINEAR_INSTALL_PREFIX when set; otherwise asks npm.
resolve_npm_bin_dir() {
    if [ -n "${LINEAR_INSTALL_PREFIX:-}" ]; then
        echo "${LINEAR_INSTALL_PREFIX}/bin"
        return 0
    fi

    local prefix
    prefix=$(npm config get prefix 2>/dev/null || true)
    if [ -z "$prefix" ] || [ "$prefix" = "undefined" ]; then
        # Last-ditch fallback — npm's traditional default on POSIX.
        prefix="/usr/local"
    fi
    echo "${prefix}/bin"
}

# Build the npm prefix flag set used by both install paths.
npm_prefix_args() {
    if [ -n "${LINEAR_INSTALL_PREFIX:-}" ]; then
        printf '%s\n' "--prefix=${LINEAR_INSTALL_PREFIX}"
    fi
}

warn_if_bin_dir_not_on_path() {
    local bin_dir=$1
    if [[ ":$PATH:" != *":$bin_dir:"* ]]; then
        log_warning "$bin_dir is not in your PATH"
        echo "" >&2
        echo "  Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):" >&2
        echo "    export PATH=\"\$PATH:$bin_dir\"" >&2
        echo "" >&2
        echo "  Then restart your shell." >&2
        echo "" >&2
    fi
}

# Returns list of full paths to 'linear' found on PATH, earliest first.
# Bash 3.2 compatible — does not use mapfile.
get_linear_paths_in_path() {
    local IFS=':'
    # shellcheck disable=SC2206
    local entries=( $PATH )
    local -a found
    local p
    for p in "${entries[@]}"; do
        [ -z "$p" ] && continue
        if [ -x "$p/linear" ]; then
            local resolved
            if command -v readlink >/dev/null 2>&1; then
                resolved=$(readlink -f "$p/linear" 2>/dev/null || printf '%s' "$p/linear")
            else
                resolved="$p/linear"
            fi
            local skip=0
            local existing
            for existing in "${found[@]:-}"; do
                if [ "$existing" = "$resolved" ]; then
                    skip=1
                    break
                fi
            done
            if [ "$skip" -eq 0 ]; then
                found+=("$resolved")
            fi
        fi
    done

    local item
    for item in "${found[@]:-}"; do
        printf '%s\n' "$item"
    done
}

warn_if_multiple_linear() {
    local linear_paths=()
    while IFS= read -r line; do
        linear_paths+=("$line")
    done < <(get_linear_paths_in_path)

    if [ "${#linear_paths[@]}" -le 1 ]; then
        return 0
    fi

    log_warning "Multiple 'linear' executables found on your PATH. An older copy may shadow the one we just installed."
    echo "Found the following 'linear' executables (entries earlier in PATH take precedence):" >&2
    local i=1
    local p
    for p in "${linear_paths[@]}"; do
        local ver
        if [ -x "$p" ]; then
            ver=$("$p" --version 2>/dev/null || true)
        fi
        if [ -z "$ver" ]; then ver="<unknown version>"; fi
        echo "  $i. $p  -> $ver" >&2
        i=$((i+1))
    done

    if [ -n "$LAST_INSTALL_PATH" ]; then
        echo "" >&2
        echo "We installed to: $LAST_INSTALL_PATH" >&2
        local first="${linear_paths[0]}"
        if [ "$first" != "$LAST_INSTALL_PATH" ]; then
            log_warning "The 'linear' executable that appears first in your PATH is different from the one we installed. To make the newly installed 'linear' the one you get when running 'linear', either:"
            echo "  - Remove or rename the older $first from your PATH, or" >&2
            echo "  - Reorder your PATH so that $(dirname "$LAST_INSTALL_PATH") appears before $(dirname "$first")" >&2
            echo "After updating PATH, restart your shell and run 'linear --version' to confirm." >&2
        else
            echo "The installed 'linear' is first in your PATH." >&2
        fi
    fi
}

# ---------------------------------------------------------------------------
# Channel: npm registry
# ---------------------------------------------------------------------------

install_from_registry() {
    log_info "Installing ${NPM_PACKAGE} from the npm registry..."

    local version="${LINEAR_INSTALL_VERSION:-latest}"
    local spec="${NPM_PACKAGE}@${version}"

    local extra_args=()
    local prefix_flag
    prefix_flag=$(npm_prefix_args)
    if [ -n "$prefix_flag" ]; then
        extra_args+=("$prefix_flag")
    fi

    # --foreground-scripts=false matches the spec: keep install non-interactive
    # and avoid spawning packages' lifecycle scripts in our foreground.
    if ! npm install -g "${extra_args[@]}" --foreground-scripts=false "$spec"; then
        log_error "npm install of $spec failed."
        return 1
    fi

    local bin_dir
    bin_dir=$(resolve_npm_bin_dir)
    LAST_INSTALL_PATH="${bin_dir}/linear"

    log_success "${NPM_PACKAGE} installed to ${LAST_INSTALL_PATH}"
    warn_if_bin_dir_not_on_path "$bin_dir"
    return 0
}

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------

verify_installation() {
    warn_if_multiple_linear || true

    if ! command -v linear >/dev/null 2>&1; then
        log_error "'linear' was installed but is not on PATH"
        if [ -n "$LAST_INSTALL_PATH" ]; then
            echo "" >&2
            echo "  Add the install dir to PATH:" >&2
            echo "    export PATH=\"\$PATH:$(dirname "$LAST_INSTALL_PATH")\"" >&2
            echo "" >&2
        fi
        return 1
    fi

    local version_output
    if ! version_output=$(linear --version 2>&1); then
        log_error "'linear --version' exited non-zero"
        echo "$version_output" >&2
        return 1
    fi

    log_success "linear is installed: ${version_output}"
    return 0
}

# ---------------------------------------------------------------------------
# Plugin marketplace pointer
# ---------------------------------------------------------------------------

print_plugin_marketplace_pointer() {
    # If the user ran us from a cloned linear-cli repo, the local-dev
    # marketplace file already exists and we don't need to nudge them
    # toward the remote add command.
    if [ -d "${PWD}/.claude-plugin" ]; then
        return 0
    fi

    echo "" >&2
    echo "Using Claude Code? Register the Linear plugin marketplace:" >&2
    echo "" >&2
    echo "  /plugin marketplace add ${GITHUB_REPO}" >&2
    echo "" >&2
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    echo "" >&2
    echo "Linear CLI installer" >&2
    echo "" >&2

    log_info "Detecting platform..."
    local platform
    platform=$(detect_platform)
    log_info "Platform: $platform"

    if ! check_node; then
        exit 1
    fi
    if ! check_npm; then
        exit 1
    fi

    local source="${LINEAR_INSTALL_SOURCE:-registry}"
    case "$source" in
        registry)
            if ! install_from_registry; then
                exit 1
            fi
            ;;
        *)
            log_error "Unknown LINEAR_INSTALL_SOURCE: '$source' (expected 'registry')"
            exit 1
            ;;
    esac

    if ! verify_installation; then
        exit 1
    fi

    print_plugin_marketplace_pointer

    echo "" >&2
    log_success "Installation complete."
    echo "" >&2
    echo "Next steps:" >&2
    echo "  linear auth login    # one-time interactive auth" >&2
    echo "  linear --help        # full command reference" >&2
    echo "" >&2
}

main "$@"
