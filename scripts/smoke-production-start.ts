import { spawn } from "node:child_process";

const HOST = "127.0.0.1";
const PORT = 3199;
const START_TIMEOUT_MS = 45_000;
const MAX_LOG_CHARACTERS = 12_000;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForExit(child: ReturnType<typeof spawn>, milliseconds: number) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    wait(milliseconds).then(() => undefined),
  ]);
}

async function main() {
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      HOST,
      "--port",
      String(PORT),
    ],
    {
      env: { ...process.env, FIRE_INGESTION_ENABLED: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const collect = (chunk: Buffer) => {
    output = `${output}${chunk.toString()}`.slice(-MAX_LOG_CHARACTERS);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  try {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`El servidor terminó durante el arranque.\n${output}`);
      }
      try {
        const response = await fetch(
          `http://${HOST}:${PORT}/manifest.webmanifest`,
          { signal: AbortSignal.timeout(2_000) },
        );
        if (response.ok) {
          const manifest = (await response.json()) as { name?: unknown };
          if (typeof manifest.name !== "string" || manifest.name.length === 0) {
            throw new Error("El manifiesto de producción no es válido.");
          }
          console.info("Production server smoke test passed.");
          return;
        }
      } catch {
        // The socket is expected to reject until Next.js is ready.
      }
      await wait(250);
    }
    throw new Error(
      `El servidor no estuvo listo en ${START_TIMEOUT_MS / 1_000} segundos.\n${output}`,
    );
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child, 5_000);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 2_000);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
