export function sizedCoverUrl(url: string | undefined, size: 320 | 768): string | undefined {
  if (!url || !/\/api\/library\/tracks\/[^/?]+\/cover(?:\?|$)/.test(url)) return url;
  const [base, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.set("size", String(size));
  return `${base}?${params}`;
}
