import type { MDXComponents } from "mdx/types";
import { CodeBlock } from "@/components/docs/code-block";
import { Diagram } from "@/components/docs/diagram";
import { codeFence } from "@/lib/docs-code";

const components: MDXComponents = {
  pre({ children }) {
    const fence = codeFence(children);
    if (!fence) return <pre>{children}</pre>;
    if (fence.lang === "mermaid") return <Diagram chart={fence.code} />;
    return <CodeBlock code={fence.code} lang={fence.lang} />;
  },
  table(props) {
    return (
      <div className="docs-table">
        <table {...props} />
      </div>
    );
  },
};

export function useMDXComponents(): MDXComponents {
  return components;
}
