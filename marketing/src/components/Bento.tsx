import Image from "next/image";
import heat from "@/assets/screens/heat.png";
import home from "@/assets/screens/home.png";
import files from "@/assets/screens/files.png";
import { ArrowUpRight, ShieldCheck } from "./icons";

export function Bento() {
  return (
    <section className="bento" aria-label="Highlights">
      <article className="card card--paper">
        <p className="card__kicker">Made for the small Pi screen</p>
        <p className="spec">
          <span className="spec__value">3.5″</span>
          <span className="chip chip--signal spec__tag">480×320</span>
        </p>
        <p className="card__foot">Thumb-sized buttons</p>
        <div className="card__device card__device--tilt">
          <Image
            src={heat}
            alt="The temperature screen: nozzle at 205°C and bed at 60°C, with PLA, PETG, TPU and ABS presets"
            sizes="(max-width: 760px) 70vw, 22vw"
            quality={90}
          />
        </div>
      </article>

      <article className="card card--graphite">
        <div className="card__device card__device--flat">
          <Image
            src={home}
            alt=""
            sizes="(max-width: 760px) 80vw, 26vw"
            quality={90}
          />
        </div>
        <h2 className="card__statement">
          Pause, tune or stop a print from the printer itself, no laptop needed.
        </h2>
        <p className="card__note">
          <ShieldCheck size={16} />
          <span>Runs through OctoPrint’s own safety checks</span>
        </p>
      </article>

      <article className="card card--clay">
        <div className="card__head">
          <h2 className="card__title">Try it without a printer</h2>
          <a className="round-link" href="#demo" aria-label="Run the Demo">
            <ArrowUpRight size={20} />
          </a>
        </div>
        <p className="card__body">The demo runs in any browser on your computer.</p>
        <code className="chip chip--mist">?demo=printing</code>
        <div className="card__device card__device--peek">
          <Image
            src={files}
            alt="The files screen: print files with slicer thumbnails and print times"
            sizes="(max-width: 760px) 70vw, 22vw"
            quality={90}
          />
        </div>
      </article>
    </section>
  );
}
