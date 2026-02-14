# Turn Timer (pi extension)

Source repo: https://github.com/theonejb/pi-extensions

A small pi extension that measures how long a turn took:

- Start: timestamp of the **last user message**
- End: when the agent emits `agent_end`
- Output: notification like **`Took 1.2s`**

It also adds a command:

- `/turn-time` → shows the most recent measured duration

## Install

### Option 1: Global install (recommended)

Clone the repo and copy the extension to pi's global extensions directory:

```bash
git clone https://github.com/theonejb/pi-extensions.git
cd pi-extensions
mkdir -p ~/.pi/agent/extensions
cp turn-timer.ts ~/.pi/agent/extensions/turn-timer.ts
```

Then in pi, run:

```text
/reload
```

### Option 2: Project-local install

From your project root:

```bash
mkdir -p .pi/extensions
cp /path/to/turn-timer.ts .pi/extensions/turn-timer.ts
```

Then run `/reload` in pi.

## Verify

1. Send any prompt in pi.
2. When the turn completes, you should see a notification like:
   - `Took 842ms`
   - `Took 3.4s`
3. Run `/turn-time` to see the last measured value.

## Uninstall

Remove the file and reload:

```bash
rm ~/.pi/agent/extensions/turn-timer.ts
# or: rm .pi/extensions/turn-timer.ts
```

Then run `/reload`.
