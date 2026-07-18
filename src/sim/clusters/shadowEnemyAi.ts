import type { WorldState } from '../world';
import { killPlayerImmediately } from '../playerDamage';
import { SHADOW_FATAL_OVERLAP_EPSILON_WORLD, SHADOW_FOLLOW_SPEED_WORLD_PER_SEC, SHADOW_REPHASE_DELAY_TICKS, SHADOW_TELEPORT_RESET_DISTANCE_WORLD } from './shadowEnemyConfig';

export function appendShadowWaypoint(world: WorldState, slot: number, x: number, y: number): void {
  const stride=world.shadowPathStride; let head=world.shadowPathHead[slot], count=world.shadowPathCount[slot];
  if(count>=stride){ head=(head+1)%stride; world.shadowPathHead[slot]=head; count=stride-1; }
  const flat=slot*stride+(head+count)%stride; world.shadowPathXWorld[flat]=x; world.shadowPathYWorld[flat]=y; world.shadowPathCount[slot]=count+1;
}
export function clearShadowPath(world: WorldState, slot:number):void { world.shadowPathHead[slot]=0; world.shadowPathCount[slot]=0; }

export function recordAndMoveShadowEnemies(world: WorldState): void {
  const player=world.clusters[0]; if(!player||player.isPlayerFlag!==1) return;
  for(const s of world.clusters){ if(s.isShadowEnemyFlag!==1||s.isAliveFlag===0||s.shadowPathSlotIndex<0) continue; const slot=s.shadowPathSlotIndex;
    const lx=world.shadowPathLastRecordedXWorld[slot], ly=world.shadowPathLastRecordedYWorld[slot];
    if(Math.hypot(player.positionXWorld-lx,player.positionYWorld-ly)>SHADOW_TELEPORT_RESET_DISTANCE_WORLD){clearShadowPath(world,slot);s.shadowRephaseTicks=SHADOW_REPHASE_DELAY_TICKS;}
    appendShadowWaypoint(world,slot,player.positionXWorld,player.positionYWorld); world.shadowPathLastRecordedXWorld[slot]=player.positionXWorld; world.shadowPathLastRecordedYWorld[slot]=player.positionYWorld;
    s.velocityXWorld=0;s.velocityYWorld=0;s.shadowVisualPhaseRad+=world.dtMs*0.004;
    if(s.shadowStartupTicks>0){s.shadowStartupTicks--;continue;} if(s.shadowRephaseTicks>0){s.shadowRephaseTicks--;continue;}
    let budget=SHADOW_FOLLOW_SPEED_WORLD_PER_SEC*world.dtMs*.001, loops=0; const ox=s.positionXWorld,oy=s.positionYWorld;
    while(budget>1e-6&&world.shadowPathCount[slot]>0&&loops++<128){const head=world.shadowPathHead[slot], flat=slot*world.shadowPathStride+head; const dx=world.shadowPathXWorld[flat]-s.positionXWorld,dy=world.shadowPathYWorld[flat]-s.positionYWorld,d=Math.hypot(dx,dy);
      if(d<=budget){s.positionXWorld+=dx;s.positionYWorld+=dy;budget-=d;world.shadowPathHead[slot]=(head+1)%world.shadowPathStride;world.shadowPathCount[slot]--;}else{s.positionXWorld+=dx/d*budget;s.positionYWorld+=dy/d*budget;budget=0;}}
    const dt=world.dtMs*.001;if(dt>0){s.velocityXWorld=(s.positionXWorld-ox)/dt;s.velocityYWorld=(s.positionYWorld-oy)/dt;}
  }
}
export function resolveShadowFatalContacts(world:WorldState):void{const p=world.clusters[0];if(!p||p.isAliveFlag===0)return;for(const s of world.clusters){if(s.isShadowEnemyFlag!==1||s.isAliveFlag===0||s.shadowStartupTicks>0||s.shadowRephaseTicks>0)continue;const eps=SHADOW_FATAL_OVERLAP_EPSILON_WORLD;if(Math.abs(p.positionXWorld-s.positionXWorld)<p.halfWidthWorld+s.halfWidthWorld-eps&&Math.abs(p.positionYWorld-s.positionYWorld)<p.halfHeightWorld+s.halfHeightWorld-eps){killPlayerImmediately(p);return;}}}
