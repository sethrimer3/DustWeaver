# Zip Move Blocks

The editor palette exposes `Zip Block — Toward` and `Zip Block — Away` in Special Blocks. Both serialize in `zipMoveBlocks` with `uid`, `xBlock`, `yBlock`, `wBlock`, `hBlock`, and `variant` (`toward` or `away`). Width and height are normalized to a minimum of 3 tiles; runtime velocity, activation side, state, and visual interpolation are not saved.

A completed player zip uses the resolved grapple surface normal and anchor contact point to select the contacted top, right, bottom, or left face. Toward blocks move in that face direction; Away blocks move in the opposite direction. Blocks accelerate at 720 world units/s² to 180 world units/s, continue until swept collision reaches the nearest surviving solid, stop flush, become dormant, and may then be activated again. Moving blocks ignore redirects and release the activating grapple.

Moving blocks push overlapping player and enemy cluster AABBs. An entity is killed only if the attempted push leaves its AABB overlapping another immovable wall; ordinary contact, trailing contact, and dormant blocks do not crush. Swept axis collision prevents crossing thin walls. Sandstone cells in the swept footprint use the pixel-material conversion path and become sand without stopping the block. Existing falling-block groups are activated on contact: the actual weakest walk/contact-triggered `crumbling` variant is removed immediately and passed through, while still-solid `sensitive` and `tough` variants enter their warning state and stop the zip block.

The glowing edge and four directional triangles reduce their halo when bloom/effects are disabled; collision is unchanged by graphics quality.
