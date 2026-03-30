import express, { type Express } from "express";
import fs from "fs";
import { createServer, type Server as HttpServer } from "http";
import path from "path";
import { registerControllerApi } from "../controllerApi";
import { initWebSocket } from "../wsServer";

interface CreateAppOptions {
  nodeEnv?: string;
  serveFrontend?: boolean;
}

export async function createApp(
  options: CreateAppOptions = {}
): Promise<{ app: Express; server: HttpServer }> {
  const { nodeEnv = process.env.NODE_ENV, serveFrontend = true } = options;

  const app = express();
  const server = createServer(app);

  initWebSocket(server);

  app.use(express.json());
  registerControllerApi(app);

  app.get("/api/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  if (serveFrontend) {
    if (nodeEnv === "development") {
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
  }

  return { app, server };
}
