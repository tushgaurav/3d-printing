import Image from "next/image";
import move from "@/assets/screens/move.png";
import { ArrowUpRight, GitHubMark } from "./icons";
import { REPO, SETUP_GUIDE } from "@/lib/links";

export function Closing() {
  return (
    <section className="closing" aria-labelledby="closing-title">
      <div className="closing__body">
        <div className="closing__text">
          <h2 className="closing__title" id="closing-title">
            Give your printer a <em>second life.</em>
          </h2>
          <p className="closing__lede">
            You don’t need to buy a new printer to enjoy a modern printing experience. Bring
            Layer1 to your OctoPrint setup and give your printer the interface it deserves.
          </p>
          <div className="actions">
            <a className="cta cta--signal" href={SETUP_GUIDE}>
              <span>Get Started</span>
              <span className="cta__icon">
                <ArrowUpRight size={20} />
              </span>
            </a>
            <a className="text-link" href={REPO}>
              <GitHubMark size={18} />
              <span>Explore on GitHub</span>
            </a>
          </div>
        </div>

        <div className="closing__device">
          <Image
            src={move}
            alt="The Move screen: jog buttons for X, Y and the bed, step sizes, and Home All, Extrude, Retract and Motors Off"
            sizes="(max-width: 900px) 88vw, 44vw"
            quality={90}
          />
        </div>
      </div>

      <p className="closing__tagline">
        <span>Open source.</span>
        <span>Built for makers.</span>
        <span>Powered by OctoPrint.</span>
      </p>
    </section>
  );
}
