import { Hero } from "@/components/Hero";
import { Bento } from "@/components/Bento";
import { Screens } from "@/components/Screens";
import { Demo } from "@/components/Demo";
import { Footer } from "@/components/Footer";

export default function Page() {
  return (
    <>
      <div className="scene">
        <Hero />
        <main>
          <Bento />
          <Screens />
          <Demo />
        </main>
      </div>
      <Footer />
    </>
  );
}
