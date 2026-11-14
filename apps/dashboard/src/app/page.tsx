import { Azeret_Mono, Barlow, Barlow_Condensed } from "next/font/google";
import { InstrumentPage } from "@/components/instrument/page";

const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-barlow-condensed" });
const azeret = Azeret_Mono({ subsets: ["latin"], variable: "--font-azeret" });

export default function LandingPage() {
  return (
    <div className={`${barlow.variable} ${barlowCondensed.variable} ${azeret.variable} instrument`}>
      <InstrumentPage />
    </div>
  );
}
