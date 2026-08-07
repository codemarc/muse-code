/** Muse Code CLI currently ships for macOS and Linux only. */
export function isSupportedPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin" || platform === "linux";
}

export function unsupportedPlatformMessage(
  platform: NodeJS.Platform = process.platform,
): string {
  return `Muse Code CLI is not available on ${platform}. Use macOS or Linux.`;
}
