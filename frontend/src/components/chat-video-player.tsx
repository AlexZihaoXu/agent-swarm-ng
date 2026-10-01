import type { CSSProperties, ReactNode } from 'react';
import '@videojs/react/video/skin.css';
import { PlaybackRateButton } from '@videojs/react';
import { Video, VideoPlayer, VideoSkin } from '@videojs/react/video';

/**
 * A chat video, played with Video.js v10's default skin (loaded on demand: only chats with videos fetch it). It
 * loads only the metadata until played, so the first frame shows without downloading the whole file. The card's
 * name bar (`renderBar`) carries a speed button: each click steps through Video.js's rates (0.2× to 2×, as in the
 * skin's Settings → Speed, which v10 does not let us change yet).
 */
export default function ChatVideoPlayer({
  src,
  name,
  renderBar,
}: {
  src: string;
  name: string;
  renderBar: (speed: ReactNode) => ReactNode;
}) {
  return (
    <VideoPlayer>
      {renderBar(
        <PlaybackRateButton
          render={(props, state) => (
            <button
              {...props}
              type="button"
              title="Playback speed: click for the next"
              className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            >
              {Math.round(state.rate * 10) / 10}×
            </button>
          )}
        />,
      )}
      <VideoSkin
        style={
          {
            width: '100%',
            aspectRatio: '16 / 9',
            '--media-border-radius': '0',
            '--media-border-color': 'transparent',
            '--media-object-fit': 'contain',
          } as CSSProperties
        }
      >
        <Video src={src} preload="metadata" playsInline aria-label={`Video: ${name}`} />
      </VideoSkin>
    </VideoPlayer>
  );
}
