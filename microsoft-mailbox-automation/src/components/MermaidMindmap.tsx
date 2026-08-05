"use client";

import { useEffect, useRef, useState } from "react";

function sanitizeSvg(svgString: string): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return svgString;
  }
  const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  const svg = doc.documentElement;

  svg.querySelectorAll("script").forEach((el) => el.remove());
  svg.querySelectorAll("foreignObject").forEach((el) => el.remove());

  svg.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("on")) {
        el.removeAttribute(attr.name);
      }
      if (
        (attr.name === "xlink:href" || attr.name === "href") &&
        attr.value.trim().toLowerCase().startsWith("javascript:")
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return new XMLSerializer().serializeToString(svg);
}

export default function MermaidMindmap({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            background: "#0f172a",
            primaryColor: "#1e293b",
            primaryTextColor: "#e2e8f0",
            primaryBorderColor: "#3b82f6",
            lineColor: "#475569",
            secondaryColor: "#1e293b",
            tertiaryColor: "#0f172a",
          },
          mindmap: {
            padding: 20,
          },
        });

        const id = `mermaid-${Date.now()}`;
        const { svg: renderedSvg } = await mermaid.render(id, chart);
        if (!cancelled) {
          setSvg(sanitizeSvg(renderedSvg));
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || "Failed to render mindmap");
          // Fallback: show the raw mermaid syntax in a code block
          setSvg("");
        }
      }
    }

    if (chart) render();

    return () => { cancelled = true; };
  }, [chart]);

  if (error) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
          Mindmap render error: {error}. Showing raw syntax.
        </div>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-300 font-mono whitespace-pre-wrap">
          {chart}
        </pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-container flex justify-center overflow-x-auto rounded-lg bg-slate-950 p-4"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
