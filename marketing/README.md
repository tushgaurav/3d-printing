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

## Refreshing the screenshots

The screenshots come from the touch UI's own demo mode
(`ender-5-pro/touch-ui/octoprint_layer1/static/index.html?demo=printing&page=…`),
rendered at 480x320 with a device scale factor of 3. The Move screen uses the idle
demo (`?demo&page=move`), because while printing it is greyed out and locked.

## Tuning the hero

The printer photo's hotend position and the floating screen are set with CSS
variables on `.hero__printer` in `globals.css` (`--printer-ar`, `--pin-x`, `--pin-y`,
`--screen-right`, `--screen-top`, `--screen-w`). Change those if you swap the photo.
