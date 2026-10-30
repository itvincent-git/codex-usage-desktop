export type TrayQuotaIndicator = {
  kind: "5h" | "weekly" | "monthly";
  remainingPercent: number | null;
  countdown: string | null;
};

export type TrayMetricIndicator = {
  kind: "tokens" | "cost";
  value: string;
};

export type TrayIconBitmap = {
  rgba: number[];
  width: number;
  height: number;
};

// tray-icon displays macOS images at 18 points high. Render at 3x for Retina.
export function renderTrayIcon(
  indicators: TrayQuotaIndicator[],
  metrics: TrayMetricIndicator[],
  dark: boolean,
): TrayIconBitmap {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const font = '-apple-system, BlinkMacSystemFont, sans-serif';
  context.font = `12px ${font}`;
  const widths = indicators.map(({ countdown }) => 18 + (countdown ? 5 + context.measureText(countdown).width : 0));
  const metricWidths = metrics.map(({ value }) => 23 + context.measureText(value).width);
  const width = Math.ceil([...widths, ...metricWidths].reduce((sum, value) => sum + value, 0)
    + Math.max(0, indicators.length + metrics.length - 1) * 12);
  canvas.width = width * 3;
  canvas.height = 18 * 3;
  context.scale(3, 3);
  context.textBaseline = "middle";
  context.lineCap = "round";
  const foreground = dark ? "#f5f5f7" : "#252b37";
  const outline = dark ? "#252b37" : "#f5f5f7";
  const drawRing = (x: number, color: string, end: number, alpha = 1) => {
    context.globalAlpha = alpha;
    // Keep the outer edge inside the 18-point bitmap, including its outline.
    context.beginPath();
    context.arc(x + 9, 9, 7.4, -Math.PI / 2, end);
    context.strokeStyle = outline;
    context.lineWidth = 3;
    context.stroke();
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.stroke();
    context.globalAlpha = 1;
  };
  // The menu bar can contrast with the webview theme (for example over a dark
  // wallpaper). Outline bitmap text so it stays legible on either background.
  const drawText = (text: string, x: number, y: number) => {
    context.strokeStyle = outline;
    context.lineWidth = 1.5;
    context.lineJoin = "round";
    context.strokeText(text, x, y);
    context.fillText(text, x, y);
  };
  let x = 0;
  indicators.forEach(({ kind, remainingPercent, countdown }, index) => {
    if (index > 0) x += 12;
    const remaining = remainingPercent === null ? null : Math.min(100, Math.max(0, remainingPercent));
    const color = kind === "5h" ? "#36b883" : "#8b5cf6";
    drawRing(x, color, Math.PI * 1.5, 0.4);
    if (remaining !== null && remaining > 0) {
      drawRing(x, color, -Math.PI / 2 + Math.PI * 2 * remaining / 100);
    }
    context.fillStyle = foreground;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.font = `600 ${remaining !== null && Math.round(remaining) === 100 ? 7 : 8}px ${font}`;
    const label = remaining === null ? "–" : String(Math.round(remaining));
    const metrics = context.measureText(label);
    drawText(label,
      x + 9 + (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2,
      9 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2);
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.font = `12px ${font}`;
    if (countdown) drawText(countdown, x + 23, 9.5);
    x += widths[index];
  });
  metrics.forEach(({ kind, value }, index) => {
    if (indicators.length > 0 || index > 0) x += 12;
    drawRing(x, kind === "tokens" ? "#3b82f6" : "#d4a017", Math.PI * 1.5);
    context.fillStyle = foreground;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.font = `600 10px ${font}`;
    const label = kind === "tokens" ? "T" : "$";
    const bounds = context.measureText(label);
    drawText(label,
      x + 9 + (bounds.actualBoundingBoxLeft - bounds.actualBoundingBoxRight) / 2,
      9 + (bounds.actualBoundingBoxAscent - bounds.actualBoundingBoxDescent) / 2);
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.font = `12px ${font}`;
    drawText(value, x + 23, 9.5);
    x += metricWidths[index];
  });
  return {
    rgba: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
    width: canvas.width,
    height: canvas.height,
  };
}
