# Notification Center Timer

GNOME Shell extension that adds a self-contained timer workflow to the date menu.
The timer state lives entirely in GNOME Shell and does not sync with GNOME
Clocks.

## Behavior

- Adds a collapsed timer card with configurable quick-start buttons and a
  settings button at the far right of the notification column.
- Normal mode starts up to three user-configured durations, defaulting to 5,
  15, and 30 minutes.
- Pomodoro mode includes Classic, Short Focus, Medium Focus, Extended Focus,
  Deep Work, and Custom presets. Custom mode accepts a name plus focus and
  break durations.
- Pomodoro mode automatically transitions from focus to break and notifies the
  user when each phase completes.
- Places the timer card under media controls and above regular notifications.
- Shows a compact countdown beside the top-bar clock while the date menu is
  closed.
- Keeps pause, resume, reset, preset selection, and settings inside the
  notification center.
- Saves the selected mode and durations through GNOME Settings so they survive
  extension reloads.

GNOME Clocks is intentionally not opened or controlled by this extension.

## GNOME Clocks Boundary

GNOME Clocks 50 does not expose running/paused timer state, remaining time,
start time, or timer controls through its D-Bus interfaces. To avoid confusing
split state, this extension does not read or write GNOME Clocks timers.

## Install

For development, symlink the extension directory:

```bash
ln -sfnT "$(pwd)/clocks/gnome-clocks-timer@willdo" \
  ~/.local/share/gnome-shell/extensions/gnome-clocks-timer@willdo
```

Restart GNOME Shell, then enable it:

```bash
gnome-extensions enable gnome-clocks-timer@willdo
```

For a release bundle, run this from the repository root:

```bash
gnome-extensions pack --force --out-dir dist --extra-source=LICENSE \
  --extra-source=core.js \
  --schema=schemas/org.gnome.shell.extensions.gnome-clocks-timer.gschema.xml \
  .
```

## Test

```bash
gjs -m clocks/gnome-clocks-timer@willdo/tests/core.test.js
```
