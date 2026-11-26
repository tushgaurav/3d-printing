# 3.5" SPI screen setup

The common 3.5" 480×320 Pi screens (Waveshare "3.5inch RPi LCD (A)" and its many
clones, often sold as "MPI3501" or "LCD35") use an **ILI9486** display controller
and an **XPT2046/ADS7846** resistive touch controller, both on the Pi's SPI bus.
They plug onto the 40-pin header; the screen covers pins 1–26.

The kiosk only needs one thing from the driver: a framebuffer device (`/dev/fb1`
usually) that draws on the small screen, plus a touch input device. There are two
ways to get that.

## Option A — built-in `piscreen` driver (try this first)

No downloads; the overlay ships with the Pi kernel. With `drm` it uses the modern
ILI9486 DRM driver, and HDMI keeps working.

```bash
sudo bash ~/ender5-touch/pi-setup/setup-screen.sh piscreen      # adds the lines below
sudo reboot
```

It adds this to `config.txt` (`/boot/firmware/config.txt` on Bookworm, `/boot/config.txt` on Bullseye):

```ini
# >>> ender5-touch screen >>>
[all]
dtparam=spi=on
dtoverlay=piscreen,drm,speed=16000000,rotate=90
# <<< ender5-touch screen <<<
```

A Raspberry Pi engineer suggested this overlay for these screens on Bookworm
(see Sources). It was written for the OzzMaker PiScreen, which uses the same ILI9486 + ADS7846
chips, and many Waveshare-style boards work with it. Some clones, reportedly the red-PCB ones, don't work with the
kernel's ILI9486 driver. If the image looks wrong (mirrored, inverted colours,
garbage) or stays white, use Option B.

## Option B — Waveshare's `waveshare35a` overlay

This is Waveshare's own driver, built on the older fbtft framework. It needs the
classic firmware framebuffer, so the script comments out `dtoverlay=vc4-kms-v3d`.
That means HDMI output may stop working, so do this over SSH.

1. Download `waveshare35a.dtbo` from Waveshare's *3.5inch RPi LCD (A)* wiki page
   (Bookworm section) and copy it to `/boot/firmware/overlays/` (or `/boot/overlays/`).
2. ```bash
   sudo bash ~/ender5-touch/pi-setup/setup-screen.sh waveshare35a
   sudo reboot
   ```

Don't run Waveshare's `LCD-show` scripts on OctoPi. They rewrite a lot of system
config, install a desktop, and are hard to undo.

## Check it

```bash
sudo bash ~/ender5-touch/pi-setup/check-screen.sh test
```

It lists framebuffers (look for one marked *SPI screen*), the touch device
(`ADS7846 Touchscreen`), relevant kernel messages, and then fills the small
screen with noise for 2 s. If you see static, the display side works.

## Rotation

`rotate=90` gives landscape; use `rotate=270` if it's upside down:

```bash
sudo bash setup-screen.sh piscreen 270
```

Touch is rotated separately: the kiosk applies an X *Coordinate Transformation
Matrix*. After changing display rotation, re-run `sudo ender5-kiosk calibrate`
(or try `sudo ender5-kiosk rotate-touch 90|270|180|swap|invert-x|invert-y`).

## Gotchas

* A separate `dtoverlay=ads7846` line conflicts with the touch controller the
  screen overlays already set up. `setup-screen.sh` comments it out.
* SPI speed: 16 MHz is safe. Faster (`speed=24000000`) gives smoother redraws
  on some boards and a corrupted image on others.
* Pi 5: Waveshare documents `waveshare35a` for the Pi 5, and the `piscreen` DRM
  route is the one suggested for current kernels. Neither has been tested with this
  project on a Pi 5 yet.
* To undo everything: `sudo bash setup-screen.sh remove` restores your
  `config.txt` lines. A timestamped backup is also made on every run.

## Sources

* Raspberry Pi forums, *LCD 3,5 TFT 480x320 xpt2046* — `piscreen,drm` recommendation for Bookworm:
  https://forums.raspberrypi.com/viewtopic.php?t=382506
* Waveshare wiki, *3.5inch RPi LCD (A) Manual Configuration*:
  https://www.waveshare.com/wiki/3.5inch_RPi_LCD_(A)_Manual_Configuration
* caliston/waveshare-LCD35-bookworm — minimal Bookworm setup with fbdev on `/dev/fb1`:
  https://github.com/caliston/waveshare-LCD35-bookworm
