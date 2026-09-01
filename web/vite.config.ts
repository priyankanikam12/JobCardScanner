import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Auto-opens your default browser to the dev server as soon as `npm run dev` starts -
    // matches the backend's Properties/launchSettings.json, which does the same for the API's
    // Swagger UI (via `dotnet watch run` / Visual Studio F5). Set to false if you'd rather open
    // the tab yourself, e.g. when running multiple projects and only wanting one auto-launch.
    open: true,
  },
  build: {
    // `npm run build` writes straight into the backend's own wwwroot (a sibling folder,
    // ../backend/JobCardScanner.Api/wwwroot) instead of the default web/dist - see
    // deploy/DEPLOYMENT_GUIDE_PUBLIC_IP.md's single-site deployment: Program.cs already serves
    // wwwroot via UseStaticFiles()/MapFallbackToFile(), so this skips the manual
    // "New-Item + Copy-Item dist\* wwwroot\" merge step on every deploy - `dotnet publish`
    // just picks the built frontend straight up along with everything else in the project.
    // A nice side effect locally too: `dotnet watch run` then serves the current build of the
    // frontend directly off the API's own port, so you can sanity-check the merged single-site
    // behavior (SPA routing fallback, same-origin API calls) without deploying anything.
    outDir: fileURLToPath(new URL('../backend/JobCardScanner.Api/wwwroot', import.meta.url)),
    // Deliberately NOT emptying the output folder first (Vite's default when outDir is true).
    // wwwroot/uploads/jobcard-photos lives in this same folder tree (created at runtime by
    // Program.cs for real job-card photo uploads) - emptying outDir on every build would delete
    // any photos uploaded while testing locally against this backend. The only downside is old
    // content-hashed JS/CSS chunks from previous builds pile up under wwwroot/assets over time
    // (harmless - index.html always references the current build's files correctly) - if you
    // want a clean slate, delete wwwroot/assets by hand (never the whole wwwroot folder, or
    // you'll take uploads/ with it) before running `npm run build`.
    emptyOutDir: false,
  },
})
