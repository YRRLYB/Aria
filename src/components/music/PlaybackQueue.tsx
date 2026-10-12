import { useEffect, useRef } from "react";
import { ListPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueueList } from "@/components/music/PlayerSidePanels";
import type { Track } from "@/data/music";
import { usePlaylistActions } from "./PlaylistActions";

export function PlaybackQueue({ tracks, activeTrackId, onPickTrack, onClose }: {
  tracks: Track[];
  activeTrackId: string;
  onPickTrack: (id: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const playlistActions = usePlaylistActions();
  const neteaseTracks = tracks.filter((track) => track.source === "netease");
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="playback-queue-dialog"
      aria-labelledby="playback-queue-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
    >
      <div className="playback-queue-content">
        <div className="home-section-heading">
          <div><p className="section-eyebrow">UP NEXT · {tracks.length}</p><h2 id="playback-queue-title">播放队列</h2></div>
          <div className="flex items-center gap-2">{neteaseTracks.length > 0 && <Button variant="glass" size="sm" onClick={() => playlistActions?.openAdd(neteaseTracks)}><ListPlus />加入歌单</Button>}<Button autoFocus variant="ghost" size="icon" aria-label="关闭播放队列" onClick={onClose}><X /></Button></div>
        </div>
        <QueueList tracks={tracks} activeTrackId={activeTrackId} onPickTrack={onPickTrack} />
      </div>
    </dialog>
  );
}
