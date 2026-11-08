import { defineConfig, loadEnv, type Plugin } from 'vite';

export default defineConfig(({ mode }) => {
  // Both knobs are local business: a dev hostname or a tunnel origin belongs to
  // whoever runs the machine, not to the repository. They come from
  // frontend/.env.local (gitignored) or from the shell.
  const env = loadEnv(mode, process.cwd(), 'LIGHTGRAM_');

  // In development the editor (:5174) and the card server (:8080) are different
  // origins, and only the server can answer a link with document metadata. The
  // page therefore has to *declare* where that server lives, or an embedded link
  // copied from here would point at Vite and never unfurl.
  const serverPort = Number(env.LIGHTGRAM_SERVER_PORT ?? 8080);
  const serverOrigin = env.LIGHTGRAM_SERVER_ORIGIN ?? `http://localhost:${serverPort}`;
  const extraHosts = (env.LIGHTGRAM_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host !== '');

  function declareServerOrigin(): Plugin {
    return {
      name: 'lightgram:server-origin',
      apply: 'serve',
      transformIndexHtml: () => [
        {
          tag: 'meta',
          attrs: { name: 'lightgram-embedded-origin', content: serverOrigin },
          injectTo: 'head',
        },
      ],
    };
  }

  return {
    plugins: [declareServerOrigin()],
    server: {
      port: 5174,
      // The Go server owns :8080 and proxies the app from here, so the port must
      // be the one it expects.
      strictPort: true,
      open: false,
      // A page served through the proxy lives on :8080, but hot reload talks to
      // Vite directly — no websocket proxying, no half-live reloads.
      hmr: { port: 5174, clientPort: 5174 },
      // Loopback is always allowed; a tunnel or a LAN hostname is added
      // locally, never committed.
      allowedHosts: ['localhost', '127.0.0.1', ...extraHosts],
    },
    build: {
      target: 'es2022',
      outDir: 'dist',
    },
  };
});
