# Maintainer Guide

This repository contains `gnome-clocks-timer@willdo`, a GNOME Shell 50
extension.

## Source layout

- `extension.js`: Shell integration and UI.
- `core.js`: timer state and formatting logic.
- `schemas/`: GSettings schema.
- `dist/`: published ZIP and checksum.

## Rules

- Create Shell objects, signals, and sources in `enable()` and release them in
  `disable()`.
- Keep the timer self-contained; it must not control or synchronize with GNOME
  Clocks.
- Keep `metadata.json` targeted to GNOME Shell 50.
- Do not commit user settings, screenshots, local paths, or generated schema
  caches.

## Checks

```bash
node --check extension.js
glib-compile-schemas --strict --dry-run schemas
```

Build the release package with:

```bash
gnome-extensions pack --force --out-dir dist --extra-source=LICENSE \
  --extra-source=core.js \
  --schema=schemas/org.gnome.shell.extensions.gnome-clocks-timer.gschema.xml \
  .
sha256sum dist/gnome-clocks-timer@willdo.shell-extension.zip > dist/SHA256SUMS
```
