export interface CollisionCluster {
  id: string;
  name: string;
  lat: number;
  lng: number;
  count: number;
  types: {
    rearEnd: number;
    turning: number;
    pedestrian: number;
    angle: number;
    other: number;
  };
  severity: {
    fatal: number;
    injury: number;
    pdo: number;
  };
  peakTime: string;
  riskScore: number;
}
