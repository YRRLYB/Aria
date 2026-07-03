export type ProviderAccount = {
  connected: boolean;
  nickname: string | null;
  userId: string | null;
};

export type MusicProvider = {
  id: string;
  name: string;
  getAccount(): Promise<ProviderAccount>;
};
