# OctoPrint-Layer1

OctoPrint plugin that serves Layer1, a full-screen touch UI built for a 480x320 screen
on the Raspberry Pi. See `../README.md` for setup.

UI:      http://<octopi>/plugin/layer1/
Config:  ~/.octoprint/data/layer1/config.json  (created on first load)
History: ~/.octoprint/data/layer1/history.json (prints that ended; seeded once from OctoPrint's
         per-file print logs, served at /plugin/layer1/history)
Demo:    serve `octoprint_layer1/static/` with any web server and open `index.html?demo`

Look:    Geist + Geist Mono fonts and Lucide icons, all bundled (the Pi needs no internet).
Icons:   `node tools/build-icons.mjs` regenerates `static/js/icons.js` from a pinned Lucide
         version. To add one, put `ourName: 'lucide-name'` in that script's ICONS list.
Licences: Geist is SIL OFL 1.1 (`static/fonts/LICENSE-geist.txt`), Lucide is ISC
         (`static/js/icons.LICENSE.txt`).
