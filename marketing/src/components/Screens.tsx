"use client";

import Image, { type StaticImageData } from "next/image";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import home from "@/assets/screens/home.png";
import files from "@/assets/screens/files.png";
import heat from "@/assets/screens/heat.png";
import move from "@/assets/screens/move.png";
import more from "@/assets/screens/more.png";
import { Folder, Grid, Home, Move, Thermometer } from "./icons";

type Screen = {
  key: string;
  name: string;
  icon: ReactNode;
  text: string;
  image: StaticImageData;
  alt: string;
};

// Same order and icons as the rail on the left of the Layer1 screen.
const SCREENS: Screen[] = [
  {
    key: "home",
    name: "Home",
    icon: <Home size={22} />,
    text: "Live camera or a 3D view of the G-code, the layer gauge, time left and when it’ll finish. Pause, Tune and Stop sit right underneath.",
    image: home,
    alt: "Home screen while printing a Benchy: live camera, 47%, 47 minutes left, Pause, Tune and Stop buttons",
  },
  {
    key: "files",
    name: "Files",
    icon: <Folder size={22} />,
    text: "Everything uploaded to OctoPrint, with slicer thumbnails and folders. Sort by recent, name or print time, then tap Print.",
    image: files,
    alt: "Files screen listing print files with thumbnails, print times and filament weights",
  },
  {
    key: "heat",
    name: "Heat",
    icon: <Thermometer size={22} />,
    text: "Nozzle and bed side by side. Nudge by 5°, type an exact target, or tap a preset for PLA, PETG, TPU or ABS.",
    image: heat,
    alt: "Heat screen with nozzle and bed temperatures and material presets",
  },
  {
    key: "move",
    name: "Move",
    icon: <Move size={22} />,
    text: "Jog X and Y, raise or lower the bed, and extrude or retract in steps from 0.1 to 50 mm. It locks itself while a print runs.",
    image: move,
    alt: "Move screen with an XY pad, bed up and down controls and step sizes",
  },
  {
    key: "more",
    name: "More",
    icon: <Grid size={22} />,
    text: "Load, unload and purge filament, tune speed, flow and fan, check the camera and connection, and switch to the light theme.",
    image: more,
    alt: "More screen with Filament, Tune, Camera, Printer, System and Display tiles",
  },
];

export function Screens() {
  const [active, setActive] = useState(0);
  const id = useId();

  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = SCREENS.length - 1;
    const next =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? i === last ? 0 : i + 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? i === 0 ? last : i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  }

  return (
    <section className="screens" id="screens" aria-labelledby={`${id}-title`}>
      <div className="screens__intro">
        <h2 className="section-title" id={`${id}-title`}>
          No more digging through the knob menu
        </h2>
        <p className="section-lede">
          Five screens, each one tap from the rail, readable from across the room.
        </p>
      </div>

      <div className="screens__body">
        <div className="rail" role="tablist" aria-orientation="vertical" aria-label="Layer1 screens">
          {SCREENS.map((s, i) => {
            const selected = i === active;
            return (
              <button
                key={s.key}
                id={`${id}-tab-${i}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${id}-panel`}
                tabIndex={selected ? 0 : -1}
                className="rail__item"
                onClick={() => setActive(i)}
                onKeyDown={(e) => onKey(e, i)}
              >
                <span className="rail__icon">{s.icon}</span>
                <span className="rail__text">
                  <span className="rail__name">{s.name}</span>
                  <span className="rail__desc">{s.text}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div
          className="device"
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${active}`}
        >
          <div className="device__glass">
            {SCREENS.map((s, i) => (
              <Image
                key={s.key}
                src={s.image}
                alt={i === active ? s.alt : ""}
                aria-hidden={i !== active}
                className="device__shot"
                data-active={i === active}
                sizes="(max-width: 900px) 92vw, 58vw"
                quality={90}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
