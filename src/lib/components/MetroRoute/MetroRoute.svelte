<script lang="ts">
  import { tick } from "svelte";
  import type { Feature, Position, Tag } from "../../../models/PlayerRoute";

  interface DistrictGroup {
    name: string;
    startIndex: number;
    count: number;
  }

  let {
    routeName = "",
    stations = [] as Feature[],
    currentFeatureId = null as string | null,
    headingToId = null as string | null,
    lastLeftFeatureId = null as string | null,
    playerPosition = null as Position | null,
    lineColor = "#666666",
    lineTextColor = "#ffffff",
    annoucementDuration = 5000,
    showDistricts = true,
    showTime = true,
    districtPrefix = "d:",
    transferPrefix = "->",
    timePrefix = "t:",
    speed = 8,
    dwellTimeSeconds = 5,
  } = $props();

  let isAnnouncementActive = $state(false);

  $effect(() => {
    if (!currentFeatureId && !headingToId) {
      isAnnouncementActive = false;
      return;
    }
    isAnnouncementActive = true;
    const timer = setTimeout(
      () => (isAnnouncementActive = false),
      annoucementDuration,
    );
    return () => clearTimeout(timer);
  });

  const getPos = (obj: Feature | Position | null): Position | null => {
    if (!obj) return null;
    if ("x" in obj) return obj as Position;
    if (obj.centerPosition) return obj.centerPosition;
    if (
      typeof obj.centerX === "number" &&
      typeof obj.centerY === "number" &&
      typeof obj.centerZ === "number"
    ) {
      return { x: obj.centerX, y: obj.centerY, z: obj.centerZ };
    }
    return null;
  };

  const getDistance = (
    a: Feature | Position | null,
    b: Feature | Position | null,
  ): number => {
    const p1 = getPos(a);
    const p2 = getPos(b);
    if (!p1 || !p2) return 0;
    return Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
  };

  let idxMap = $derived(new Map(stations.map((s, i) => [s.id, i])));
  const getIdx = (id: string | null) => (id ? (idxMap.get(id) ?? -1) : -1);

  const getTagString = (tag: Tag | string): string =>
    typeof tag === "string" ? tag : (tag.name ?? "");

  let tagRegexes = $derived({
    district: new RegExp(`^${districtPrefix}`),
    transfer: new RegExp(transferPrefix, "g"),
    time: new RegExp(`^${timePrefix}`),
  });

  const getDistrictName = (station: Feature): string | null => {
    const tag = station.tags?.find((t) =>
      getTagString(t).startsWith(districtPrefix),
    );
    return tag
      ? getTagString(tag).replace(tagRegexes.district, "").trim()
      : null;
  };

  const getManualTime = (station: Feature): string | null => {
    const tag = station.tags?.find((t) =>
      getTagString(t).startsWith(timePrefix),
    );
    if (!tag) return null;
    const val = getTagString(tag).replace(tagRegexes.time, "").trim();
    return /^\d+$/.test(val) ? `${val}'` : val;
  };

  let currentIdx = $derived(getIdx(currentFeatureId));
  let nextIdx = $derived(getIdx(headingToId));
  let lastLeftIdx = $derived(getIdx(lastLeftFeatureId));

  let currentStation = $derived(stations[currentIdx]);
  let headingToStation = $derived(stations[nextIdx]);

  let mode = $derived(
    !isAnnouncementActive
      ? 0
      : currentFeatureId !== null
        ? 1
        : headingToId !== null
          ? 2
          : 0,
  );

  let activeTags = $derived(
    (mode === 1 ? currentStation : mode === 2 ? headingToStation : null)?.tags
      ?.filter((tag) => getTagString(tag).includes(transferPrefix))
      .map((tag) => ({
        name: getTagString(tag).replace(tagRegexes.transfer, "").trim(),
        backgroundColor:
          typeof tag === "object" ? tag.backgroundColor : undefined,
        textColor: typeof tag === "object" ? tag.textColor : undefined,
      })) ?? [],
  );

  let isForward = $derived(
    lastLeftIdx !== -1 && nextIdx !== -1
      ? nextIdx >= lastLeftIdx
      : currentIdx !== -1 && nextIdx !== -1
        ? nextIdx >= currentIdx
        : nextIdx > 0 || nextIdx === -1,
  );

  // Wykrywanie strony peronu z tagów plat:l lub plat:r z uwzględnieniem kierunku pociągu
  let platformSide = $derived.by(() => {
    if (mode === 0) return null;
    const activeStation = mode === 1 ? currentStation : headingToStation;
    if (!activeStation?.tags) return null;

    const tags = activeStation.tags.map(getTagString);
    let side: "l" | "r" | null = "l";

    if (tags.includes("plat:l")) side = "l";
    else if (tags.includes("plat:r")) side = "r";
    return side;
  });

  let displayStations = $derived(
    isForward ? stations : stations.slice().reverse(),
  );

  let refIdx = $derived(
    currentIdx !== -1
      ? currentIdx
      : lastLeftIdx !== -1
        ? lastLeftIdx
        : isForward
          ? nextIdx - 1
          : nextIdx + 1,
  );

  const isPassed = (id: string) => {
    const i = getIdx(id);
    return i !== -1 && (isForward ? i <= refIdx : i >= refIdx);
  };

  let upcomingStations = $derived(
    displayStations.filter((s) => s.id === currentFeatureId || !isPassed(s.id)),
  );
  let fullRouteText = $derived(upcomingStations.map((s) => s.name).join(" - "));
  let terminalStation = $derived(upcomingStations.at(-1)?.name ?? "");

  let isOverflowing = $state(false);

  function tickerObserver(node: HTMLElement, fullText: string) {
    let resizeObs: ResizeObserver;

    async function update() {
      await tick();
      const span = node.querySelector<HTMLElement>(".ticker-content span");
      if (span) {
        isOverflowing = span.getBoundingClientRect().width > node.clientWidth;
      }
    }

    update();
    resizeObs = new ResizeObserver(update);
    resizeObs.observe(node);
    document.fonts?.ready.then(update);

    return {
      update,
      destroy() {
        resizeObs.disconnect();
      },
    };
  }

  let calculatedTimes = $derived.by(() => {
    const times = new Map<string, string>();
    if (!showTime) return times;

    let accumulatedSeconds = 0;
    let prevPoint: Feature | Position | null = playerPosition;
    const effectiveSpeed = Math.max(speed, 1);

    for (const station of displayStations) {
      const manualTime = getManualTime(station);
      if (manualTime) {
        times.set(station.id, manualTime);
        continue;
      }

      if (isPassed(station.id) && station.id !== currentFeatureId) continue;

      if (station.id === currentFeatureId) {
        times.set(station.id, "0''");
        prevPoint = station;
        accumulatedSeconds = 0;
        continue;
      }

      const dist = getDistance(prevPoint, station);
      accumulatedSeconds +=
        dist / effectiveSpeed +
        (prevPoint !== playerPosition ? dwellTimeSeconds : 0);
      times.set(station.id, `${Math.floor(accumulatedSeconds)}''`);

      prevPoint = station;
    }

    return times;
  });

  let districtGroups = $derived.by(() => {
    const groups: DistrictGroup[] = [];
    if (displayStations.length === 0) return groups;

    let currentDistrict = getDistrictName(displayStations[0]) || "";
    let startIndex = 0;
    let count = 1;

    for (let i = 1; i < displayStations.length; i++) {
      const dName = getDistrictName(displayStations[i]) || "";
      if (dName === currentDistrict) {
        count++;
      } else {
        if (currentDistrict)
          groups.push({ name: currentDistrict, startIndex, count });
        currentDistrict = dName;
        startIndex = i;
        count = 1;
      }
    }
    if (currentDistrict)
      groups.push({ name: currentDistrict, startIndex, count });
    return groups;
  });
</script>

<div class="metro-route">
  <div class="header">
    {#if mode === 1 && platformSide}
      <div
        class="platform-indicator plat-{platformSide}"
        style="background-color: {lineColor}; color: {lineTextColor};"
      >
        <div class="arrow-stream">
          <img src="/icon/arrow.svg" alt="Platform Arrow" class="pixel-arrow" />
          <img src="/icon/arrow.svg" alt="Platform Arrow" class="pixel-arrow" />
          <img src="/icon/arrow.svg" alt="Platform Arrow" class="pixel-arrow" />
          <img src="/icon/arrow.svg" alt="Platform Arrow" class="pixel-arrow" />
        </div>
      </div>
    {:else}
      <div
        class="route-name"
        style="background-color: {lineColor}; color: {lineTextColor};"
      >
        <span>{routeName}</span>
      </div>
    {/if}

    <div class="route-info">
      {#if mode === 0}
        <div class="route-stats mode">
          <span class="title">-> {terminalStation}</span>
          <div class="route-checkpoints content">
            <span class="route-label">Route:</span>
            <div
              class="ticker-wrap"
              use:tickerObserver={fullRouteText}
              class:should-scroll={isOverflowing}
            >
              <div class="ticker-content">
                <span>{fullRouteText}</span>
                {#if isOverflowing}
                  <span>{fullRouteText}</span>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {:else}
        <div class="{mode === 1 ? 'current' : 'next'}-station mode">
          <span class="title">{mode === 1 ? "THIS IS:" : "NEXT STATION:"}</span>
          <span class="content"
            >{(mode === 1 ? currentStation : headingToStation)?.name ??
              ""}</span
          >
        </div>
      {/if}
    </div>
  </div>

  <div class="transfers">
    {#if activeTags.length > 0}
      <span
        ><svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 19 19"
          width="38"
          height="38"
          shape-rendering="crispEdges"
        >
          <path
            fill="currentColor"
            d="M1 6h7v7H1zM2 7h5v5H2z"
            fill-rule="evenodd"
          />
          <path fill="currentColor" d="M3 8h3v3H3z" />
          <path fill="currentColor" d="M8 9h4v1H8z" />
          <path
            fill="currentColor"
            d="M12 6h1v7h-1z M13 7h1v5h-1z M14 8h1v3h-1z M15 9h1v1h-1z"
          />
        </svg>
      </span>
      {#each activeTags as tag}
        {#if tag.name}
          <div
            class="transfer-badge"
            style="background-color: {tag.backgroundColor ||
              '#666'}; color: {tag.textColor || '#fff'};"
          >
            <span>{tag.name}</span>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <div class="route">
    <div
      class="metro-display"
      style="--line-color: {lineColor}; --total-stations: {displayStations.length};"
    >
      <div class="line-map">
        {#each displayStations as station, index}
          {@const stationTime = calculatedTimes.get(station.id)}
          <div
            class="station-item"
            class:is-passed={isPassed(station.id)}
            class:is-current={station.id === currentFeatureId}
            class:is-terminal={index === 0 ||
              index === displayStations.length - 1}
          >
            <div class="station-name">{station.name}</div>
            <div class="node-cutout"></div>
            <div class="node"><div class="inner-dot"></div></div>

            <div class="station-time">
              {#if showTime && stationTime && (!isPassed(station.id) || station.id === currentFeatureId)}
                {stationTime}
              {/if}
            </div>
          </div>
        {/each}

        {#if showDistricts}
          <div class="districts-bar">
            {#each districtGroups as group}
              <div
                class="district-block"
                class:is-first={group.startIndex === 0}
                class:is-last={group.startIndex + group.count ===
                  displayStations.length}
                style="left: calc((100% / {displayStations.length}) * {group.startIndex}); width: calc((100% / {displayStations.length}) * {group.count});"
              >
                <span class="district-title">{group.name}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
  <div class="footer"></div>
</div>

<style lang="scss">
  @import "./MetroRoute.scss";
</style>
