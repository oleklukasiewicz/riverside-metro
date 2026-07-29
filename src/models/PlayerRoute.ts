// Wszystkie definicje w jednym pliku

export interface Position {
  username?: string;
  x: number;
  y: number;
  z: number;
  time?: Date | string | null;
}

export interface Feature {
  id: string;
  name: string;
  tags: string[];

  startPosition?: Position | null;
  endPosition?: Position | null;

  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
  minZ?: number;
  maxZ?: number;

  centerX?: number;
  centerY?: number;
  centerZ?: number;
  centerPosition?: Position;
}

export interface PlayerPosition {
  username: string;
  actualPosition?: Position | null;
  previousPosition?: Position | null;
}

export interface Route {
  id: string;
  name: string;
  checkpoints: Feature[];
  isRailway: boolean;
  tags: string[];
}

export interface PlayerRoute {
  username: string;
  route: Route;
  position: PlayerPosition;
  currentFeature: Feature | null;
  headingTo: Feature | null;
  offRouteSince: Date | string | null;
  isJustAdded: boolean;
  lastLeftFeatureId: string | null;
}
