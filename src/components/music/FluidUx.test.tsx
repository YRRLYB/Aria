import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AriaSelect } from "@/components/ui/aria-select";
import { ConfirmDialogProvider, useConfirm } from "@/components/ui/confirm-dialog";
import { LyricContextMenu } from "@/components/music/LyricContextMenu";
import { TrackContextMenuProvider, useTrackContextMenu } from "@/components/music/TrackContextMenu";
import { idleTrack } from "@/lib/trackMappers";

function ConfirmProbe() {
  const confirm = useConfirm();
  return (
    <button type="button" onClick={() => void confirm({ title: "确认删除？" })}>
      触发确认
    </button>
  );
}

describe("Apple-like fluid UX components", () => {
  it("renders AriaSelect trigger with accessible listbox attributes", () => {
    const markup = renderToStaticMarkup(
      <AriaSelect
        ariaLabel="排序方式"
        value="recent"
        onChange={vi.fn()}
        options={[
          { value: "recent", label: "最近添加" },
          { value: "title", label: "按歌名" },
        ]}
      />,
    );

    expect(markup).toContain("aria-haspopup=\"listbox\"");
    expect(markup).toContain("aria-expanded=\"false\"");
    expect(markup).toContain("最近添加");
  });

  it("renders ConfirmDialogProvider safely in SSR markup", () => {
    const markup = renderToStaticMarkup(
      <ConfirmDialogProvider>
        <ConfirmProbe />
      </ConfirmDialogProvider>,
    );

    expect(markup).toContain("触发确认");
    expect(markup).not.toContain("role=\"alertdialog\"");
  });

  it("renders TrackContextMenuProvider and LyricContextMenu safely in SSR markup", () => {
    function TrackMenuProbe() {
      const ctx = useTrackContextMenu();
      return (
        <button type="button" onContextMenu={(event) => ctx?.open(event, idleTrack)}>
          右键测试
        </button>
      );
    }

    const markup = renderToStaticMarkup(
      <TrackContextMenuProvider
        activeTrackId="idle"
        onPlayTrack={vi.fn()}
        onPlayNext={vi.fn()}
        onAddToPlaylist={vi.fn()}
        onOpenArtist={vi.fn()}
        onOpenAlbum={vi.fn()}
      >
        <TrackMenuProbe />
        <LyricContextMenu target={null} onClose={vi.fn()} />
      </TrackContextMenuProvider>,
    );

    expect(markup).toContain("右键测试");
  });
});
