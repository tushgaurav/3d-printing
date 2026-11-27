import { Hero } from "@/components/Hero";
import { Bento } from "@/components/Bento";
import { Features } from "@/components/Features";
import { Screens } from "@/components/Screens";
import { Closing } from "@/components/Closing";
import { Footer } from "@/components/Footer";

export default function Page() {
  return (
    <>
      <div className="scene">
        <Hero />
        <main>
          <Bento />
          <Features />
          <Screens />
          <Closing />
        </main>
      </div>
      <Footer />
    </>
  );
}
