"use client";

import { MotionConfig } from "motion/react";
import { AgentPayments } from "./agents";
import { Faq } from "./faq";
import { GetStarted, SiteFooter } from "./closing";
import { Hero } from "./hero";
import { Story } from "./story";
import { UseCases } from "./use-cases";

export function InstrumentPage() {
  return (
    <MotionConfig reducedMotion="user">
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
