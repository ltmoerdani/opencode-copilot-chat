**Status:** ✅ Solved

# Extension Icon Redesign — OpenCode Brand Identity

**Topic:** branding / icon / visual-identity
**Updated:** 2026-06-08
**Tags:** #branding #icon #svg #vscode-extension #opencode

---

## Overview

Replaced the generic `</>` code-bracket extension icon with a creative, brand-aligned design that represents the OpenCode identity. The new icon features the official OpenCode Mark with glow effects, gradient styling, and sparkle accents on a dark futuristic background.

---

## Problem

The original extension icon was a generic code-editor design:

- Navy background (#0F172A) with a hexagon shape
- Blue/purple `</>` code brackets with a slash
- Did not represent the OpenCode brand or identity
- Looked like any other code-related VS Code extension

This was not representative of OpenCode as a product, making the extension indistinguishable in the VS Code marketplace.

---

## Research

### OpenCode Brand Discovery

Investigated the official OpenCode brand assets:

| Source                                          | Finding                                                  |
| ----------------------------------------------- | -------------------------------------------------------- |
| `opencode.ai/brand`                             | Official brand page with logo/wordmark downloads         |
| `anomalyco/opencode` repo                       | Source code contains SVG logo components                 |
| `packages/ui/src/components/logo.tsx`           | **Mark** component — outer frame "O" shape + inner fill  |
| `packages/web/src/components/icons/custom.tsx`  | `IconOpencode` — 70×70 viewBox, dual-path shape          |
| `packages/stats/app/src/routes/stats-shell.tsx` | `OpenCodeMark` — 40×40 viewBox with 3-layer construction |
| `packages/tui/src/logo.ts`                      | ASCII art logo for terminal UI                           |

### Logo Mark Construction (from source)

The official OpenCode Mark is built from two overlapping rectangles:

1. **Outer frame** — large rectangle with a rectangular hole (forms "O" shape)
2. **Inner fill** — smaller solid rectangle (creates depth/layering)

From `packages/ui/src/components/logo.tsx`:

```tsx
<path d="M12 16H4V8H12V16Z" fill="var(--icon-weak-base)" />  // shadow
<path d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="var(--icon-strong-base)" />  // main
```

From `packages/stats/app/src/routes/stats-shell.tsx`:

```tsx
<path d="M26 29H14V17H26V29Z" fill="var(--stats-logo-fill)" />  // inner
<path d="M26 11H14V29H26V11ZM32 35H8V5H32V35Z" fill="var(--stats-logo-stroke)" />  // outer
```

---

## Solution

### Iteration 1: Exact Brand Match

First attempt replaced the `</>` bracket with the official OpenCode Mark on a plain black (#0A0A0A) background:

- Outer frame path: `M82 90H46V38H82V90ZM94 102H34V26H94V102Z` (white)
- Inner fill: `<rect>` with 25% opacity white
- Plain dark background with subtle gray border

**User feedback:** "Bukan dibuat sama seperti opencodego modelnya buat yg lebih kreatif" — requested a more creative design, not a plain copy.

### Iteration 2: Creative Brand-Aligned Design (Final)

Redesigned with multiple visual layers for a futuristic, AI-themed aesthetic while keeping the OpenCode Mark as the central element.

**Design elements:**

| Layer               | Detail                                           | Purpose                    |
| ------------------- | ------------------------------------------------ | -------------------------- |
| Background gradient | Navy (#0F172A) → Indigo (#1E1B4B) diagonal       | Depth, modern feel         |
| Grid pattern        | 6×6 grid at 4% opacity (clipped to rounded rect) | "Terminal/code" atmosphere |
| Glow ring           | Gradient border (indigo) with 30% opacity        | Frame accent               |
| OpenCode Mark       | Glow-filtered gradient fill (#818CF8 → #4F46E5)  | Brand identity with glow   |
| Inner accent        | Cyan (#38BDF8) rect at 35% opacity               | Depth, tech feel           |
| Sparkle top-right   | Blue (#38BDF8) crosshair                         | "AI/magic" accent          |
| Sparkle bottom-left | Purple (#C084FC) crosshair at 60% opacity        | Balance, flair             |
| Bottom reflection   | Gradient line (cyan→purple) at 15% opacity       | Futuristic polish          |

**SVG definitions used:**

- `linearGradient` (3): background, glow, accent
- `filter` (1): Gaussian blur glow effect
- `clipPath` (1): rounded rect for grid clipping

---

## Files Changed

| #   | File                   | Change                                                                      | Size    |
| --- | ---------------------- | --------------------------------------------------------------------------- | ------- |
| 1   | `media/opencodego.svg` | Complete redesign — old `</>` bracket → OpenCode Mark with creative effects | ~2.5 KB |
| 2   | `media/opencodego.png` | Regenerated from SVG via `rsvg-convert -w 512 -h 512`                       | 30.9 KB |

### File Size Comparison

| File             | Before  | After   | Delta                                   |
| ---------------- | ------- | ------- | --------------------------------------- |
| `opencodego.png` | 10.5 KB | 30.9 KB | +20.4 KB (gradients/effects add detail) |
| `opencodego.svg` | ~1.2 KB | ~2.5 KB | +1.3 KB (defs, gradients, filters)      |

---

## Verification

```bash
# SVG content verified
cat media/opencodego.svg  # valid SVG with gradients, filters, clip paths

# PNG regenerated
rsvg-convert -w 512 -h 512 media/opencodego.svg -o media/opencodego.png
# → 30952 bytes, 512×512 PNG

# package.json reference unchanged
grep '"icon"' package.json
# → "icon": "media/opencodego.png"  ✅ correct

# Compile still works (icon is static asset, no code change)
npm run compile
```

---

## Technical Notes

- **Tool used:** `rsvg-convert` (Homebrew `librsvg`) for SVG→PNG conversion
- **SVG viewBox:** 128×128 — standard for VS Code extension icons
- **PNG output:** 512×512 — marketplace recommended size
- **No code changes required** — `package.json` already referenced `media/opencodego.png`
- **Browser preview limitation:** VS Code integrated browser could not render `file://` SVGs due to Electron preload script errors; verified via `view_image` tool instead
- **OpenCode logo source:** `anomalyco/opencode` monorepo, `packages/ui/src/components/logo.tsx` Mark component

---

## Lessons Learned

1. **Brand research via source code:** Found official logo SVG construction by searching the `anomalyco/opencode` GitHub repo — the brand page only offered PNG/SVG downloads but the source code revealed the exact path construction.
2. **Iterative design:** First "exact copy" approach was too plain; adding gradients, glow effects, and sparkle accents made it visually distinctive while maintaining brand identity.
3. **SVG complexity trade-off:** More creative SVG means larger file size (10 KB → 31 KB PNG) but still well within marketplace limits.
