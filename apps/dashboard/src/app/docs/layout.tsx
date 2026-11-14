import { DocsNav } from "@/components/docs/nav";
import { Toc } from "@/components/docs/toc";
import "./docs.css";

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <div className="mx-auto grid max-w-[88rem] px-4 md:px-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12 xl:grid-cols-[13rem_minmax(0,1fr)_12rem]">
      <DocsNav />
      <article id="docs-article" className="docs-prose min-w-0 py-10 lg:py-12">
        {children}
      </article>
      <Toc />
    </div>
  );
}
