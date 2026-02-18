# WebPeel Benchmark Showcase Video

Animated demo video showcasing WebPeel's benchmark results against 7 competitors.
Built with [Remotion](https://remotion.dev) + React + TypeScript.

## Compositions

| ID | Duration | Dimensions | Purpose |
|---|---|---|---|
| `BenchmarkShowcase` | 30s | 1920×1080 | Blog embed, main video |
| `OGVideo` | 15s | 1200×630 | Social media preview |

## Scenes (BenchmarkShowcase)

1. **0–5s** Title: "WebPeel vs 7 Alternatives · 2026 Independent Benchmark"
2. **5–15s** Animated success rate bars (staggered spring animations)
3. **15–22s** Animated content quality score bars
4. **22–28s** Key stats grid with animated counters (11 MCP Tools, $0.002/page, etc.)
5. **28–30s** CTA with terminal typing animation

## Development

```bash
# Preview in browser (hot reload)
npx remotion studio src/index.ts

# List compositions
npx remotion compositions src/index.ts
```

## Rendering

```bash
# Main video (30s, 1920×1080)
npx remotion render src/index.ts BenchmarkShowcase out/benchmark-showcase.mp4

# OG/social video (15s, 1200×630)
npx remotion render src/index.ts OGVideo out/og-video.mp4

# Poster still (frame 200 = mid success-rate scene)
npx remotion still src/index.ts BenchmarkShowcase out/poster.png --frame=200

# All at once
npm run render:all
```

## Output Files

After rendering, copy to site assets:

```bash
mkdir -p ../../assets/video
cp out/*.mp4 ../../assets/video/
cp out/*.png ../../assets/video/
```

## File Structure

```
src/
  index.ts              # Remotion entry point
  Root.tsx              # Composition registry
  constants.ts          # Colors, benchmark data
  compositions/
    BenchmarkShowcase.tsx
    OGVideo.tsx
  components/
    TitleScene.tsx       # Animated title card
    BarChartScene.tsx    # Animated bar charts (reusable)
    StatsGridScene.tsx   # Key stats with counters
    CTAScene.tsx         # Terminal typing + CTA
```

## Style Guide

- Background: `#09090B` (near-black)
- Text: `#FAFAF8` (off-white)  
- Accent: `#8B5CF6` (WebPeel purple)
- Animations: Remotion `spring()` + `interpolate()`
- FPS: 30
