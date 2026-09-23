import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { createMediaPlayer } from "../views/media-player";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function getMedia(element: HTMLElement): HTMLMediaElement {
  return element.querySelector("video, audio") as HTMLMediaElement;
}

function getPlayButton(element: HTMLElement): HTMLButtonElement {
  const button = element.querySelector<HTMLButtonElement>(
    'button[aria-label="Play"], button[aria-label="Pause"]',
  );
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}

function click(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function keydown(element: HTMLElement, key: string) {
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("media player", () => {
  test("renders a video player with custom controls", () => {
    const player = createMediaPlayer(
      "/_file?path=clip.mp4",
      "video",
      "clip.mp4",
    );
    expect(player.classList.contains("kind-video")).toBe(true);
    const video = player.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("controls")).toBeNull();
    expect(player.querySelector(".gdp-media-controls")).not.toBeNull();
    expect(
      player.querySelector('button[aria-label="Enter fullscreen"]'),
    ).not.toBeNull();
  });

  test("labels the controls in the page language", () => {
    document.documentElement.lang = "ja";
    try {
      const player = createMediaPlayer(
        "/_file?path=clip.mp4",
        "video",
        "clip.mp4",
      );
      const labels = [...player.querySelectorAll("[aria-label]")].map((el) =>
        el.getAttribute("aria-label"),
      );
      expect(player.getAttribute("aria-label")).toBe("動画の再生: clip.mp4");
      expect(labels).toEqual([
        "clip.mp4",
        "再生",
        "再生位置",
        "消音",
        "音量",
        "再生速度",
        "全画面表示",
      ]);
    } finally {
      document.documentElement.lang = "";
    }
  });

  test("renders an audio player without a fullscreen button", () => {
    const player = createMediaPlayer(
      "/_file?path=song.mp3",
      "audio",
      "song.mp3",
    );
    expect(player.classList.contains("kind-audio")).toBe(true);
    expect(player.querySelector("audio")).not.toBeNull();
    expect(
      player.querySelector('button[aria-label="Enter fullscreen"]'),
    ).toBeNull();
  });

  test("play button toggles paused state", () => {
    const player = createMediaPlayer(
      "/_file?path=clip.mp4",
      "video",
      "clip.mp4",
    );
    document.body.appendChild(player);
    const media = getMedia(player);
    const button = getPlayButton(player);
    expect(media.paused).toBe(true);
    click(button);
    expect(media.paused).toBe(false);
    click(button);
    expect(media.paused).toBe(true);
  });

  test.each([
    {
      name: "a refused play shows the reason on the play button",
      failure: new DOMException("sample playback refused", "NotAllowedError"),
      title:
        "Error: playing /_file?path=clip.mp4 failed\nCaused by: NotAllowedError: sample playback refused",
      logged: 1,
    },
    {
      name: "a play cut short by pause is not a failure",
      failure: new DOMException("sample interrupted", "AbortError"),
      title: "Play",
      logged: 0,
    },
  ])("$name", async ({ failure, title, logged }) => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const player = createMediaPlayer(
        "/_file?path=clip.mp4",
        "video",
        "clip.mp4",
      );
      document.body.appendChild(player);
      const media = getMedia(player);
      media.play = () => Promise.reject(failure);
      const button = getPlayButton(player);

      click(button);
      await Promise.resolve();
      await Promise.resolve();

      expect([button.title, consoleError.mock.calls.length]).toEqual([
        title,
        logged,
      ]);
    } finally {
      consoleError.mockRestore();
    }
  });

  test("space key toggles playback", () => {
    const player = createMediaPlayer(
      "/_file?path=clip.mp4",
      "video",
      "clip.mp4",
    );
    document.body.appendChild(player);
    const media = getMedia(player);
    expect(media.paused).toBe(true);
    keydown(player, " ");
    expect(media.paused).toBe(false);
    keydown(player, " ");
    expect(media.paused).toBe(true);
  });

  test("arrow keys seek by 5 seconds", () => {
    const player = createMediaPlayer(
      "/_file?path=clip.mp4",
      "video",
      "clip.mp4",
    );
    document.body.appendChild(player);
    const media = getMedia(player);
    Object.defineProperty(media, "duration", {
      configurable: true,
      value: 120,
    });
    media.currentTime = 30;
    keydown(player, "ArrowRight");
    expect(media.currentTime).toBe(35);
    keydown(player, "ArrowLeft");
    expect(media.currentTime).toBe(30);
  });

  test("speed button cycles playback rates", () => {
    const player = createMediaPlayer(
      "/_file?path=clip.mp4",
      "video",
      "clip.mp4",
    );
    const media = getMedia(player);
    const speedButton =
      player.querySelector<HTMLButtonElement>(".gdp-media-speed");
    expect(speedButton).not.toBeNull();
    const speed = speedButton as HTMLButtonElement;
    expect(speed.textContent).toBe("1x");
    expect(media.playbackRate).toBe(1);
    click(speed);
    expect(speed.textContent).toBe("1.25x");
    expect(media.playbackRate).toBe(1.25);
    click(speed);
    expect(speed.textContent).toBe("1.5x");
    click(speed);
    expect(speed.textContent).toBe("2x");
    click(speed);
    expect(speed.textContent).toBe("1x");
  });

  test("mute button toggles muted state", () => {
    const player = createMediaPlayer(
      "/_file?path=clip.mp4",
      "video",
      "clip.mp4",
    );
    const media = getMedia(player);
    const muteButton = player.querySelector<HTMLButtonElement>(
      'button[aria-label="Mute"], button[aria-label="Unmute"]',
    );
    expect(muteButton).not.toBeNull();
    const mute = muteButton as HTMLButtonElement;
    expect(media.muted).toBe(false);
    click(mute);
    expect(media.muted).toBe(true);
    click(mute);
    expect(media.muted).toBe(false);
  });
});
