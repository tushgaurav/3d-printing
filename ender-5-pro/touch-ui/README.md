# OctoPrint-Ender5Touch

OctoPrint plugin that serves a full-screen touch UI built for a 480x320 screen
on the Raspberry Pi. See `../README.md` for setup.

UI:      http://<octopi>/plugin/ender5touch/
Config:  ~/.octoprint/data/ender5touch/config.json  (created on first load)
Demo:    serve `octoprint_ender5touch/static/` with any web server and open `index.html?demo`

Look:    Geist + Geist Mono fonts and Lucide icons, all bundled (the Pi needs no internet).
Icons:   `node tools/build-icons.mjs` regenerates `static/js/icons.js` from a pinned Lucide
         version. To add one, put `ourName: 'lucide-name'` in that script's ICONS list.
Licences: Geist is SIL OFL 1.1 (`static/fonts/LICENSE-geist.txt`), Lucide is ISC
         (`static/js/icons.LICENSE.txt`).
