import type { Metadata, Viewport } from "next";
import { Archivo, Geist } from "next/font/google";
import "./globals.css";

// Archivo carries the display type, pushed to its widest setting (wdth 125) so the
// hero reads like the label on a machine. Geist is the face the Layer1 screen itself
// uses, so the body copy and the screenshots speak with one voice.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Layer1: a touchscreen for the Ender 5 Pro",
  description:
    "A Bambu-style touch interface for the Ender 5 Pro. Runs on a 3.5-inch Raspberry Pi screen through OctoPrint.",
};

export const viewport: Viewport = {
  themeColor: "#8695a6",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${geist.variable}`}>
      <body>{children}</body>
    </html>
  );
}
