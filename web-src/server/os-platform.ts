export function isWsl(platform: NodeJS.Platform, release: string): boolean {
  return platform === "linux" && /wsl/i.test(release);
}
