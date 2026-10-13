import type { SongCreatorRole, SongWikiItem, SongWikiSection } from "../../src/lib/songEncyclopedia";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[entity] ?? entity).trim().slice(0, 5000);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uiText(value: unknown, includeTitle = true) {
  const ui = record(value);
  return unique([
    ...(includeTitle ? [text(record(ui.mainTitle).title)] : []),
    ...list(ui.subTitles).map((item) => text(record(item).title)),
    ...list(ui.textLinks).map((item) => text(record(item).text)),
    ...list(ui.labels).map((item) => typeof item === "string" ? text(item) : text(record(item).text ?? record(item).title)),
  ]);
}

function descriptions(value: unknown) {
  return unique(list(record(value).descriptions).map((item) => typeof item === "string" ? text(item) : text(record(item).description)));
}

/** Keep encyclopedia facts only; the same API also returns recommendations. */
export function normalizeSongWiki(body: unknown): SongWikiSection[] {
  const data = record(record(body).data);
  const sections: SongWikiSection[] = [];
  for (const entry of list(data.blocks)) {
    const block = record(entry);
    if (block.code !== "SONG_PLAY_ABOUT_SONG_BASIC" && block.showType !== "SONG_PLAY_ABOUT_TAB_SONG_BASIC") continue;
    const items: SongWikiItem[] = [];
    for (const entry of list(block.creatives)) {
      const creative = record(entry);
      // Comments and interactive sheet previews are not encyclopedia facts.
      if (["songComment", "sheet"].includes(String(creative.creativeType))) continue;
      const ui = record(creative.uiElement);
      const label = text(record(ui.mainTitle).title);
      if (!label) continue;
      const resources = list(creative.resources).map(record).filter((item) => item.valid !== false);
      const values = unique([...uiText(ui, false), ...resources.flatMap((item) => uiText(item.uiElement))]);
      const detail = unique([...descriptions(ui), ...resources.flatMap((item) => descriptions(item.uiElement))]);
      if (values.length || detail.length) items.push({ label, values: values.slice(0, 30), descriptions: detail.slice(0, 10) });
    }
    if (items.length) sections.push({ title: text(record(record(block.uiElement).mainTitle).title) || "音乐百科", items: items.slice(0, 20) });
  }
  return sections;
}

export function normalizeSongCreators(body: unknown): SongCreatorRole[] {
  const roles: SongCreatorRole[] = [];
  for (const entry of list(record(record(body).data).songCreatorsRoleVos)) {
    const group = record(entry);
    const role = text(group.roleName);
    const creators = unique(list(group.creatorMetaVOS).map((item) => text(record(item).artistName))).map((name) => ({ name }));
    if (role && creators.length) roles.push({ role, creators: creators.slice(0, 30) });
  }
  return roles.slice(0, 30);
}
