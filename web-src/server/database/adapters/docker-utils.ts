import { spawnSync } from "node:child_process";

type ComposePsContainer = {
  Service?: string;
  Name?: string;
  State?: string;
};

export function resolveRunningComposeContainerName(
  serviceName: string,
  cwd: string,
): string | null {
  const proc = spawnSync(
    "docker",
    ["compose", "ps", "--format", "json", "--status", "running"],
    { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"], cwd },
  );
  if (proc.status !== 0) return null;
  try {
    const output = proc.stdout.trim();
    const containers: ComposePsContainer[] = output.startsWith("[")
      ? JSON.parse(output)
      : output
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
    const match = containers.find(
      (c) => c.Service === serviceName && c.State === "running",
    );
    return match?.Name || null;
  } catch {
    return null;
  }
}
