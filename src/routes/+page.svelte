<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as signalR from "@microsoft/signalr";
  import MetroRoute from "$lib/components/MetroRoute/MetroRoute.svelte";
  import type {
    PlayerRoute,
    Feature,
    Position,
    PlayerPosition,
  } from "../models/PlayerRoute";
  import TextBox from "$lib/components/TextBox/TextBox.svelte";
  import Button from "$lib/components/Button/Button.svelte";

  let connection: signalR.HubConnection | null = null;
  let status = $state("Disconnected");
  let targetUsername = $state("");
  let trackedUsername = $state("");

  let metroContainer = $state<HTMLElement | null>(null);
  let pipWindow = $state<Window | null>(null);
  let isPipActive = $state(false);

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
      (typeof t === "string" ? t : t.name)?.includes("->"),
    );
    return typeof transferTag === "object"
      ? transferTag?.backgroundColor || "#666666"
      : "#666666";
  }

  function playAudioFile(filename: string): Promise<void> {
    return new Promise((resolve) => {
      const audio = new Audio(`/audio/${filename}`);
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
  }

  async function playAnnouncement(prefixFile: string, stationName: string) {
    const formattedName = stationName.toLowerCase().replace(/\s+/g, "_");
    await playAudioFile(prefixFile);
    await playAudioFile(`${formattedName}.mp3`);
  }

  function updateRouteState(rawPayload: any) {
    const data: PlayerRoute = rawPayload?.playerRoute ?? rawPayload;
    if (!data?.route) return;

    routeData.stations = data.route.checkpoints || [];
    routeData.routeName = data.route.name || "M1";
    routeData.lineColor = extractLineColor(data.route.tags || []);
    routeData.currentFeatureId = data.currentFeature?.id ?? null;
    routeData.headingToId = data.headingTo?.id ?? null;
    routeData.lastLeftFeatureId = data.lastLeftFeatureId ?? null;
    routeData.playerPosition = data.position?.actualPosition ?? null;
  }

  function registerConnectionHandlers() {
    if (!connection) return;

    connection.on("OnStation", (rawPayload) => {
      const data: PlayerRoute = rawPayload?.playerRoute ?? rawPayload;
      updateRouteState(data);
    });

    connection.on("OnNextStation", (rawPayload) => {
      const data: PlayerRoute = rawPayload?.playerRoute ?? rawPayload;
      updateRouteState(data);
    });

    connection.on("OnRouteLeave", (rawPayload) => {
      if (routeData.routeName === rawPayload?.playerRoute?.route?.name) {
        routeData.currentFeatureId = null;
        routeData.headingToId = null;
        routeData.lastLeftFeatureId = null;
      }
    });

    connection.on("OnPositionUpdate", (rawPayload) => {
      const data: PlayerPosition = rawPayload?.playerPosition ?? rawPayload;
      routeData.playerPosition = data?.actualPosition ?? null;
    });
  }

  async function ensureConnection() {
    if (connection?.state === signalR.HubConnectionState.Connected) return connection;

    if (!connection) {
      // prefer Server-Sent Events transport; fall back to LongPolling if SSE fails
      connection = new signalR.HubConnectionBuilder()
        .withUrl(gpsAapi, { transport: signalR.HttpTransportType.ServerSentEvents })
        .withAutomaticReconnect()
        .build();
      registerConnectionHandlers();
    }

    try {
      if (connection.state === signalR.HubConnectionState.Disconnected) {
        await connection.start();
      }
      status = "Connected";
      return connection;
    } catch (err) {
      console.warn("SSE start failed, trying LongPolling fallback", err);
      // Try fallback to LongPolling
      try {
        connection = new signalR.HubConnectionBuilder()
          .withUrl(gpsAapi, { transport: signalR.HttpTransportType.LongPolling })
          .withAutomaticReconnect()
          .build();
        registerConnectionHandlers();
        await connection.start();
        status = "Connected";
        return connection;
      } catch (err2) {
        status = "Error connecting";
        console.error(err2);
        return null;
      }
    }
  }

  async function startTracking() {
    if (!targetUsername.trim()) return;

    const activeConnection = await ensureConnection();
    if (!activeConnection) return;

    if (trackedUsername) {
      await activeConnection.invoke("UntrackUser", trackedUsername);
    }

    await activeConnection.invoke("TrackUser", targetUsername.trim());
    trackedUsername = targetUsername.trim();
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
      pipWindow.document.body.style.minHeight = "100vh";
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
      console.error("Błąd Picture-in-Picture:", err);
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
      <Button onclick={startTracking} disabled={!targetUsername.trim()}>
        Track
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
