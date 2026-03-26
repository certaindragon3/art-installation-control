import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { serveStatic, setupVite } from "./vite";
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
    await setupVite(app, server);
  } else {
    serveStatic(app);
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
