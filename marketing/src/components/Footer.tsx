import Image from "next/image";
import { REPO, SETUP_GUIDE } from "@/lib/links";
import { PHOTO_CREDIT } from "@/lib/credits";

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__top">
        <Image
          className="footer__mark"
          src="/layer1-logo.svg"
          alt="Layer1"
          width={220}
          height={116}
        />
        <ul className="footer__links">
          <li>
            <a href={REPO}>GitHub</a>
          </li>
          <li>
            <a href={SETUP_GUIDE}>Setup guide</a>
          </li>
          <li>
            <a href="#screens">Screens</a>
          </li>
        </ul>
      </div>
      <div className="footer__fine">
        <p>Layer1 is a community project. It isn’t made by or affiliated with Creality.</p>
        <p>
          {PHOTO_CREDIT} Type set in Archivo and Geist (SIL OFL 1.1). Icons from Lucide (ISC).
        </p>
      </div>
    </footer>
  );
}
