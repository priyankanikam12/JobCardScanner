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
})