# pi-extensions

Source repo: https://github.com/theonejb/pi-extensions

A collection of custom [pi](https://github.com/badlogic/pi-mono) extensions.

As more extensions are added, this repo will hold them in one place.

## Install extensions

### Option 1: Global install (recommended)

Installs extensions for all projects.

```bash
git clone https://github.com/theonejb/pi-extensions.git
cd pi-extensions
mkdir -p ~/.pi/agent/extensions

# Copy one extension
cp turn-timer.ts ~/.pi/agent/extensions/turn-timer.ts

# (Optional) Copy all top-level .ts extensions
# cp ./*.ts ~/.pi/agent/extensions/
```

Then in pi:

```text
/reload
```

### Option 2: Project-local install

Installs extensions only for the current project.

```bash
mkdir -p .pi/extensions
cp /path/to/pi-extensions/turn-timer.ts .pi/extensions/turn-timer.ts
```

Then run `/reload` in pi.

## Current extension: `turn-timer.ts`

Measures turn duration from:

- **Start:** timestamp of the last user message
- **End:** `agent_end`

Behavior:

- Shows notification when a turn completes, e.g. `Took 1.2s`
- Adds `/turn-time` command to show the last measured duration

### Quick test

1. Run `/reload`
2. Send any prompt
3. Confirm you see a notification like `Took 842ms`
4. Run `/turn-time`

## Uninstall

Remove the extension file and reload:

```bash
rm ~/.pi/agent/extensions/turn-timer.ts
# or: rm .pi/extensions/turn-timer.ts
```

Then run `/reload`.
