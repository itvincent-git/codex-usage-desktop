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
  // macOS uses this bitmap as an alpha mask and supplies the menu bar color.
  context.fillStyle = "#000000";
  context.strokeStyle = "#000000";
  const drawRing = (x: number, end: number, alpha = 1) => {
    context.globalAlpha = alpha;
    context.beginPath();
    context.arc(x + 9, 9, 7.9, -Math.PI / 2, end);
    context.lineWidth = 2;
    context.stroke();
    context.globalAlpha = 1;
  };
  let x = 0;
  indicators.forEach(({ remainingPercent, countdown }, index) => {
    if (index > 0) x += 12;
    const remaining = remainingPercent === null ? null : Math.min(100, Math.max(0, remainingPercent));
    drawRing(x, Math.PI * 1.5, 0.25);
    if (remaining !== null && remaining > 0) {
      drawRing(x, -Math.PI / 2 + Math.PI * 2 * remaining / 100);
    }
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.font = `600 ${remaining !== null && Math.round(remaining) === 100 ? 7.5 : 9.5}px ${font}`;
    const label = remaining === null ? "–" : String(Math.round(remaining));
    const metrics = context.measureText(label);
    context.fillText(label,
      x + 9 + (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2,
      9 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2);
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.font = `12px ${font}`;
    if (countdown) context.fillText(countdown, x + 23, 9.5);
    x += widths[index];
  });
  metrics.forEach(({ kind, value }, index) => {
    if (indicators.length > 0 || index > 0) x += 12;
    drawRing(x, Math.PI * 1.5);
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    context.font = `600 10px ${font}`;
    const label = kind === "tokens" ? "T" : "$";
    const bounds = context.measureText(label);
    context.fillText(label,
      x + 9 + (bounds.actualBoundingBoxLeft - bounds.actualBoundingBoxRight) / 2,
      9 + (bounds.actualBoundingBoxAscent - bounds.actualBoundingBoxDescent) / 2);
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.font = `12px ${font}`;
    context.fillText(value, x + 23, 9.5);
    x += metricWidths[index];
  });
  return {
    rgba: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
    width: canvas.width,
    height: canvas.height,
  };
}
