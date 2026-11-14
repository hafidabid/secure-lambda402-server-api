"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Engraved, cn } from "@/components/ui";

const SECTIONS = [{ title: "Start", items: [{ href: "/docs", label: "Overview" }] }];

export function DocsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Docs" className="border-b border-chassis-deep py-6 lg:sticky lg:top-0 lg:max-h-dvh lg:overflow-y-auto lg:border-b-0 lg:py-12">
      {SECTIONS.map((section) => (
        <div key={section.title} className="mb-6">
          <Engraved>{section.title}</Engraved>
          <ul className="mt-2 space-y-0.5">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={pathname === item.href ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-2.5 py-1.5 text-[15px] text-etch-2 hover:bg-chassis hover:text-etch",
                    pathname === item.href && "bg-chassis font-semibold text-etch",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
