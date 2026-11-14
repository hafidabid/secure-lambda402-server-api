import { isValidElement, type ReactNode } from "react";
import { z } from "zod";

const FenceProps = z.object({ className: z.string().optional(), children: z.string() });

export function codeFence(children: ReactNode): { lang: string; code: string } | null {
  if (!isValidElement(children) || children.type !== "code") return null;
  const props = FenceProps.safeParse(children.props);
  if (!props.success) return null;
  const lang = /language-(\S+)/.exec(props.data.className ?? "")?.[1] ?? "text";
  return { lang, code: props.data.children.replace(/\n$/, "") };
}
