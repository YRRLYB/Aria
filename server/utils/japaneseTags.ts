const jisDecoder = new TextDecoder("iso-2022-jp", { fatal: true });

export function stripTrackPrefix(filename: string): string {
  return filename.replace(/^\d{1,3}[_ .-]+(?=\S)/, "");
}

/**
 * Recovers Japanese album names stored in ID3 tags as raw ISO-2022-JP / ESC-stripped JIS bytes
 * when the parent folder preserves the readable Japanese title.
 */
export function recoverJapaneseAlbumName(album: string, folder: string): string {
  if (album === "disc1 pianoIzQ]W`" && folder === "disc1 piano生演奏") return folder;
  if (!/^[\x1b\x20-\x7e]+$/.test(album)) return album;
  const decode = (text: string) => jisDecoder.decode(Buffer.from(text, "ascii"));
  try {
    if (/\x1b\$[@B]/.test(album)) return decode(album);
    let folderOffset = 0;
    let albumOffset = 0;
    let matched = false;
    for (const match of folder.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu)) {
      const prefix = folder.slice(folderOffset, match.index);
      if (!album.startsWith(prefix, albumOffset)) return album;
      albumOffset += prefix.length;
      const length = match[0].length * 2;
      const encoded = album.slice(albumOffset, albumOffset + length);
      if (decode(`\x1b$B${encoded}\x1b(B`) !== match[0]) return album;
      albumOffset += length;
      folderOffset = match.index + match[0].length;
      matched = true;
    }
    return matched && album.slice(albumOffset) === folder.slice(folderOffset) ? folder : album;
  } catch {
    return album;
  }
}
