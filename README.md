<p align="center">
  <img src="docs/layer1-logo.svg" alt="Layer1" width="200">
</p>

<h3 align="center">Layer1</h3>
<p align="center">A Bambu-style touchscreen UI for the Ender 5 Pro</p>

<p align="center">
  <img src="docs/image.png" alt="Layer1 home screen — printing" width="480">
</p>

---

Layer1 is a full-screen touch interface that runs on a 3.5" Raspberry Pi screen
through OctoPrint. It turns a bare Ender 5 Pro into something that feels like a
modern printer with a built-in display.

<p align="center">
  <img src="docs/screen-files.jpg" width="235">&nbsp;
  <img src="docs/screen-heat.jpg" width="235">
</p>
<p align="center">
  <img src="docs/screen-move.jpg" width="235">&nbsp;
  <img src="docs/screen-more.jpg" width="235">
</p>

## Features

- **Live camera** with tap-to-fullscreen and a 3D G-code viewer
- **Print progress** with layer gauge, time remaining, and ETA
- **Temperature control** with quick presets (PLA, PETG, TPU, ABS) and a keypad
- **Temperature graphs** — a 10-minute sparkline on each heater; tap it for nozzle and bed over 5, 10 or 30 minutes, and drag to read any moment
- **File browser** with slicer thumbnails, folders, sort options, and grid/list view
- **Jog controls** for XY, Z (bed), and extruder with configurable steps
- **Filament management** — load, unload, and purge with Bowden-length support
- **Tune while printing** — speed modes, flow rate, and part fan
- **Print history** — every print that finished, failed, or was stopped, with totals and Print Again (earlier prints are imported from OctoPrint)
- **Lock screen** — shows the print big from across the room; hold to unlock, with optional auto-lock after 1, 5, or 15 minutes
- **Print finished card** — a camera photo of the part, time taken vs. the estimate, filament used, bed cool-down, and Print Again
- **Screen sleep** — goes dark after 2–30 minutes without a touch; a tap wakes it, and so does a print finishing, failing, or pausing
- **Network page** — tap the Wi-Fi icon for Wi-Fi (name, signal bars) or Ethernet (link speed) details and the IP, plus QR codes that open OctoPrint and Layer1 on your phone
- **Dark and light themes** optimized for small SPI panels
- **Fully offline** — fonts, icons, and assets are all bundled

## How it works

```
Raspberry Pi (OctoPi)
├── 3.5" SPI screen ← X11 (no desktop) ← Chromium kiosk
│                       └── http://127.0.0.1/plugin/layer1/
├── OctoPrint + Layer1 plugin (serves the touch UI)
│     └── REST API + push socket, authenticated via app key
└── USB → Ender 5 Pro
```

The plugin only serves static files — every printer action goes through
OctoPrint's normal API, so permissions, safety checks, and your existing
plugins all still apply.

## Quick start

**Try it on your PC** (no printer needed):

```bash
cd ender-5-pro/touch-ui/octoprint_layer1/static
python -m http.server 8765
# Open http://localhost:8765/index.html?demo=printing
```

**Install on the Pi** — see the full setup guide:
[ender-5-pro/README.md](ender-5-pro/README.md)

## Project structure

```
ender-5-pro/
├── touch-ui/          OctoPrint plugin that serves the web app
├── pi-setup/          Shell scripts: screen driver, kiosk service, diagnostics
├── deploy.ps1         Deploy from Windows to the Pi over SSH
└── docs/              Screen setup guides and screenshots
```

## License

Layer1 is licensed under the [GNU Affero General Public License v3.0](LICENSE) or later,
the same license as OctoPrint.

Geist fonts: [SIL OFL 1.1](ender-5-pro/touch-ui/octoprint_layer1/static/fonts/LICENSE-geist.txt) · Lucide icons: [ISC](ender-5-pro/touch-ui/octoprint_layer1/static/js/icons.LICENSE.txt)
