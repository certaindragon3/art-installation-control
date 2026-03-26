const phase = process.argv[2] ?? "build";

const sections = {
  build: {
    required: ["VITE_APP_ID", "VITE_OAUTH_PORTAL_URL"],
    optional: [
      "VITE_FRONTEND_FORGE_API_URL",
      "VITE_FRONTEND_FORGE_API_KEY",
      "VITE_ANALYTICS_ENDPOINT",
      "VITE_ANALYTICS_WEBSITE_ID",
    ],
    title: "build-time",
  },
  runtime: {
    required: ["JWT_SECRET", "DATABASE_URL", "OAUTH_SERVER_URL"],
    optional: ["OWNER_OPEN_ID", "BUILT_IN_FORGE_API_URL", "BUILT_IN_FORGE_API_KEY"],
    title: "runtime",
  },
};

if (!(phase in sections)) {
  console.error(`[deploy-check] Unknown phase "${phase}". Use "build" or "runtime".`);
  process.exit(1);
}

const current = sections[phase];

const missingRequired = current.required.filter((key) => {
  const value = process.env[key];
  return !value || value.trim().length === 0;
});

const missingOptional = current.optional.filter((key) => {
  const value = process.env[key];
  return !value || value.trim().length === 0;
});

if (phase === "runtime") {
  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (jwtSecret && jwtSecret.length < 32) {
    console.warn(
      "[deploy-check] JWT_SECRET is shorter than 32 characters. Use a stronger secret in production."
    );
  }
}

if (missingRequired.length > 0) {
  console.error(`[deploy-check] Missing required ${current.title} env vars:`);
  for (const key of missingRequired) {
    console.error(`- ${key}`);
  }
  if (phase === "build") {
    console.error(
      "[deploy-check] Build will produce an unusable OAuth login flow without these values."
    );
  } else {
    console.error(
      "[deploy-check] Runtime auth and database features will fail without these values."
    );
  }
  process.exit(1);
}

if (missingOptional.length > 0) {
  console.warn(`[deploy-check] Optional ${current.title} env vars not set:`);
  for (const key of missingOptional) {
    console.warn(`- ${key}`);
  }
}

if (phase === "runtime") {
  console.warn(
    "[deploy-check] Zeabur reminder: keep this service on a single replica. Socket.IO state is stored in memory."
  );
  console.warn(
    "[deploy-check] Zeabur reminder: run `corepack pnpm db:migrate` after DATABASE_URL is configured."
  );
}

console.log(`[deploy-check] ${current.title} env check passed.`);
