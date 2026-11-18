/** Muse Code CLI ships for macOS, Linux and Windows. */
export function isSupportedPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin" || platform === "linux" || platform === "win32";
}

export function unsupportedPlatformMessage(
  platform: NodeJS.Platform = process.platform,
): string {
  return `Muse Code CLI is not available on ${platform}. Use macOS, Linux or Windows.`;
}
