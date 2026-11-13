<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as signalR from "@microsoft/signalr";
  import MetroRoute from "$lib/components/MetroRoute/MetroRoute.svelte";
  import type {
    PlayerRoute,
    Feature,
    Tag,
    Position,
    PlayerPosition,
  } from "../models/PlayerRoute";
  import TextBox from "$lib/components/TextBox/TextBox.svelte";
  import Button from "$lib/components/Button/Button.svelte";

  type HelloResponse =
    | boolean
    | { isTracked?: boolean; tracked?: boolean }
    | null;
  type AudioQueueItem = { filename: string } | { delayMs: number };

  let connection: signalR.HubConnection | null = null;
  let status = $state("Disconnected");
  let targetUsername = $state("");
  let trackedUsername = $state("");
  let trackingMessage = $state("");
  let isCheckingTracking = $state(false);

  let metroContainer = $state<HTMLElement | null>(null);
  let pipWindow = $state<Window | null>(null);
  let isPipActive = $state(false);
  let audioQueue: AudioQueueItem[] = [];
  let isPlayingAudio = false;
  let announcedStationId: string | null = null;
  let announcedNextStationId: string | null = null;
  const audioBasePath = "/audio/";

  let gpsAapi = "/api/routeHub";

  let routeData = $state({
    routeName: "",
    stations: [] as Feature[],
    currentFeatureId: null as string | null,
    headingToId: null as string | null,
    lastLeftFeatureId: null as string | null,
    playerPosition: null as Position | null,
    lineColor: "#666666",
  });

  function extractLineColor(tags: any[]): string {
    if (!Array.isArray(tags)) return "#666666";
    const transferTag = tags.find((t) =>
      (typeof t === "string" ? t : t.name)?.includes("tr:"),
    );
    return typeof transferTag === "object"
      ? transferTag?.backgroundColor || "#666666"
      : "#666666";
  }

  function getTagString(tag: Tag | string): string {
    return typeof tag === "string" ? tag : (tag.name ?? "");
  }

  function getTaggedAudioFiles(
    station: Feature | null,
    prefix: string,
  ): string[] {
    return (station?.tags ?? [])
      .filter((tag) => getTagString(tag).startsWith(`${prefix}:`))
      .flatMap((tag) => getTagString(tag).slice(prefix.length + 1).split(","))
      .map((filename) => filename.trim())
      .filter(Boolean);
  }

  function playAudioFile(filename: string): Promise<void> {
    return new Promise((resolve) => {
      const audio = new Audio(
        `${audioBasePath}${filename.replace(/\\/g, "/")}`,
      );
      audio.onended = audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
  }

  async function processAudioQueue() {
    if (isPlayingAudio) return;

    isPlayingAudio = true;
    try {
      while (audioQueue.length > 0) {
        const item = audioQueue.shift();
        if (!item) continue;

        await ("delayMs" in item
          ? new Promise((resolve) => setTimeout(resolve, item.delayMs))
          : playAudioFile(item.filename));
      }
    } finally {
      isPlayingAudio = false;
    }
  }

  function isTerminusStation(station: Feature | null): boolean {
    if (!station || routeData.stations.length < 2) return false;

    const firstStation = routeData.stations[0];
    const lastStation = routeData.stations.at(-1);
    return station.id === firstStation?.id || station.id === lastStation?.id;
  }

  function enqueueAudio(...items: AudioQueueItem[]) {
    audioQueue.push(...items);
    void processAudioQueue();
  }

  function playStationAudio(station: Feature | null) {
    const files = getTaggedAudioFiles(station, "s");
    const isTerminus = isTerminusStation(station);
    if (files.length === 0 && !isTerminus) return;

    enqueueAudio(
      ...files.map((filename) => ({ filename })),
      ...(isTerminus
        ? [{ delayMs: 2000 }, { filename: "terminus.wav" }]
        : []),
    );
  }

  function playNextStationAudio(station: Feature | null) {
    if (!station) return;

    const files = getTaggedAudioFiles(station, "cs");
    enqueueAudio(
      { filename: "next_station.wav" },
      ...files.map((filename) => ({ filename })),
    );
  }

  function updateRouteState(rawPayload: any): PlayerRoute | null {
    const data: PlayerRoute = rawPayload?.playerRoute ?? rawPayload;
    if (!data?.route) return null;

    routeData.stations = data.route.checkpoints || [];
    routeData.routeName = data.route.name || "M1";
    routeData.lineColor = extractLineColor(data.route.tags || []);
    routeData.currentFeatureId = data.currentFeature?.id ?? null;
    routeData.headingToId = data.headingTo?.id ?? null;
    routeData.lastLeftFeatureId = data.lastLeftFeatureId ?? null;
    routeData.playerPosition = data.position?.actualPosition ?? null;

    return data;
  }

  function resetRouteState() {
    routeData.currentFeatureId = null;
    routeData.headingToId = null;
    routeData.lastLeftFeatureId = null;
    announcedStationId = null;
    announcedNextStationId = null;
  }

  function getPayload<T>(rawPayload: any): T {
    return rawPayload?.playerRoute ?? rawPayload;
  }

  function handleStationUpdate(
    rawPayload: any,
    type: "current" | "next",
  ) {
    const route = updateRouteState(getPayload<PlayerRoute>(rawPayload));
    if (!route) return;

    const station = type === "current" ? route.currentFeature : route.headingTo;
    const stationId = station?.id ?? null;
    const announcedId =
      type === "current" ? announcedStationId : announcedNextStationId;

    if (!stationId || stationId === announcedId) return;

    if (type === "current") {
      announcedStationId = stationId;
      playStationAudio(station);
    } else {
      announcedNextStationId = stationId;
      playNextStationAudio(station);
    }
  }

  function registerConnectionHandlers() {
    if (!connection) return;

    connection.on("OnStation", (payload) =>
      handleStationUpdate(payload, "current"),
    );
    connection.on("OnNextStation", (payload) =>
      handleStationUpdate(payload, "next"),
    );

    connection.on("OnRouteLeave", (rawPayload) => {
      const route = getPayload<PlayerRoute>(rawPayload);
      if (routeData.routeName === route?.route?.name) resetRouteState();
    });

    connection.on("OnPositionUpdate", (rawPayload) => {
      const data: PlayerPosition = rawPayload?.playerPosition ?? rawPayload;
      routeData.playerPosition = data?.actualPosition ?? null;
    });
  }

  function createConnection(transport: signalR.HttpTransportType) {
    connection = new signalR.HubConnectionBuilder()
      .withUrl(gpsAapi, { transport })
      .withAutomaticReconnect()
      .build();
    registerConnectionHandlers();
    return connection;
  }

  async function ensureConnection() {
    if (connection?.state === signalR.HubConnectionState.Connected) {
      return connection;
    }

    try {
      const activeConnection =
        connection ??
        createConnection(signalR.HttpTransportType.ServerSentEvents);
      if (activeConnection.state === signalR.HubConnectionState.Disconnected) {
        await activeConnection.start();
      }
      status = "Connected";
      return activeConnection;
    } catch (error) {
      console.warn("SSE start failed, trying LongPolling fallback", error);
      try {
        const fallbackConnection = createConnection(
          signalR.HttpTransportType.LongPolling,
        );
        await fallbackConnection.start();
        status = "Connected";
        return fallbackConnection;
      } catch (fallbackError) {
        status = "Error connecting";
        console.error(fallbackError);
        return null;
      }
    }
  }

  async function startTracking() {
    const username = targetUsername.trim();
    if (!username) return;

    const activeConnection = await ensureConnection();
    if (!activeConnection) return;

    try {
      if (trackedUsername && trackedUsername !== username) {
        await activeConnection.invoke("UntrackUser", trackedUsername);
        trackedUsername = "";
      }

      await activeConnection.invoke("TrackUser", username);
      isCheckingTracking = true;
      trackingMessage = "";

      const helloResponse = await activeConnection.invoke<HelloResponse>(
        "Hello",
        username,
      );
      const isTracked =
        typeof helloResponse === "boolean"
          ? helloResponse
          : helloResponse?.isTracked ?? helloResponse?.tracked ?? null;

      if (isTracked === false) {
        trackedUsername = "";
        trackingMessage = `Player "${username}" is not being tracked. Please use /map show in-game and try again.`;
        return;
      }

      if (isTracked === true) {
        trackedUsername = username;
        trackingMessage = "";
        return;
      }

      throw new Error("Invalid response from the Hello method.");
    } catch (error) {
      trackedUsername = "";
      trackingMessage = `Unable to check player "${username}".`;
      console.error("Tracking check failed", error);
    } finally {
      isCheckingTracking = false;
    }
  }

  async function togglePictureInPicture() {
    if (!metroContainer) return;

    if (pipWindow) {
      pipWindow.close();
      return;
    }

    if (!("documentPictureInPicture" in window)) {
      alert("Picture in picture is not supported in this browser.");
      return;
    }

    try {
      // @ts-ignore
      pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 500,
        height: 320,
      });

      if (!pipWindow) return;

      [...document.styleSheets].forEach((styleSheet) => {
        try {
          const cssRules = [...styleSheet.cssRules]
            .map((rule) => rule.cssText)
            .join("");
          const style = document.createElement("style");
          style.textContent = cssRules;
          pipWindow?.document.head.appendChild(style);
        } catch {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.type = styleSheet.type;
          link.href = styleSheet.href || "";
          pipWindow?.document.head.appendChild(link);
        }
      });

      pipWindow.document.body.appendChild(metroContainer);
      pipWindow.document.body.style.margin = "0";
      pipWindow.document.body.style.display = "flex";
      pipWindow.document.body.style.height = "100vh";
      isPipActive = true;

      pipWindow.addEventListener("pagehide", () => {
        const mainContainer = document.getElementById("metro-route-wrapper");
        if (mainContainer && metroContainer) {
          mainContainer.appendChild(metroContainer);
        }
        pipWindow = null;
        isPipActive = false;
      });
    } catch (err) {
      console.error("Picture-in-picture error:", err);
    }
  }

  onMount(async () => {
    if (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    ) {
      gpsAapi = "https://localhost:7194/routeHub";
    }
  });

  onDestroy(() => {
    pipWindow?.close();
    connection?.stop();
  });
</script>

<main>
  <p><strong>Status:</strong> {status}</p>

  <div>
    <div style="display: flex; gap: 0.5rem; margin-bottom: 12px;">
      <TextBox
        bind:value={targetUsername}
        placeholder="Username"
        oninput={() => (targetUsername = targetUsername.trim())}
      />
      <Button
        onclick={startTracking}
        disabled={!targetUsername.trim() || isCheckingTracking}
      >
        {isCheckingTracking ? "Checking..." : "Track"}
      </Button>
      <Button onclick={togglePictureInPicture}>
        {isPipActive ? "Close PiP" : "Open PiP"}
      </Button>
    </div>
    {#if trackedUsername}
      <p style="margin-top: 0.5rem; color: green; font-size: 0.9rem;">
        Tracking: <strong>{trackedUsername}</strong>
      </p>
    {/if}
    {#if trackingMessage}
      <p style="margin-top: 0.5rem; color: #b42318; font-size: 0.9rem;">
        {trackingMessage}
      </p>
    {/if}
  </div>

  <div id="metro-route-wrapper">
    <div bind:this={metroContainer} id="metro-route-container">
      <MetroRoute
        routeName={routeData.routeName}
        stations={routeData.stations}
        currentFeatureId={routeData.currentFeatureId}
        headingToId={routeData.headingToId}
        lastLeftFeatureId={routeData.lastLeftFeatureId}
        playerPosition={routeData.playerPosition}
        lineColor={routeData.lineColor}
      />
    </div>
  </div>
</main>
