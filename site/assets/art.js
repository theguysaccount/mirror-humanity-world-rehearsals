// Shift Rehearsal's chart as SVG text: average wait by hour for the baseline and the plan, with each
// hour's staffing underneath. No DOM access, so the tests can read it.
import { hourLabel } from "./sim.js";

const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function waitChartSVG(result, { width = 760, height = 300 } = {}) {
  const s = result.scenario;
  const n = s.arrivals.length;
  const pad = { l: 100, r: 14, t: 18, b: 74 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const series = [result.baseline.hourWait, result.plan.hourWait];
  const max = Math.max(1, ...series.flat());
  const step = max <= 2 ? 0.5 : max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : 30;
  const top = Math.ceil(max / step) * step;
  const col = w / n;
  const X = (i) => pad.l + col * (i + 0.5);
  const Y = (v) => pad.t + (1 - v / top) * h;
  const grid = [];
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid.push(`<line x1="${pad.l}" x2="${width - pad.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="grid"/><text x="${pad.l - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="tick">${v}</text>`);
  }
  const line = (vals, cls) => `<polyline points="${vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}" class="${cls}"/>` +
    vals.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.5" class="${cls}-dot"><title>${hourLabel(s.open + i)}: ${v.toFixed(1)} min</title></circle>`).join("");
  const labels = s.arrivals.map((a, i) => `<text x="${X(i).toFixed(1)}" y="${pad.t + h + 16}" text-anchor="middle" class="tick">${hourLabel(s.open + i)}</text>` +
    `<text x="${X(i).toFixed(1)}" y="${pad.t + h + 36}" text-anchor="middle" class="staff base">${s.baseline[i]}</text>` +
    `<text x="${X(i).toFixed(1)}" y="${pad.t + h + 54}" text-anchor="middle" class="staff plan">${s.plan[i]}</text>`).join("");
  const title = `Average wait by hour of arrival. ${s.arrivals.map((_, i) => `${hourLabel(s.open + i)}: baseline ${series[0][i].toFixed(1)} min, plan ${series[1][i].toFixed(1)} min`).join("; ")}.`;
  return `<svg viewBox="0 0 ${width} ${height}" class="wait-chart" role="img" aria-label="${x(title)}">
<text x="${pad.l}" y="${pad.t - 2}" class="axis-title">minutes</text>
${grid.join("")}
<text x="6" y="${pad.t + h + 36}" class="staff base">staff, baseline</text><text x="6" y="${pad.t + h + 54}" class="staff plan">staff, plan</text>
${labels}${line(series[0], "base-line")}${line(series[1], "plan-line")}</svg>`;
}
