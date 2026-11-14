"use client";

import { useEffect, useId, useState } from "react";

const THEME = {
  background: "#ecebe7",
  primaryColor: "#d6d3cc",
  primaryTextColor: "#1b1b1a",
  primaryBorderColor: "#1b1b1a",
  lineColor: "#1b1b1a",
  actorBkg: "#d6d3cc",
  actorBorder: "#1b1b1a",
  actorTextColor: "#1b1b1a",
  signalColor: "#1b1b1a",
  signalTextColor: "#1b1b1a",
  noteBkgColor: "#e7e5e0",
  noteBorderColor: "#c7c3bb",
  noteTextColor: "#4f4d48",
  labelBoxBkgColor: "#1d1d1b",
  labelBoxBorderColor: "#1d1d1b",
  labelTextColor: "#f2efe8",
  loopTextColor: "#1b1b1a",
  sequenceNumberColor: "#f2efe8",
  fontFamily: "var(--font-barlow), system-ui, sans-serif",
  fontSize: "15px",
};

const SEQUENCE = { useMaxWidth: true, actorMargin: 20, width: 110, boxMargin: 6, messageMargin: 30, messageFontSize: 15, noteFontSize: 14 };

export function Diagram({ chart }: { chart: string }) {
  const id = `diagram-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: THEME, sequence: SEQUENCE });
        const { svg } = await mermaid.render(id, chart);
        if (!cancelled) setSvg(svg);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [id, chart]);

  if (!svg) {
    return (
      <figure className="docs-diagram" aria-busy={!failed}>
        {failed && <figcaption>Diagram failed to render. Source:</figcaption>}
        <pre>{chart}</pre>
      </figure>
    );
  }
  return <figure className="docs-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}
