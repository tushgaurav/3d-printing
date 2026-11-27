import type { ComponentType, SVGProps } from "react";
import { FolderOpen, Layers, Plug, SlidersHorizontal, TabletLandscape, Webcam } from "./icons";

type Feature = {
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  title: string;
  body: string;
};

// Icons sit in the same graphite tiles, lime on dark, as the Layer1 "More" screen.
const FEATURES: Feature[] = [
  {
    icon: Webcam,
    title: "Print monitoring",
    body: "Know exactly what’s happening with your print. Follow progress, check estimated completion times, monitor temperatures, and watch your printer through a live camera feed.",
  },
  {
    icon: SlidersHorizontal,
    title: "Complete printer control",
    body: "Adjust temperatures, move your printer’s axes, control extrusion, manage filament, and fine-tune print settings without reaching for your computer.",
  },
  {
    icon: FolderOpen,
    title: "Your files, beautifully organized",
    body: "Browse your G-code library, explore folders, view slicer thumbnails, and start prints directly from the touchscreen.",
  },
  {
    icon: Layers,
    title: "Understand every detail",
    body: "Visualize G-code, explore temperature history, and keep track of completed, failed, and cancelled prints.",
  },
  {
    icon: TabletLandscape,
    title: "Designed for dedicated displays",
    body: "A full-screen interface with touch-friendly controls, carefully designed for compact Raspberry Pi displays.",
  },
  {
    icon: Plug,
    title: "Works with OctoPrint",
    body: "Layer1 uses OctoPrint’s existing APIs to talk to your printer, keeping your OctoPrint setup and its ecosystem at the center.",
  },
];

export function Features() {
  return (
    <section className="features" id="features" aria-labelledby="features-title">
      <div className="features__head">
        <h2 className="section-title" id="features-title">
          Everything you need. Right at your fingertips.
        </h2>
        <p className="section-lede">
          Layer1 turns an OctoPrint-powered Raspberry Pi and touchscreen into a modern control
          panel for your printer.
        </p>
      </div>

      <ul className="features__grid">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="feature">
            <span className="feature__icon">
              <Icon size={22} />
            </span>
            <h3 className="feature__title">{title}</h3>
            <p className="feature__body">{body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
