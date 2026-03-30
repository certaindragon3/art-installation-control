import "dotenv/config";
import { createApp } from "./app";

async function startServer() {
  const { server } = await createApp();

  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  if (Number.isNaN(port)) {
    throw new Error(`Invalid PORT value: ${process.env.PORT}`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
