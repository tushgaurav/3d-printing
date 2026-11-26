import { CopyButton } from "./CopyButton";

const DEMO = `cd ender-5-pro/touch-ui/octoprint_layer1/static
python -m http.server 8765`;

export function Demo() {
  return (
    <section className="demo-section" aria-labelledby="demo-title">
      <div className="demo" id="demo">
        <div className="demo__copy">
          <h2 className="demo__title" id="demo-title">
            No Pi yet? Run the demo
          </h2>
          <p className="demo__text">
            Clone the repo and serve the screen locally. It fakes a print in progress, so every
            button works. Then open{" "}
            <code>localhost:8765/index.html?demo=printing</code> and size the window to 480×320
            for the real feel.
          </p>
        </div>
        <div className="terminal">
          <pre>
            <code>{DEMO}</code>
          </pre>
          <CopyButton text={DEMO} label="Copy" />
        </div>
      </div>
    </section>
  );
}
