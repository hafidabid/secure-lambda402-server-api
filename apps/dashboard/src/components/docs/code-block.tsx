import { createHighlighter, type ThemeRegistration } from "shiki";
import { CopyIconButton } from "@/components/ui";

const LANGS = ["bash", "json", "ts", "tsx", "http", "toml", "rust"];

const THEME_NAME = "instrument-dark";

const INSTRUMENT_DARK: ThemeRegistration = {
  name: THEME_NAME,
  type: "dark",
  colors: { "editor.background": "#1d1d1b", "editor.foreground": "#f2efe8" },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#a8a49b", fontStyle: "italic" } },
    { scope: ["string", "string.quoted"], settings: { foreground: "#dcc59a" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#b9d3c0" } },
    { scope: ["keyword", "storage", "storage.type"], settings: { foreground: "#c9c3b6" } },
    { scope: ["support.type.property-name", "meta.object-literal.key", "entity.name.tag"], settings: { foreground: "#f2efe8" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#e7d9bd" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#a8a49b" } },
  ],
};

const highlighter = createHighlighter({ themes: [INSTRUMENT_DARK], langs: LANGS });

async function highlight(code: string, lang: string) {
  "use cache";
  return (await highlighter).codeToHtml(code, { lang: LANGS.includes(lang) ? lang : "text", theme: THEME_NAME });
}

export async function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const html = await highlight(code, lang);
  return (
    <figure className="docs-code">
      <figcaption>
        <span>{lang}</span>
        <CopyIconButton content={code} label="Copy code" dark />
      </figcaption>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </figure>
  );
}
