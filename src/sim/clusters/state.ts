export interface ClusterState {
  entityId: number;
  positionXWorld: number;
  positionYWorld: number;
  velocityXWorld: number;
  velocityYWorld: number;
  isAliveFlag: 0 | 1;
  isPlayerFlag: 0 | 1;
  healthPoints: number;
  maxHealthPoints: number;
}

export function createClusterState(
  entityId: number,
  positionXWorld: number,
  positionYWorld: number,
  isPlayerFlag: 0 | 1,
  maxHealthPoints: number,
): ClusterState {
  return {
    entityId,
    positionXWorld,
    positionYWorld,
    velocityXWorld: 0,
    velocityYWorld: 0,
    isAliveFlag: 1,
    isPlayerFlag,
    healthPoints: maxHealthPoints,
    maxHealthPoints,
  };
}
