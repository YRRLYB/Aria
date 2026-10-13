export type SongWikiItem = {
  label: string;
  values: string[];
  descriptions: string[];
};

export type SongWikiSection = {
  title: string;
  items: SongWikiItem[];
};

export type SongCreator = {
  name: string;
};

export type SongCreatorRole = {
  role: string;
  creators: SongCreator[];
};

export type SongEncyclopedia = {
  sections: SongWikiSection[];
  creators: SongCreatorRole[];
  unavailable: Array<"wiki" | "creators">;
};
