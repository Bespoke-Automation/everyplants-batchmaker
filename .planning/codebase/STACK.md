# Technology Stack

**Analysis Date:** 2026-02-24

## Languages

**Primary:**
- TypeScript 5.8.2 - All application code (`src/**/*.ts`, `src/**/*.tsx`)

**Secondary:**
- JavaScript - Config files only (`next.config.js`, `postcss.config.js`)

## Runtime

**Environment:**
- Node.js v21.5.0 (detected from running environment)
- Browser (React components, client-side hooks)

**Package Manager:**
- npm (scripts defined in `package.json`)
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Next.js 16.1.1 - App Router, API routes, server components, middleware
- React 19.2.3 - UI library for all components

**Build/Dev:**
- TypeScript 5.8.2 - Type checking (`tsc --noEmit`)
- PostCSS 8.4.47 - CSS processing (`postcss.config.js`)
- Tailwind CSS 3.4.17 - Utility-first CSS (`tailwind.config.ts`)
- tsx 4.21.0 - TypeScript execution for scripts
- dotenv 17.3.1 - Environment variable loading in scripts

## Key Dependencies

**Critical:**
- `@supabase/supabase-js` 2.90.1 - Database client (PostgreSQL via Supabase)
- `inngest` 3.49.1 - Event-driven background job processing
- `pdf-lib` 1.17.1 - PDF manipulation for shipping label editing and merging

**UI/Interaction:**
- `@dnd-kit/core` 6.3.1 - Drag and drop core primitives
- `@dnd-kit/sortable` 10.0.0 - Sortable DnD extension
- `@dnd-kit/utilities` 3.2.2 - DnD helper utilities
- `lucide-react` 0.562.0 - SVG icon library

**Fonts:**
- Geist Sans and Geist Mono (configured in `tailwind.config.ts`, loaded via Next.js font system)

**Dev/Scripts:**
- `xlsx` 0.18.5 (devDependency) - Used for data import/export scripts

## Configuration

**TypeScript (`tsconfig.json`):**
- Target: `es2017`
- Module resolution: `bundler`
- Strict mode: enabled
- Path alias: `@/*` maps to `./src/*`
- JSX: `react-jsx`
- `isolatedModules`: true

**Tailwind (`tailwind.config.ts`):**
- Dark mode: `class`-based
- Custom color palette: primary `#023c2d` (dark green), destructive, muted, accent
- Custom fonts: Geist Sans, Geist Mono
- Custom border radius scale
- Scans: `./src/**/*.{js,ts,jsx,tsx,mdx}`

**Next.js (`next.config.js`):**
- `reactStrictMode: true`
- No custom webpack config
- No image domain config

**Environment:**
- Configuration via `.env.local` (file present, contents not read)
- Required vars grouped by service: App, Supabase, Picqer, Floriday
- See INTEGRATIONS.md for full env var list per service

**Build:**
- `npm run build` → `next build`
- `npm run dev` → `next dev`
- `npm run lint` → `next lint`

## Platform Requirements

**Development:**
- Node.js 21+ (v21.5.0 confirmed)
- npm as package manager
- `.env.local` with all required environment variables

**Production:**
- Next.js-compatible hosting (Vercel, self-hosted, etc.)
- Server-side rendering required (uses `export const dynamic = 'force-dynamic'` on all API routes)
- Inngest cloud service or self-hosted for background jobs
- Supabase project (PostgreSQL database + Storage)
- Access to Picqer and Floriday API credentials

---

*Stack analysis: 2026-02-24*
