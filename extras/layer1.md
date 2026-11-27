---
# Draft listing for the OctoPrint Plugin Repository.
# Submit it as _plugins/layer1.md in a fork of github.com/OctoPrint/plugins.octoprint.org,
# with the screenshots below copied to assets/img/plugins/layer1/ in that fork.
# Rules: https://plugins.octoprint.org/help/registering/
layout: plugin

id: layer1
title: Layer1
description: A full-screen touch interface for a 3.5" (480x320) Raspberry Pi screen, built for the Ender 5 Pro.
authors:
- Tushar Gaurav
license: AGPLv3

date: 2026-11-26

homepage: https://layer1.nodebench.com
source: https://github.com/tushgaurav/layer1
archive: https://github.com/tushgaurav/layer1/archive/main.zip

tags:
- touchscreen
- kiosk
- ui
- ender
- creality
- raspberry pi

# Copy from marketing/src/assets/screens/ (1440x960 PNGs of the 480x320 UI at 3x).
screenshots:
- url: /assets/img/plugins/layer1/home.png
  alt: Layer1 home screen while printing
  caption: Home while printing. Live camera or 3D G-code view, layer gauge, time left, Pause, Tune and Stop.
- url: /assets/img/plugins/layer1/files.png
  alt: Layer1 files screen
  caption: Files, with slicer thumbnails, folders and sorting.
- url: /assets/img/plugins/layer1/heat.png
  alt: Layer1 temperature screen
  caption: Nozzle and bed, with PLA, PETG, TPU and ABS presets.
- url: /assets/img/plugins/layer1/move.png
  alt: Layer1 move screen
  caption: Jog X, Y and Z, extrude and retract.

featuredimage: /assets/img/plugins/layer1/home.png

compatibility:
  # Tested on OctoPrint 2.0.2. Widen this once you've checked older versions (e.g. 1.11).
  octoprint:
  - ">=2.0.0"
  os:
  - linux
  python: ">=3.9,<4"

attributes:
 - ai-developed

---

Layer1 turns the small 3.5" SPI touchscreen on an OctoPi Raspberry Pi into a full printer
display, in the style of the built-in screens on newer printers. It runs full-screen in a
Chromium kiosk on the Pi and talks to OctoPrint through its normal API, so permissions,
safety checks and your other plugins all still apply.

It was built for the Creality Ender 5 Pro, and works with any printer OctoPrint can drive.

## Features

- **Home**: live camera, or a 3D view drawn from the G-code, with a layer gauge, time left,
  finish time, and Pause, Tune and Stop.
- **Files**: OctoPrint's library with slicer thumbnails, folders, sorting, and list or grid view.
- **Heat**: nozzle and bed, ±5° steps, a keypad for exact targets, and material presets.
- **Move**: XY pad, bed up and down, configurable steps, extrude and retract. Locked while printing.
- **More**: filament load, unload and purge; speed, flow and fan tuning; camera, connection,
  system and display settings.
- **Network**: Wi-Fi or Ethernet details, the IP address, and QR codes that open OctoPrint and
  Layer1 on your phone.
- Dark and light themes, and fully offline: fonts, icons and assets are bundled.

## Setup

The plugin serves the touch UI at `/plugin/layer1/`. Getting it onto the small screen needs
the screen driver and the kiosk service from the repository's `pi-setup` scripts. See the
[setup guide](https://github.com/tushgaurav/layer1/blob/main/docs/setup.md).

Slicer thumbnails come from the
[PrusaSlicer Thumbnails](https://plugins.octoprint.org/plugins/prusaslicerthumbnails/) plugin.
