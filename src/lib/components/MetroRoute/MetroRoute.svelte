<script lang="ts">
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
    annoucementDuration = 5000,
    showDistricts = true,
    showTime = true,
    districtPrefix = "d:",
    transferPrefix = "->",
    timePrefix = "t:",
    speed = 11,
    dwellTimeSeconds = 5,
  } = $props();

  let isAnnouncementActive = $state(false);

  $effect(() => {
    if (!currentFeatureId && !headingToId)
      return void (isAnnouncementActive = false);
    isAnnouncementActive = true;
    const timer = setTimeout(
      () => (isAnnouncementActive = false),
      annoucementDuration,
    );
    return () => clearTimeout(timer);
  });

  function getPos(obj: Feature | Position | null): Position | null {
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
  }

  function getDistance(
    a: Feature | Position | null,
    b: Feature | Position | null,
  ): number {
    const p1 = getPos(a);
    const p2 = getPos(b);
    if (!p1 || !p2) return 0;
    return Math.sqrt(
      (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2 + (p2.z - p1.z) ** 2,
    );
  }

  let idxMap = $derived(new Map(stations.map((s, i) => [s.id, i])));
  const getIdx = (id: string | null) => (id ? (idxMap.get(id) ?? -1) : -1);

  const getTagString = (tag: Tag | string): string => {
    return typeof tag === "string" ? tag : (tag.name ?? "");
  };

  const getDistrictName = (station: Feature): string | null => {
    const tag = station.tags?.find((t) =>
      getTagString(t).startsWith(districtPrefix),
    );
    return tag
      ? getTagString(tag)
          .replace(new RegExp(`^${districtPrefix}`), "")
          .trim()
      : null;
  };

  const getManualTime = (station: Feature): string | null => {
    const tag = station.tags?.find((t) =>
      getTagString(t).startsWith(timePrefix),
    );
    if (!tag) return null;
    const val = getTagString(tag)
      .replace(new RegExp(`^${timePrefix}`), "")
      .trim();
    return /^\d+$/.test(val) ? `${val}'` : val;
  };

  let [currentIdx, nextIdx, lastLeftIdx] = $derived([
    getIdx(currentFeatureId),
    getIdx(headingToId),
    getIdx(lastLeftFeatureId),
  ]);

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
      .map((tag) => {
        const str = getTagString(tag);
        return {
          name: str.replace(new RegExp(`${transferPrefix}`, "g"), "").trim(),
          backgroundColor:
            typeof tag === "object" ? tag.backgroundColor : undefined,
          textColor: typeof tag === "object" ? tag.textColor : undefined,
        };
      }) ?? [],
  );

  let isForward = $derived(
    lastLeftIdx !== -1 && nextIdx !== -1
      ? nextIdx >= lastLeftIdx
      : currentIdx !== -1 && nextIdx !== -1
        ? nextIdx >= currentIdx
        : nextIdx > 0 || nextIdx === -1,
  );

  let displayStations = $derived(
    isForward ? stations : [...stations].reverse(),
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

  let calculatedTimes = $derived.by(() => {
    const times = new Map<string, string>();
    if (!showTime) return times;

    let accumulatedSeconds = 0;
    let prevPoint: Feature | Position | null = playerPosition;

    for (const station of displayStations) {
      const manualTime = getManualTime(station);
      if (manualTime) {
        times.set(station.id, manualTime);
        continue;
      }

      if (isPassed(station.id) && station.id !== currentFeatureId) {
        continue;
      }

      if (station.id === currentFeatureId) {
        times.set(station.id, "0''");
        prevPoint = station;
        accumulatedSeconds = 0;
        continue;
      }

      const dist = getDistance(prevPoint, station);
      const isFirstSegmentFromPlayer = prevPoint === playerPosition;

      accumulatedSeconds +=
        dist / Math.max(speed, 1) +
        (!isFirstSegmentFromPlayer ? dwellTimeSeconds : 0);

      const mins = Math.floor(accumulatedSeconds);
      times.set(station.id, `${mins}''`);

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
        if (currentDistrict) {
          groups.push({ name: currentDistrict, startIndex, count });
        }
        currentDistrict = dName;
        startIndex = i;
        count = 1;
      }
    }
    if (currentDistrict) {
      groups.push({ name: currentDistrict, startIndex, count });
    }
    return groups;
  });
</script>

<div class="metro-route">
  <div class="header">
    <div
      class="route-name"
      style="background-color: {lineColor}; color: white;"
    >
      <span>{routeName}</span>
    </div>
    <div class="route-info">
      {#if mode === 0}
        <div class="route-stats mode">
          <span class="title">-> {terminalStation}</span>
          <div class="route-checkpoints content">
            Route:
            <div class="ticker-wrap">
              <div class="ticker-content">
                <span>{fullRouteText}</span>
                <span>{fullRouteText}</span>
              </div>
            </div>
          </div>
        </div>
      {:else}
        <div class="{mode === 1 ? 'current' : 'next'}-station mode">
          <span class="title"
            >{mode === 1 ? "THIS IS:" : "NEXT STATION:"}
          </span>
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
      <span>-></span>
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
              {@const isFirstStation = group.startIndex === 0}
              {@const isLastStation =
                group.startIndex + group.count === displayStations.length}

              <div
                class="district-block"
                class:is-first={isFirstStation}
                class:is-last={isLastStation}
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
