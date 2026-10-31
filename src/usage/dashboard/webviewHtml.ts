import { escapeHtml } from "../../utils";
import { usageWebviewData } from "./webviewData";

/** Escape a JSON payload for embedding in an HTML <script> block. */
function jsonForWebview(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, "<\\/");
}

export function usageWebviewHtml(profileLabel: string): string {
  const data = usageWebviewData() ?? {};
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
    <title>OpenCode Usage</title>
    <style>
      :root{
        --bg-0: #101216; --bg-1: #161a20; --bg-2: #1b2029; --bg-3: #222936;
        --line: #242a33; --line-soft: #1b2028;
        --text-hi: #eef1f5; --text-mid: #9aa4b2; --text-lo: #5b6472;
        --amber: #e3b341; --teal: #3fdbb0; --coral: #ef7f6b; --blue: #5aa9ff; --violet: #a98ef9;
        --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        --s: clamp(10px, 1.6vh, 18px);
        --radius: clamp(8px, 1vh, 14px);
      }
      *{box-sizing:border-box; margin:0; padding:0;}
      html, body{ height:100%; width:100%; overflow:hidden; background:var(--bg-0); color:var(--text-hi); font-family:var(--sans); -webkit-font-smoothing:antialiased; }
      body{
        display:grid; grid-template-rows:auto auto 1fr; grid-template-areas:"topbar" "rings" "main";
        row-gap: var(--s); height:100vh; padding: var(--s);
        background:
          radial-gradient(1100px 500px at 90% -20%, rgba(227,179,65,0.05), transparent 60%),
          radial-gradient(900px 500px at -10% 0%, rgba(63,219,176,0.04), transparent 55%),
          var(--bg-0);
      }
      ::selection{ background:#7a6427; color:var(--text-hi); }
      *{ min-width:0; min-height:0; }

      .topbar{ grid-area:topbar; display:flex; align-items:center; gap: var(--s); }
      .topbar .actions{ margin-left:auto; display:flex; gap: calc(var(--s)/2); flex:none; }
      .brand{ display:flex; align-items:center; gap: clamp(6px,1vw,10px); min-width:0; }
      .brand .mark{
        width: clamp(20px, 2.4vh, 28px); height: clamp(20px, 2.4vh, 28px);
        border-radius: 7px; background:linear-gradient(135deg, var(--amber), var(--coral));
        display:flex; align-items:center; justify-content:center;
        font-family:var(--mono); font-weight:700; font-size: clamp(9px, 1.2vh, 12px);
        line-height:1; color:#141205; flex:none;
      }
      .brand .name{ font-weight:700; font-size: clamp(12px, 1.6vh, 15px); letter-spacing:-0.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .brand .sub{ color:var(--text-lo); font-size: clamp(9px, 1.1vh, 11px); font-family:var(--mono); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

      .rings-row{ grid-area:rings; display:flex; gap: var(--s); }
      .ring-card{
        flex:1 1 0; background:var(--bg-1); border:1px solid var(--line-soft); border-radius: var(--radius);
        padding: var(--s); display:flex; align-items:center; gap: var(--s); overflow:hidden;
      }
      .ring-wrap{ position:relative; width: clamp(38px, 6vh, 58px); height: clamp(38px, 6vh, 58px); flex:none; }
      .ring-wrap svg{ width:100%; height:100%; transform:rotate(-90deg); display:block; }
      .ring-bg{ fill:none; stroke:var(--bg-3); stroke-width:8; }
      .ring-fg{ fill:none; stroke-width:8; stroke-linecap:round; transition:stroke-dashoffset 1s cubic-bezier(.4,0,.2,1); }
      .ring-card.session .ring-fg{ stroke:var(--blue); }
      .ring-card.weekly .ring-fg{ stroke:var(--amber); }
      .ring-card.monthly .ring-fg{ stroke:var(--teal); }
      .ring-pct{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-family:var(--mono); font-weight:700; font-size: clamp(9px, 1.4vh, 13px); }
      .ring-info{ min-width:0; overflow:hidden; }
      .ring-info .label{ font-size: clamp(10px, 1.3vh, 12.5px); font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .ring-info .reset{ font-family:var(--mono); font-size: clamp(8.5px, 1vh, 10.5px); color:var(--text-lo); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .ring-info .amounts{ font-family:var(--mono); font-size: clamp(9.5px, 1.2vh, 12px); color:var(--text-mid); margin-top: clamp(3px,0.5vh,6px); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .ring-info .amounts b{ color:var(--text-hi); font-weight:700; }

      .main-panel{
        grid-area:main; background:var(--bg-1); border:1px solid var(--line-soft); border-radius: var(--radius);
        padding: var(--s); display:flex; flex-direction:column; gap: var(--s); overflow:hidden; position:relative;
      }
      .panel-top{ display:flex; align-items:center; justify-content:space-between; gap: var(--s); flex:none; flex-wrap:nowrap; }
      .tabs{ display:flex; gap: calc(var(--s)/3); background:var(--bg-2); border:1px solid var(--line-soft); border-radius: calc(var(--radius) - 2px); padding: calc(var(--s)/5); flex:none; }
      .tab-btn{
        font-family:var(--sans); font-weight:600; font-size: clamp(9.5px, 1.1vh, 11.5px);
        padding: calc(var(--s)/2.4) calc(var(--s)*0.85); border-radius: calc(var(--radius) - 4px);
        border:none; background:transparent; color:var(--text-mid); cursor:pointer; white-space:nowrap;
        transition: background .15s ease, color .15s ease;
      }
      .tab-btn:hover{ color:var(--text-hi); }
      .tab-btn.active{ background:var(--bg-3); color:var(--text-hi); }
      .tab-btn .sw{ display:inline-block; width:7px; height:7px; border-radius:2px; margin-right:6px; opacity:.55; }
      .tab-btn.active .sw{ opacity:1; }

      .stat-chips{ display:flex; gap: var(--s); flex:none; }
      .stat-chip{ text-align:right; }
      .stat-chip .k{ font-size: clamp(8.5px, 1vh, 10px); color:var(--text-lo); text-transform:uppercase; letter-spacing:.05em; white-space:nowrap; }
      .stat-chip .v{ font-family:var(--mono); font-weight:700; font-size: clamp(12px, 1.5vh, 15px); color:var(--text-hi); white-space:nowrap; margin-top:2px; }

      .chart-box{ position:relative; flex:1; min-height:0; }
      .chart-box svg{ width:100%; height:100%; display:block; overflow:visible; }
      .chart-box text{ font-family:var(--mono); }

      /* cursor-follow tooltip */
      .ttip{
        position:absolute; pointer-events:none; z-index:5; display:none;
        background:var(--bg-3); border:1px solid var(--line); border-radius:6px;
        padding:6px 9px; font-family:var(--mono); font-size:11px; color:var(--text-hi);
        white-space:nowrap; box-shadow:0 4px 14px rgba(0,0,0,.35);
      }
      .ttip .t-line{ color:var(--text-lo); margin-right:6px; }
      .ttip b{ color:var(--text-hi); }
      .ttip .t-sub{ color:var(--text-mid); font-size:10px; margin-top:2px; }

      .btn{
        background:var(--bg-2); border:1px solid var(--line); color:var(--text-mid);
        font-family:var(--sans); font-size: clamp(9.5px, 1.1vh, 11px); font-weight:600;
        padding: clamp(5px, 0.8vh, 8px) clamp(10px, 1.4vh, 14px);
        border-radius: calc(var(--radius) - 4px); text-decoration:none; cursor:pointer;
        white-space:nowrap; transition: background .15s ease, color .15s ease, border-color .15s ease;
      }
      .btn:hover{ background:var(--bg-3); color:var(--text-hi); border-color:var(--text-lo); }
      .btn.primary{ color:var(--text-hi); border-color:var(--line); }
      .btn.primary:hover{ border-color:var(--amber); }

      .legend{ display:flex; gap: clamp(10px, 1.4vh, 16px); flex-wrap:wrap; flex:none; align-items:center; padding: 2px 0 0 2px; }
      .legend .l-item{ display:flex; align-items:center; gap:7px; font-size: clamp(10px, 1.2vh, 12px); line-height:1; color:var(--text-mid); white-space:nowrap; }
      .legend .l-swatch{ width: clamp(10px, 1.2vh, 12px); height: clamp(10px, 1.2vh, 12px); border-radius:3px; flex:none; display:inline-block; }
      .legend .l-more{ color:var(--text-lo); font-size: clamp(9px, 1.05vh, 11px); }

      @media (max-width: 620px){
        .rings-row{ flex-wrap:wrap; }
        .ring-card{ flex:1 1 100%; }
        .panel-top{ flex-wrap:wrap; }
        .stat-chips{ display:none; }
      }
      @media (prefers-reduced-motion: reduce){ *{ transition:none !important; animation:none !important; } }
    </style>
    </head>
    <body>
      <div class="topbar">
        <div class="brand">
          <div class="mark">OC</div>
          <div class="name" id="brandName">${escapeHtml(profileLabel)}</div>
        </div>
        <div class="actions">
          <button class="btn" id="btnWindow" title="Switch the chart window: week / 14 days / month / lifetime">14 days</button>
          <button class="btn" id="btnTargets" title="Set manual spent targets for Session / Weekly / Monthly">Set targets</button>
          <button class="btn" id="btnRename" title="Rename the active profile" style="display:none">Rename</button>
          <button class="btn primary" id="btnRefresh" title="Refresh usage data now">Refresh</button>
        </div>
      </div>

      <div class="rings-row" id="rings"></div>

      <div class="main-panel">
        <div class="panel-top">
          <div class="tabs" id="tabs">
            <button class="tab-btn active" data-metric="spend"><span class="sw" style="background:var(--amber)"></span>Spend</button>
            <button class="tab-btn" data-metric="requests"><span class="sw" style="background:var(--blue)"></span>Requests</button>
            <button class="tab-btn" data-metric="tokens"><span class="sw" style="background:var(--teal)"></span>Tokens</button>
            <button class="tab-btn" data-metric="models"><span class="sw" style="background:var(--coral)"></span>Models</button>
            <button class="tab-btn" data-metric="suggested"><span class="sw" style="background:var(--violet)"></span>Suggested</button>
            <button class="tab-btn" data-metric="approved"><span class="sw" style="background:#7fd1a8"></span>Approved</button>
          </div>
          <div class="stat-chips" id="statChips"></div>
        </div>
        <div class="legend" id="legend"></div>
        <div class="chart-box" id="chartBox">
          <svg id="chartSvg" xmlns="http://www.w3.org/2000/svg"></svg>
          <div class="ttip" id="ttip"></div>
        </div>
      </div>

      <script type="application/json" id="usage-data">${jsonForWebview(data)}</script>
      <script>
      (function () {
        'use strict';
        var vscode = acquireVsCodeApi();
        var DATA = JSON.parse(document.getElementById('usage-data').textContent);
        var MODEL_COLORS = ['#e3b341','#5aa9ff','#3fdbb0','#ef7f6b','#a98ef9','#7fd1a8'];
        var svgNS = 'http://www.w3.org/2000/svg';
        var svg = document.getElementById('chartSvg');
        var box = document.getElementById('chartBox');
        var chips = document.getElementById('statChips');
        var ttip = document.getElementById('ttip');
        var current = 'spend';

        // HTML-escape a value for innerHTML (model names come from gateway/CLI data).
        function esc(s) {
          return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function el(tag, attrs, text) {
          var n = document.createElementNS(svgNS, tag);
          for (var k in attrs) n.setAttribute(k, attrs[k]);
          if (text !== undefined) n.textContent = text;
          return n;
        }
        function clear() { while (svg.firstChild) svg.removeChild(svg.firstChild); }
        function fmtUsd(v) { return v >= 1000 ? '$' + (v/1000).toFixed(2) + 'K' : '$' + v.toFixed(2); }
        function fmtCount(v) {
          if (v >= 1e9) return (v/1e9).toFixed(1) + 'B';
          if (v >= 1e6) return (v/1e6).toFixed(1) + 'M';
          if (v >= 1e3) return (v/1e3).toFixed(1) + 'k';
          return String(v);
        }
        function fmtTokens(v) { return fmtCount(v); }
        function dayLabel(ms) {
          var d = new Date(ms);
          return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }
        function niceMax(v) {
          if (v <= 0) return 1;
          var mag = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
          var norm = v / mag;
          return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
        }
        // Round tick step (1/2/2.5/5 x 10^n) so axis gaps stay clean: never
        // 1.25 / 2.50 / 3.75-style odd divisions.
        function niceStep(v) {
          if (v <= 0) return 1;
          var mag = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
          var norm = v / mag;
          var cand = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
          return cand * mag;
        }
        // Round the max up to a multiple of a round step, then emit 0..top ticks.
        // forceInt keeps counts whole (suggestions/approvals never show 2.5).
        function axisTicks(maxVal, bands, forceInt) {
          var step = niceStep(maxVal / Math.max(1, bands));
          if (forceInt) step = Math.max(1, Math.round(step));
          var top = Math.ceil(maxVal / step) * step;
          var ticks = [];
          for (var v = top; v > -1e-9; v -= step) ticks.push(Math.round(v * 10000) / 10000);
          return { top: top, step: step, ticks: ticks };
        }
        function fmtAxisUsd(v) {
          if (v >= 1000) return fmtUsd(v);
          return '$' + String(Math.round(v * 100) / 100);
        }
        function metricValues(m) {
          if (m === 'spend') return DATA.days.map(function (d) { return d.cost; });
          if (m === 'requests') return DATA.days.map(function (d) { return d.requests; });
          if (m === 'tokens') return DATA.days.map(function (d) { return d.tokens; });
          var vals = (DATA.completions || []).map(function (d) { return m === 'suggested' ? d.suggested : d.approved; });
          // zero-fill so every day bucket has a value (lifetime ranges differ)
          while (vals.length < DATA.days.length) vals.push(0);
          return vals;
        }
        function metricFmt(m) {
          if (m === 'spend') return fmtUsd;
          return fmtCount;
        }
        function metricUnit(m) {
          if (m === 'spend') return '';
          if (m === 'requests') return ' requests';
          if (m === 'tokens') return ' tokens';
          return m === 'suggested' ? ' suggestions' : ' approvals';
        }
        function metricColor(m) {
          return m === 'spend' ? '#e3b341' : m === 'requests' ? '#5aa9ff' : m === 'tokens' ? '#3fdbb0' : m === 'suggested' ? '#a98ef9' : '#7fd1a8';
        }
        function metricTotal(m) {
          var vals = metricValues(m);
          return vals.reduce(function (a, b) { return a + b; }, 0);
        }
        function showTooltip(x, y, html) {
          ttip.innerHTML = html;
          ttip.style.display = 'block';
          var r = box.getBoundingClientRect();
          var px = x - r.left + 16, py = y - r.top + 14;
          if (px + 220 > r.width) px = x - r.left - 220;
          if (py + 60 > r.height) py = y - r.top - 60;
          ttip.style.left = px + 'px';
          ttip.style.top = py + 'px';
        }
        function hideTooltip() { ttip.style.display = 'none'; }

        function drawLine(m) {
          var W = box.clientWidth, H = box.clientHeight;
          if (!W || !H) return;
          svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
          clear();
          var padL = 44, padR = 10, padT = 12, padB = 24;
          var plotW = Math.max(1, W - padL - padR), plotH = Math.max(1, H - padT - padB);
          var vals = metricValues(m);
          var maxVal = niceMax(Math.max.apply(null, vals) * 1.15);
          var isCount = m === 'suggested' || m === 'approved';
          var axis = axisTicks(maxVal, 4, isCount);
          maxVal = axis.top;
          var color = metricColor(m);
          var fmt = metricFmt(m), unit = metricUnit(m);
          var fmtAxis = m === 'spend' ? fmtAxisUsd : fmt;
          function daySub(day) {
            if (isCount) {
              var c = { suggested: 0, approved: 0 };
              (DATA.completions || []).forEach(function (d) { if (d.dayStart === day.dayStart) c = d; });
              return fmtCount(c.suggested) + ' suggestions · ' + fmtCount(c.approved) + ' approved';
            }
            return fmtCount(day.tokens) + ' tokens · ' + fmtCount(day.requests) + ' requests';
          }
          var n = DATA.days.length;

          var defs = el('defs', {});
          var grad = el('linearGradient', { id: 'grad', x1: '0', y1: '0', x2: '0', y2: '1' });
          grad.appendChild(el('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '0.30' }));
          grad.appendChild(el('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0' }));
          defs.appendChild(grad);
          svg.appendChild(defs);

          axis.ticks.forEach(function (v) {
            var gy = padT + plotH - (v / maxVal) * plotH;
            svg.appendChild(el('line', { x1: padL, y1: gy, x2: W - padR, y2: gy, stroke: 'rgba(255,255,255,0.06)', 'stroke-width': '1' }));
            svg.appendChild(el('text', { x: padL - 8, y: gy + 3, 'text-anchor': 'end', fill: '#5b6472', 'font-size': '9' }, fmtAxis(v)));
          });

          var step = n > 1 ? plotW / (n - 1) : plotW;
          var points = DATA.days.map(function (d, i) {
            var x = padL + step * i;
            var y = padT + plotH - (vals[i] / maxVal) * plotH;
            return { x: x, y: y, v: vals[i], day: d };
          });

          var labelEvery = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(plotW / 46))));
          DATA.days.forEach(function (d, i) {
            if (i % labelEvery !== 0 && i !== n - 1) return;
            svg.appendChild(el('text', { x: padL + step * i, y: H - 6, 'text-anchor': 'middle', fill: '#5b6472', 'font-size': '9' }, dayLabel(d.dayStart)));
          });

          var pathD = points.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
          var areaD = pathD + ' L' + points[points.length - 1].x.toFixed(1) + ',' + (padT + plotH) + ' L' + points[0].x.toFixed(1) + ',' + (padT + plotH) + ' Z';
          svg.appendChild(el('path', { d: areaD, fill: 'url(#grad)', stroke: 'none' }));
          svg.appendChild(el('path', { d: pathD, fill: 'none', stroke: color, 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

          // whole-chart hover: nearest day gets a guide line, dot and tooltip
          var guide = el('line', { y1: padT, y2: padT + plotH, stroke: 'rgba(255,255,255,0.18)', 'stroke-width': '1', 'stroke-dasharray': '3 3' });
          var dot = el('circle', { r: '3.5', fill: color, stroke: '#161a20', 'stroke-width': '2' });
          var overlay = el('rect', { x: padL, y: padT, width: plotW, height: plotH, fill: 'transparent' });
          overlay.addEventListener('mousemove', function (ev) {
            var r = svg.getBoundingClientRect();
            var px = ev.clientX - r.left;
            var best = points[0], bd = Infinity;
            points.forEach(function (p) { var d = Math.abs(p.x - px); if (d < bd) { bd = d; best = p; } });
            guide.setAttribute('x1', String(best.x)); guide.setAttribute('x2', String(best.x));
            dot.setAttribute('cx', String(best.x)); dot.setAttribute('cy', String(best.y));
            svg.appendChild(guide); svg.appendChild(dot);
            showTooltip(ev.clientX, ev.clientY,
              '<span class="t-line">' + dayLabel(best.day.dayStart) + '</span><b>' + fmt(best.v) + '</b>' + unit +
              '<div class="t-sub">' + daySub(best.day) + '</div>');
          });
          overlay.addEventListener('mouseleave', function () { guide.remove(); dot.remove(); hideTooltip(); });
          svg.appendChild(overlay);
          svg.appendChild(el('line', { x1: padL, y1: padT + plotH, x2: W - padR, y2: padT + plotH, stroke: '#242a33', 'stroke-width': '1' }));
        }

        function drawModelLines() {
          var W = box.clientWidth, H = box.clientHeight;
          if (!W || !H) return;
          svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
          clear();

          // per-model daily spend, ranked by total
          var totals = {};
          var perModel = {};
          DATA.byModel.forEach(function (p) {
            totals[p.model] = (totals[p.model] || 0) + p.cost;
            (perModel[p.model] = perModel[p.model] || []).push(p);
          });
          var models = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; });
          if (models.length === 0) {
            svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: '#5b6472', 'font-size': '11' }, 'No model usage in the selected window'));
            return;
          }

          var series = models.map(function (model) {
            return {
              model: model,
              total: totals[model],
              values: DATA.days.map(function (d) {
                var hit = null;
                (perModel[model] || []).forEach(function (p) { if (p.dayStart === d.dayStart) hit = p; });
                return hit ? hit : { cost: 0, tokens: 0, requests: 0, dayStart: d.dayStart };
              }),
            };
          });
          var maxVal = niceMax(Math.max.apply(null, series.map(function (s) { return s.total; })) * 1.15);
          var axis = axisTicks(maxVal, 4);
          maxVal = axis.top;

          var padL = 44, padR = 10, padT = 12, padB = 24;
          var plotW = Math.max(1, W - padL - padR), plotH = Math.max(1, H - padT - padB);
          var n = DATA.days.length;
          var step = n > 1 ? plotW / (n - 1) : plotW;

          axis.ticks.forEach(function (v) {
            var gy = padT + plotH - (v / maxVal) * plotH;
            svg.appendChild(el('line', { x1: padL, y1: gy, x2: W - padR, y2: gy, stroke: 'rgba(255,255,255,0.06)', 'stroke-width': '1' }));
            svg.appendChild(el('text', { x: padL - 8, y: gy + 3, 'text-anchor': 'end', fill: '#5b6472', 'font-size': '9' }, fmtAxisUsd(v)));
          });
          var labelEvery = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(plotW / 46))));
          DATA.days.forEach(function (d, i) {
            if (i % labelEvery !== 0 && i !== n - 1) return;
            svg.appendChild(el('text', { x: padL + step * i, y: H - 6, 'text-anchor': 'middle', fill: '#5b6472', 'font-size': '9' }, dayLabel(d.dayStart)));
          });

          // one overlapping line per model (spend), colored per model
          series.forEach(function (s, si) {
            var color = MODEL_COLORS[si % MODEL_COLORS.length];
            var pts = s.values.map(function (p, i) {
              return { x: padL + step * i, y: padT + plotH - (p.cost / maxVal) * plotH, p: p };
            });
            var d = pts.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
            svg.appendChild(el('path', { d: d, fill: 'none', stroke: color, 'stroke-width': '1.6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
            pts.forEach(function (p, i) {
              if (p.p.cost <= 0) return;
              var c = el('circle', { cx: p.x, cy: p.y, r: '7', fill: 'transparent', stroke: 'none' });
              c.addEventListener('mousemove', function (ev) {
                showTooltip(ev.clientX, ev.clientY,
                  '<span class="t-line">' + esc(s.model) + ' · ' + dayLabel(p.p.dayStart) + '</span><b>' + fmtUsd(p.p.cost) + '</b>' +
                  '<div class="t-sub">' + fmtCount(p.p.tokens) + ' tokens · ' + fmtCount(p.p.requests) + ' requests</div>');
              });
              c.addEventListener('mouseleave', hideTooltip);
              svg.appendChild(c);
            });
          });

          svg.appendChild(el('line', { x1: padL, y1: padT + plotH, x2: W - padR, y2: padT + plotH, stroke: '#242a33', 'stroke-width': '1' }));

          // whole-chart hover: nearest day highlights every model's point and
          // lists each model's spend for that day
          var guide2 = el('line', { y1: padT, y2: padT + plotH, stroke: 'rgba(255,255,255,0.18)', 'stroke-width': '1', 'stroke-dasharray': '3 3' });
          var dots2 = [];
          var overlay2 = el('rect', { x: padL, y: padT, width: plotW, height: plotH, fill: 'transparent' });
          var modelPts = [];
          series.forEach(function (s, si) {
            var color2 = MODEL_COLORS[si % MODEL_COLORS.length];
            s.values.forEach(function (p, i) {
              modelPts.push({
                x: padL + step * i,
                y: padT + plotH - (p.cost / maxVal) * plotH,
                model: s.model,
                color: color2,
                p: p,
                i: i
              });
            });
          });
          overlay2.addEventListener('mousemove', function (ev) {
            var r = svg.getBoundingClientRect();
            var px = ev.clientX - r.left;
            var best = null, bd = Infinity;
            modelPts.forEach(function (pt) { var d = Math.abs(pt.x - px); if (d < bd) { bd = d; best = pt; } });
            if (!best) return;
            guide2.setAttribute('x1', String(best.x)); guide2.setAttribute('x2', String(best.x));
            svg.appendChild(guide2);
            dots2.forEach(function (d2) { d2.remove(); });
            dots2.length = 0;
            var lines2 = [];
            modelPts.forEach(function (pt) {
              if (pt.i !== best.i) return;
              var dd = el('circle', { cx: pt.x, cy: pt.y, r: '3.5', fill: pt.color, stroke: '#161a20', 'stroke-width': '2' });
              svg.appendChild(dd);
              dots2.push(dd);
              if (pt.p.cost > 0) lines2.push('<div class="t-sub"><span class="l-swatch" style="background:' + pt.color + ';display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px"></span>' + esc(pt.model) + ': <b>' + fmtUsd(pt.p.cost) + '</b></div>');
            });
            showTooltip(ev.clientX, ev.clientY,
              '<span class="t-line">' + dayLabel(best.p.dayStart) + '</span>' +
              (lines2.length ? lines2.join('') : '<span class="t-sub">No model spend this day</span>'));
          });
          overlay2.addEventListener('mouseleave', function () { guide2.remove(); dots2.forEach(function (d2) { d2.remove(); }); dots2.length = 0; hideTooltip(); });
          svg.appendChild(overlay2);

          // legend (up to 8 models, ranked by total spend)
          var legend = document.getElementById('legend');
          legend.innerHTML = series.slice(0, 8).map(function (s, i) {
            var color = MODEL_COLORS[i % MODEL_COLORS.length];
            return '<span class="l-item"><span class="l-swatch" style="background:' + color + '"></span>' + esc(s.model) + '</span>';
          }).join('') + (series.length > 8 ? '<span class="l-more">+' + (series.length - 8) + ' more</span>' : '');
        }

        function render(key) {
          current = key;
          var fmt = metricFmt(key), unit = metricUnit(key);
          if (key === 'models') {
            chips.innerHTML =
              '<div class="stat-chip"><div class="k">Total spend</div><div class="v">' + fmtUsd(metricTotal('spend')) + '</div></div>';
            drawModelLines();
            return;
          }
          document.getElementById('legend').innerHTML = '';
          if (key === 'suggested' || key === 'approved') {
            chips.innerHTML = '';
            drawLine(key);
            return;
          }
          var st = DATA.stats;
          var totalKey = key === 'spend' ? 'total' : key;
          chips.innerHTML =
            '<div class="stat-chip"><div class="k">' + st.today.label + '</div><div class="v">' + fmt(key === 'spend' ? st.today.cost : st.today[key]) + '</div></div>' +
            '<div class="stat-chip"><div class="k">' + st.yesterday.label + '</div><div class="v">' + fmt(key === 'spend' ? st.yesterday.cost : st.yesterday[key]) + '</div></div>' +
            '<div class="stat-chip"><div class="k">' + (key === 'spend' ? st.total.label : 'Total ' + key) + '</div><div class="v">' + fmt(key === 'spend' ? st.total.cost : st.total[key]) + '</div></div>';
          void unit;
          drawLine(key);
        }

        document.getElementById('tabs').addEventListener('click', function (e) {
          var btn = e.target.closest('.tab-btn');
          if (!btn) return;
          document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          render(btn.dataset.metric);
        });

        // rings (re-rendered on every data refresh)
        function renderRings() {
          var ringsBox = document.getElementById('rings');
          ringsBox.innerHTML = DATA.rings.map(function (r) {
            var c = 2 * Math.PI * 24;
            return '<div class="ring-card ' + r.key + '">' +
              '<div class="ring-wrap"><svg viewBox="0 0 58 58">' +
              '<circle class="ring-bg" cx="29" cy="29" r="24"></circle>' +
              '<circle class="ring-fg" cx="29" cy="29" r="24" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + c.toFixed(1) + '" data-pct="' + r.percent + '"></circle>' +
              '</svg><div class="ring-pct">' + Math.round(r.percent) + '%</div></div>' +
              '<div class="ring-info"><div class="label">' + r.label + '</div>' +
              '<div class="reset">resets in ' + r.resetsIn + '</div>' +
              '<div class="amounts"><b>' + fmtUsd(r.spent) + '</b>' + (r.limit === undefined ? ' local amount' : ' / ' + fmtUsd(r.limit)) + '</div></div></div>';
          }).join('');
          document.querySelectorAll('.ring-fg').forEach(function (circle) {
            var pct = Math.max(0, Math.min(100, parseFloat(circle.getAttribute('data-pct'))));
            var c = 2 * Math.PI * 24;
            requestAnimationFrame(function () {
              setTimeout(function () { circle.style.strokeDashoffset = String(c - (pct / 100) * c); }, 120);
            });
          });
        }

        var resizeTimer = null;
        function scheduleRedraw() {
          if (resizeTimer) cancelAnimationFrame(resizeTimer);
          resizeTimer = requestAnimationFrame(function () { render(current); });
        }
        if (window.ResizeObserver) new ResizeObserver(scheduleRedraw).observe(box);
        else window.addEventListener('resize', scheduleRedraw);

        // buttons -> extension host
        var refreshBtn = document.getElementById('btnRefresh');
        document.getElementById('btnTargets').addEventListener('click', function () { vscode.postMessage({ type: 'setTargets' }); });
        document.getElementById('btnRename').addEventListener('click', function () { vscode.postMessage({ type: 'renameProfile' }); });
        refreshBtn.addEventListener('click', function () {
          refreshBtn.textContent = 'Refreshing\u2026';
          vscode.postMessage({ type: 'refresh' });
        });

        // live data updates keep the active tab (no full page reload)
        window.addEventListener('message', function (ev) {
          var msg = ev.data;
          if (!msg || msg.type !== 'usage') return;
          DATA = msg.data;
          document.getElementById('brandName').textContent = DATA.profile;
          document.getElementById('btnRename').style.display = DATA.showRename ? '' : 'none';
          windowBtn.textContent = windowLabel(DATA.windowDays);
          refreshBtn.textContent = 'Refresh';
          renderRings();
          render(current);
        });

        document.getElementById('brandName').textContent = DATA.profile;

        // window toggle: week -> 14 days -> month -> lifetime
        var WINDOWS = [
          { days: 7, label: 'Week' },
          { days: 14, label: '14 days' },
          { days: 30, label: 'Month' },
          { days: 0, label: 'Lifetime' }
        ];
        function windowLabel(days) {
          for (var i = 0; i < WINDOWS.length; i++) if (WINDOWS[i].days === days) return WINDOWS[i].label;
          return days + ' days';
        }
        var windowBtn = document.getElementById('btnWindow');
        windowBtn.textContent = windowLabel(DATA.windowDays);
        windowBtn.addEventListener('click', function () {
          var idx = 0;
          for (var i = 0; i < WINDOWS.length; i++) if (WINDOWS[i].days === DATA.windowDays) idx = i;
          var next = WINDOWS[(idx + 1) % WINDOWS.length];
          windowBtn.textContent = next.label;
          vscode.postMessage({ type: 'window', days: next.days });
        });

        renderRings();
        render('spend');
      })();
      </script>
    </body>
    </html>
  `;
}

// ─── Status bar tooltip SVG ──────────────────────────────────────────────────
