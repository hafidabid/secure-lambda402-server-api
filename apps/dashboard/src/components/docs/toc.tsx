"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Engraved, cn } from "@/components/ui";

const HEADINGS = "#docs-article h2[id], #docs-article h3[id]";

function subscribe(onChange: () => void) {
  const article = document.getElementById("docs-article");
  if (!article) return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(article, { childList: true, subtree: true });
  return () => observer.disconnect();
}

// A string snapshot keeps useSyncExternalStore stable: unchanged headings compare equal.
function headingSnapshot() {
  return Array.from(document.querySelectorAll(HEADINGS))
    .map((n) => [n.tagName, n.id, n.textContent ?? ""].join("\t"))
    .join("\n");
}

export function Toc() {
  const snapshot = useSyncExternalStore(subscribe, headingSnapshot, () => "");
  const headings = useMemo(
    () =>
      snapshot
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [tag, id, text] = line.split("\t");
          return { id, text, nested: tag === "H3" };
        }),
    [snapshot],
  );
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting);
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    document.querySelectorAll(HEADINGS).forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [snapshot]);

  if (headings.length < 2) return null;
  return (
    <nav aria-label="On this page" className="hidden xl:sticky xl:top-0 xl:block xl:max-h-dvh xl:overflow-y-auto xl:py-12">
      <Engraved>On this page</Engraved>
      <ul className="mt-2 space-y-1 border-l border-chassis-deep">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={cn(
                "-ml-px block border-l py-0.5 text-[14px] leading-snug text-etch-3 hover:text-etch",
                h.nested ? "pl-6" : "pl-3",
                active === h.id ? "border-etch text-etch" : "border-transparent",
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
