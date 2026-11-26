import Image from "next/image";
import printer from "@/assets/printer.png";
import home from "@/assets/screens/home.png";
import { ArrowUpRight, GitHubMark, OctoPrintMark } from "./icons";
import { REPO, SETUP_GUIDE } from "@/lib/links";

/**
 * The headline is drawn twice: once in white, and once in lime as a thin band that
 * climbs the letters while they appear, the way the Layer1 3D view highlights the
 * layer being printed. Both are revealed bottom-up in stepped "layers".
 */
function PrintedWords({ lines, side }: { lines: string[]; side: "left" | "right" }) {
  return (
    <span className={`hero__words hero__words--${side}`}>
      <span className="hero__ink">
        {lines.map((l) => (
          <span key={l} className="hero__line">
            {l}
          </span>
        ))}
      </span>
      <span className="hero__layer" aria-hidden="true">
        {lines.map((l) => (
          <span key={l} className="hero__line">
            {l}
          </span>
        ))}
      </span>
    </span>
  );
}

export function Hero() {
  return (
    <header className="hero">
      <nav className="nav" aria-label="Main">
        <a className="nav__logo" href="#top" aria-label="Layer1 home">
          <Image src="/layer1-logo.svg" alt="" width={74} height={39} preload />
        </a>
        <a className="pill pill--paper" href={REPO}>
          <GitHubMark size={20} />
          <span>View on GitHub</span>
        </a>
      </nav>

      <div className="hero__stage" id="top">
        <h1 className="hero__title">
          <PrintedWords side="left" lines={["Touch", "screen"]} />
          <span className="sr-only"> for the </span>
          <PrintedWords side="right" lines={["Ender", "5 Pro"]} />
        </h1>

        <div
          className="hero__printer"
          style={{ aspectRatio: `${printer.width} / ${printer.height}` }}
        >
          <span className="hero__shadow" aria-hidden="true" />
          <Image
            src={printer}
            alt="A Creality Ender 5 Pro 3D printer"
            className="hero__printer-img"
            sizes="(max-width: 760px) 80vw, 46vw"
            preload
            placeholder="empty"
          />

          {/* What the printer is doing right now, pinned to the hotend. */}
          <div className="hero__reading" aria-hidden="true">
            <span className="hero__reading-dot" />
            <span>Printing</span>
            <strong>47%</strong>
          </div>
          <span className="hero__pin" aria-hidden="true" />

          {/* The 3.5-inch screen, floating where it mounts on the frame. */}
          <figure className="hero__screen">
            <Image
              src={home}
              alt="The Layer1 home screen mid-print: live camera, 47% progress, 47 minutes left"
              sizes="(max-width: 760px) 44vw, 17vw"
              quality={90}
              loading="eager"
            />
          </figure>
        </div>

        <div className="hero__foot">
          <a className="cta" href={SETUP_GUIDE}>
            <span>Install Guide</span>
            <span className="cta__icon">
              <ArrowUpRight size={20} />
            </span>
          </a>
          <p className="hero__meta">
            <span>Runs on</span>
            <span className="chip chip--paper chip--brand">
              <OctoPrintMark size={16} className="chip__octoprint" />
              <span>OctoPrint</span>
            </span>
          </p>
        </div>
      </div>
    </header>
  );
}
