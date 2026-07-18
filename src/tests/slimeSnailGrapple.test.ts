import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGrappleWallHitSlimed, isSurfaceSegmentSlimed } from '../sim/clusters/slimeSnailAi';

function view() {
  return { slimeSnailTrailCol:Int16Array.from([2,3]), slimeSnailTrailRow:Int16Array.from([4,4]), slimeSnailTrailSideIndex:Uint8Array.from([0,0]), slimeSnailTrailRemainingTicks:Uint16Array.from([5,0]), slimeSnailTrailCount:Uint8Array.from([2]), slimeSnailTrailStride:2 };
}
test('slimed wall hit is rejected without confusing opposite side',()=>{ const v=view(); assert.equal(isGrappleWallHitSlimed(v,18,32,0,-1),true); assert.equal(isGrappleWallHitSlimed(v,18,40,0,1),false); });
test('adjacent unslimed surface stays eligible',()=>{ const v=view(); assert.equal(isSurfaceSegmentSlimed(v,3,4,0),false); assert.equal(isGrappleWallHitSlimed(v,28,32,0,-1),false); });
test('tile seam is blocked when either adjoining segment is slimed',()=>{ const v=view(); assert.equal(isGrappleWallHitSlimed(v,24,32,0,-1),true); });
test('expired slime never blocks',()=>{ const v=view(); v.slimeSnailTrailRemainingTicks[0]=0; assert.equal(isGrappleWallHitSlimed(v,18,32,0,-1),false); });
