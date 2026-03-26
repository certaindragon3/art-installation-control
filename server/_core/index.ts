import "dotenv/config";
import express from "express";
import fs from "fs";
import { createServer } from "http";
import path from "path";
import { initWebSocket } from "../wsServer";

async function startServer() {
  const app = express();
  const server = createServer(app);

  initWebSocket(server);

  app.use(express.json());

  app.get("/api/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  if (process.env.NODE_ENV === "development") {
    // Dynamic import: only loaded in dev mode (via tsx, not bundled).
    // esbuild is configured with --external:./vite to prevent bundling.
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    const distPath = path.resolve(import.meta.dirname, "public");
    if (!fs.existsSync(distPath)) {
      console.error(
        `Could not find the build directory: ${distPath}, make sure to build the client first`
      );
    }
    app.use(express.static(distPath));
    app.use("*", (_req, res) => {
      res.sendFile(path.resolve(distPath, "index.html"));
    });
  }

  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  if (Number.isNaN(port)) {
    throw new Error(`Invalid PORT value: ${process.env.PORT}`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
