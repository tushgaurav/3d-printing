"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import home from "@/assets/screens/home.png";

// The touch UI, copied into public/demo by scripts/copy-demo.mjs, running its simulated printer.
const DEMO_SRC = "/demo/index.html?demo=printing";
// Phones keep the screenshot: the 480x320 UI would be too small to use there.
const LIVE_QUERY = "(min-width: 761px)";
// The UI's native size. At exactly this size it renders 1:1 (any other size and it
// switches to its own desktop preview, with a fake bezel), so the frame stays this
// size and is scaled up with a transform instead.
const UI_WIDTH = 480;

export function Screens() {
  const [live, setLive] = useState(false); // iframe mounted
  const [ready, setReady] = useState(false); // the UI inside it has booted
  const [run, setRun] = useState(0); // bumped to restart the demo
  const sectionRef = useRef<HTMLElement>(null);
  const glassRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Mount the live UI once the section comes near the viewport, on wide enough screens.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const mq = window.matchMedia(LIVE_QUERY);
    let io: IntersectionObserver | null = null;

    const start = () => {
      if (!mq.matches) return;
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setLive(true);
            io?.disconnect();
          }
        },
        { rootMargin: "200px 0px" },
      );
      io.observe(section);
    };
    const onChange = () => {
      io?.disconnect();
      io = null;
      if (mq.matches) start();
      else {
        setLive(false);
        setReady(false);
      }
    };

    start();
    mq.addEventListener("change", onChange);
    return () => {
      io?.disconnect();
      mq.removeEventListener("change", onChange);
    };
  }, []);

  // Scale the 480x320 frame to fill the device glass.
  useEffect(() => {
    const glass = glassRef.current;
    if (!live || !glass) return;
    const ro = new ResizeObserver(([entry]) => {
      glass.style.setProperty("--k", String(entry.contentRect.width / UI_WIDTH));
    });
    ro.observe(glass);
    return () => ro.disconnect();
  }, [live]);

  // Reveal the UI once it has booted (its #app drops the "booting" class).
  useEffect(() => {
    const frame = frameRef.current;
    if (!live || !frame) return;
    let observer: MutationObserver | null = null;

    const attach = () => {
      const app = frame.contentDocument?.getElementById("app");
      if (!app) return;
      const sync = () => {
        if (!app.classList.contains("booting")) setReady(true);
      };
      observer = new MutationObserver(sync);
      observer.observe(app, { attributes: true, attributeFilter: ["class"] });
      sync();
    };

    // It may already have loaded (from cache) before this effect ran.
    if (frame.contentWindow?.location.pathname.startsWith("/demo/") && frame.contentDocument?.readyState === "complete") {
      attach();
    }
    frame.addEventListener("load", attach);
    return () => {
      frame.removeEventListener("load", attach);
      observer?.disconnect();
    };
  }, [live, run]);

  function restart() {
    setReady(false);
    setRun((r) => r + 1);
  }

  return (
    <section className="screens" id="screens" ref={sectionRef} aria-labelledby="screens-title">
      <div className="screens__body">
        <div className="screens__intro">
          <h2 className="section-title" id="screens-title">
            No more digging through the knob menu
          </h2>
          <p className="section-lede">
            Five screens, each one tap from the rail, readable from across the room.
          </p>
        </div>

        <div className="screens__stage">
          <div className="device">
            <div className="device__glass" ref={glassRef}>
              <Image
                src={home}
                alt={ready ? "" : "The Layer1 home screen mid-print: live camera, 47%, 47 minutes left, Pause, Tune and Stop"}
                aria-hidden={ready}
                className="device__shot"
                sizes="(max-width: 900px) 92vw, 58vw"
                quality={90}
              />
              {live && (
                <iframe
                  key={run}
                  ref={frameRef}
                  src={DEMO_SRC}
                  title="Layer1 live demo, running a simulated print"
                  className="device__live"
                  data-ready={ready}
                  width={480}
                  height={320}
                  tabIndex={ready ? 0 : -1}
                />
              )}
            </div>
          </div>

          {live && (
            <div className="device__caption">
              <p>
                <span className="device__dot" aria-hidden="true" />
                {ready ? "Live demo with a simulated printer. Tap around." : "Starting the live demo…"}
              </p>
              <button type="button" className="device__restart" onClick={restart} disabled={!ready}>
                Restart Demo
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
