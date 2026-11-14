"use client";

import { MotionConfig } from "motion/react";
import { JudgeBanner } from "@/components/judge-banner";
import { AgentPayments } from "./agents";
import { Faq } from "./faq";
import { GetStarted, SiteFooter } from "./closing";
import { Hero } from "./hero";
import { Story } from "./story";
import { UseCases } from "./use-cases";

export function InstrumentPage() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-[1296px] px-4 pt-4 sm:px-8">
        <JudgeBanner />
      </div>
      <Hero />
      <Story />
      <UseCases />
      <AgentPayments />
      <Faq />
      <GetStarted />
      <SiteFooter />
    </MotionConfig>
  );
}
