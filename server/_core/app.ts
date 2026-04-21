import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import fs from "fs";
import { createServer, type Server as HttpServer } from "http";
import path from "path";
import { registerControllerApi } from "../controllerApi";
import { initWebSocket } from "../wsServer";

interface CreateAppOptions {
  nodeEnv?: string;
  serveFrontend?: boolean;
}

interface RequestWithRawBody extends Request {
  rawBody?: string;
}

function captureRawJsonBody(
  req: Request,
  _res: Response,
  buffer: Buffer
) {
  (req as RequestWithRawBody).rawBody = buffer.toString("utf8");
}

function tryRecoverParsedBody(rawBody?: string) {
  if (typeof rawBody !== "string") {
    return undefined;
  }

  const sanitized = rawBody.replace(/^\uFEFF/, "").replace(/\u0000/g, "").trim();
  if (!sanitized) {
    return {};
  }

  try {
    return JSON.parse(sanitized);
  } catch {
    return undefined;
  }
}

function jsonParseErrorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const candidate = error as
    | (Error & { status?: number; type?: string })
    | undefined;

  if (
    !candidate ||
    candidate.status !== 400 ||
    candidate.type !== "entity.parse.failed"
  ) {
    next(error);
    return;
  }

  const recoveredBody = tryRecoverParsedBody(
    (req as RequestWithRawBody).rawBody
  );
  if (recoveredBody !== undefined) {
    req.body = recoveredBody;
    next();
    return;
  }

  res.status(400).json({
    ok: false,
    error: "Malformed JSON request body",
    details: candidate.message,
  });
}

export async function createApp(
  options: CreateAppOptions = {}
): Promise<{ app: Express; server: HttpServer }> {
  const { nodeEnv = process.env.NODE_ENV, serveFrontend = true } = options;

  const app = express();
  const server = createServer(app);

  initWebSocket(server);

  app.use(
    express.json({
      verify: captureRawJsonBody,
    })
  );
  app.use(jsonParseErrorHandler);
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
