import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryPlugin = sentryAuthToken
	? sentryVitePlugin({
			org: "quadball",
			project: "javascript-react",
			authToken: sentryAuthToken,
			telemetry: false,
		})
	: null;

// Support subpath deployments via VITE_BASE_PATH env var (e.g., /trading-cards)
const basePath = process.env.VITE_BASE_PATH || '/';

// CloudFront Router URL for proxying API/media in dev mode
const routerUrl = 'https://dn5m00m19yfre.cloudfront.net';

export default defineConfig({
	base: basePath,
	plugins: [react(), tailwindcss(), ...(sentryPlugin ? [sentryPlugin] : [])],
	build: {
		sourcemap: Boolean(sentryAuthToken),
	},
	server: {
		proxy: {
			'/api': { target: routerUrl, changeOrigin: true },
			'/r': { target: routerUrl, changeOrigin: true },
			'/c': { target: routerUrl, changeOrigin: true },
		},
	},
});
