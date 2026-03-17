import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import selfsigned from 'selfsigned';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv, type PluginOption } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getLanIps() {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const list of Object.values(nets)) {
    for (const item of list || []) {
      if (item && item.family === 'IPv4' && !item.internal) {
        ips.push(item.address);
      }
    }
  }
  return Array.from(new Set(ips));
}

async function ensureDevHttpsCert(rootDir: string) {
  const certDir = path.resolve(rootDir, '.devcert');
  const keyPath = path.join(certDir, 'dev-key.pem');
  const certPath = path.join(certDir, 'dev-cert.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
  }
  fs.mkdirSync(certDir, { recursive: true });
  const altNames = [
    { type: 2 as const, value: 'localhost' },
    { type: 7 as const, ip: '127.0.0.1' },
    ...getLanIps().map((ip) => ({ type: 7 as const, ip })),
  ];
  const attrs = [{ name: 'commonName', value: 'MeowLingo Dev Cert' }];
  const pems = await selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  } as any);
  fs.writeFileSync(keyPath, pems.private, 'utf8');
  fs.writeFileSync(certPath, pems.cert, 'utf8');
  return {
    key: Buffer.from(pems.private, 'utf8'),
    cert: Buffer.from(pems.cert, 'utf8'),
  };
}

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const enableDevHttps = (env.VITE_DEV_HTTPS ?? 'true').toLowerCase() !== 'false';
  const envLocalPath = path.resolve(__dirname, '.env.local');
  let localGeminiApiKey = '';
  let localGeminiLiveModel = '';
  let localGeminiLiveModelFallback = '';
  if (fs.existsSync(envLocalPath)) {
    const localEnv = dotenv.parse(fs.readFileSync(envLocalPath));
    localGeminiApiKey = localEnv.GEMINI_API_KEY ?? '';
    localGeminiLiveModel = localEnv.GEMINI_LIVE_MODEL ?? '';
    localGeminiLiveModelFallback = localEnv.GEMINI_LIVE_MODEL_FALLBACK ?? '';
  }
  const geminiApiKey = localGeminiApiKey || env.GEMINI_API_KEY;
  const geminiLiveModel = localGeminiLiveModel || env.GEMINI_LIVE_MODEL;
  const geminiLiveModelFallback =
    localGeminiLiveModelFallback || env.GEMINI_LIVE_MODEL_FALLBACK;
  const plugins: PluginOption[] = [react(), tailwindcss()];
  const httpsConfig = enableDevHttps ? await ensureDevHttpsCert(__dirname) : undefined;
  return {
    plugins,
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(geminiApiKey),
      'process.env.GEMINI_LIVE_MODEL': JSON.stringify(geminiLiveModel),
      'process.env.GEMINI_LIVE_MODEL_FALLBACK': JSON.stringify(geminiLiveModelFallback),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: ['.loca.lt'],
      port: 3000,
      strictPort: true,
      https: httpsConfig,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8011',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
      },
    },
  };
});
