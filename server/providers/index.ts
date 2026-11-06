import type { MusicProvider } from "./musicProvider";
import { neteaseProvider } from "./neteaseProvider";
import { qqProvider } from "./qqProvider";

const providers = [neteaseProvider, qqProvider] satisfies MusicProvider[];

export function listProviders() {
  return providers;
}

export function getProvider(id: string) {
  return providers.find((provider) => provider.id === id) ?? null;
}
