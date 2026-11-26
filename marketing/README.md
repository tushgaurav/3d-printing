# Layer1 marketing site

A one-page Next.js site for Layer1, the touchscreen UI for the Ender 5 Pro.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static export of the single page
```

## Where things are

```
src/app/layout.tsx       fonts (Archivo for display, Geist for text) and metadata
src/app/globals.css      every style, top to bottom in page order, tokens on :root
src/components/          Hero, Bento, Screens (tabbed rail), Install, Footer
src/assets/printer.png   the hero printer, cut out on transparent
src/assets/screens/      UI screenshots at 3x (1440x960) from the app's demo mode
src/lib/links.ts         GitHub and setup-guide links
src/lib/credits.ts       photo credit shown in the footer
```

## The live demo

On screens wider than 760px, the Screens section runs the real touch UI in an iframe
against its simulated printer (`/demo/index.html?demo=printing`). `npm run dev` and
`npm run build` first run `scripts/copy-demo.mjs`, which copies
`ender-5-pro/touch-ui/octoprint_layer1/static/` into `public/demo/` (gitignored), so
build from the full repo, not just this folder.

The iframe is always exactly 480x320 (at any other size the UI switches to its own
desktop preview) and is scaled up with a CSS transform. The tabs beside it click the
UI's own rail buttons, and watch them, so both stay in step. Phones get the
screenshots below instead.

## Refreshing the screenshots

The screenshots come from the touch UI's own demo mode
(`ender-5-pro/touch-ui/octoprint_layer1/static/index.html?demo=printing&page=…`),
rendered at 480x320 with a device scale factor of 3. The Move screen uses the idle
demo (`?demo&page=move`), because while printing it is greyed out and locked.

## Tuning the hero

The printer photo's hotend position and the floating screen are set with CSS
variables on `.hero__printer` in `globals.css` (`--printer-ar`, `--pin-x`, `--pin-y`,
`--screen-right`, `--screen-top`, `--screen-w`). Change those if you swap the photo.
