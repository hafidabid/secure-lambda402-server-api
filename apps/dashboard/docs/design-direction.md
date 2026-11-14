# SecureLambda design direction

The brief for logo and brand work. The landing page (`apps/dashboard/src/components/instrument/`) is the reference implementation; open `http://localhost:3001` to see it live.

## The product in one line

Test an AI model on data you can't access. Only the score comes out.

A model owner and a data owner each encrypt their file. A hardware enclave (a TEE) scores the model on the data, and only three rounded numbers leave. Each run is paid in NEAR, by a wallet or by an AI agent over x402. Built on NEAR Protocol.

## Who it has to convince

- **Hackathon judges** (NEAR Privacy & Private AI track): technical, skimming fast, allergic to anything that looks templated.
- **Marketing and partners:** need to grasp the idea in seconds.

## The visual world: a lab instrument

The brand looks like a precise piece of hardware, in the line of 1960s Braun and Dieter Rams: a matte warm-grey chassis, recessed slots, small status lights, one orange key, and split-flap digits that flip to show the score. It is calm, exact and physical, never glowing or futuristic.

The core idea any mark should carry: **two things go in, nothing comes out but a number.** One sealed place, one narrow way out.

### Palette

| Role | Hex | Use |
|---|---|---|
| Panel | `#E7E5E0` | page background |
| Chassis | `#D6D3CC` | raised surfaces |
| Chassis deep | `#C7C3BB` | dividers, pressed states |
| Slot | `#ECEBE7` | recessed wells |
| Ink | `#1B1B1A` | text, dark marks |
| Display | `#1D1D1B` | dark readout panels |
| Flap ink | `#F2EFE8` | light text on dark |
| Signal orange | `#E8590C` | the one accent: primary button, the brand dot |
| LED green | `#2F9E44` | status lights only |

Orange is used once per view, and never as a fill for large areas or as a gradient.

### Type

- **Barlow** (600–700): headings and UI. Tight tracking on display sizes.
- **Barlow Condensed** (600, uppercase, tracking 0.12em): small engraved labels like `ENCLAVE · TEE`.
- **Azeret Mono**: numbers, hashes and code.

### The mark

A λ in flap ink (`#F2EFE8`) on a display-dark (`#1D1D1B`) rounded tile (corner radius 13% of the side), with one orange dot as the status light at the foot of the long leg. The dot sits in a dark clearance ring that cuts the stroke. One stroke weight (about 13% of the tile), round ends and a round corner at the top.

- Files: `public/brand/securelambda-tile.svg` (also `src/app/icon.svg`, the favicon), `SecureLambdaMark` in `src/components/instrument/logos.tsx`.
- Lockup: the tile, then "SecureLambda" in Barlow Bold, gap about 30% of the tile size.
- Source: redrawn as vector from the Gemini concept (`Gemini_Generated_Image_9mvgf19mvgf19mvg.jpeg`), with colours snapped to the palette.

## What the logo needs

- **Deliverables:** a symbol, a horizontal lockup (symbol and wordmark), a favicon, and one-colour versions, all as SVG.
- **Sizes:** it must read at 16 px (favicon) and at 24 px next to the wordmark in the site header.
- **Backgrounds:** it works on panel `#E7E5E0` and on display `#1D1D1B`, in one colour (ink or flap ink) as well as with the orange accent.
- **Co-branding:** it sits next to the NEAR logo in "Built on NEAR Protocol" lockups, so it needs a similar visual weight and must not imitate NEAR's N.
- **Geometry:** rounded rectangles and circles, like the chassis and keys. Corner radius about a quarter of the shape's height.

## Directions worth exploring

1. **The output slot.** A rounded rectangle (the sealed box) with a single narrow slit and one orange dot. It says "nothing gets in or out except one thing".
2. **Instrument lambda.** A λ drawn from the chassis geometry: one stroke weight, rounded terminals, the orange dot as the status light at its apex or foot. It ties directly to the name.
3. **Two halves, one reading.** Two shapes, the data and the model, that meet at a single seam, like a split-flap tile closing. The meeting point is the only accent.

## Avoid

- Padlocks, shields, keys, fingerprints, eyes: every privacy brand uses them.
- Brains, neural-network nodes, circuit traces, sparkles.
- Gradients, glows, neon, glassmorphism, 3D chrome.
- Teal or purple "AI" colours. The brand is warm grey and orange.
- Anything that only works in colour or only above 64 px.

## Assets already in the repo

- `apps/dashboard/src/components/instrument/logos.tsx`: NEAR, Intel, Claude Code, Codex and Cursor marks (mono SVG, from thesvg.org), used on the page.
- `apps/dashboard/public/landing/case-*.webp`: the use-case illustrations, matte clay style in the same palette. A new mark should look at home next to them.
