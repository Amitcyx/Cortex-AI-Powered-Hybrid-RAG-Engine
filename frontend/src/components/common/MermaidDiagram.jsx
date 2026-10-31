import { useEffect, useRef, useState } from "react";
import { Copy, Check, Maximize2, AlertCircle } from "lucide-react";

let mermaidPromise = null;
function loadMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (mermaidPromise) return mermaidPromise;

  mermaidPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js";
    script.async = true;
    script.onload = () => {
      if (window.mermaid) {
        window.mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            darkMode: true,
            background: "#131316",
            primaryColor: "#1e1e24",
            primaryTextColor: "#e2e8f0",
            primaryBorderColor: "#3b82f6",
            lineColor: "#60a5fa",
            secondaryColor: "#1e1e24",
            tertiaryColor: "#18181b",
          },
          securityLevel: "loose",
        });
        resolve(window.mermaid);
      } else {
        reject(new Error("Mermaid failed to load"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load Mermaid script"));
    document.head.appendChild(script);
  });

  return mermaidPromise;
}

export default function MermaidDiagram({ chart, id = `mermaid-${Math.random().toString(36).substr(2, 9)}` }) {
  const containerRef = useRef(null);
  const [svgContent, setSvgContent] = useState("");
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!chart?.trim()) return;
    let isCancelled = false;
    setError(null);

    loadMermaid()
      .then((mermaid) => {
        if (isCancelled) return;
        const cleanChart = chart.trim();
        const renderId = `m-${Math.random().toString(36).substr(2, 9)}`;
        return mermaid.render(renderId, cleanChart);
      })
      .then((res) => {
        if (!isCancelled && res?.svg) {
          setSvgContent(res.svg);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setError(err.message || "Failed to render diagram");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [chart]);

  const copyCode = () => {
    navigator.clipboard.writeText(chart);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (error) {
    return (
      <div className="mermaid-error-box">
        <div className="mermaid-error-header">
          <AlertCircle size={14} className="text-red-400" />
          <span>Diagram Syntax Error</span>
        </div>
        <pre className="mermaid-raw-code">{chart}</pre>
      </div>
    );
  }

  return (
    <div className={`mermaid-wrapper ${isExpanded ? "expanded" : ""}`}>
      <div className="mermaid-toolbar">
        <span className="mermaid-label">Mermaid Flowchart</span>
        <div className="mermaid-actions">
          <button onClick={copyCode} title="Copy Mermaid Code" className="mermaid-btn">
            {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
            <span>{copied ? "Copied" : "Copy Code"}</span>
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Collapse" : "Expand"}
            className="mermaid-btn"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="mermaid-render-area"
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  );
}
