import { useEffect, useMemo, useState } from "react";
import { animaApi } from "@/api/animaApi";
import { mixedAuraColor } from "@/lib/animaExpressions";
import { resolveBattleModels } from "@/lib/battleModels";

function playerPayload(player) {
  if (!player) return {};
  return {
    name: player.name,
    avatar_url: player.avatar_url,
    color: player.color || mixedAuraColor(player.spectrum),
    accent: player.accent,
    glb_url: player.glb_url,
  };
}

function enemyPayload(enemy) {
  if (!enemy) return {};
  return {
    name: enemy.name,
    color: enemy.color,
    accent: enemy.accent,
    silhouette: enemy.silhouette,
    texture_url: enemy.texture_url,
    glb_url: enemy.glb_url,
  };
}

/**
 * Resolves 3D figure descriptors for the current battle.
 * Starts with the local catalog so jack-in is instant, then overlays the
 * `/api/battle-models/resolve` connection if it answers.
 */
export default function useResolvedBattleModels(player, enemy) {
  const local = useMemo(
    () =>
      resolveBattleModels({
        player: playerPayload(player),
        enemy: enemyPayload(enemy),
      }),
    [
      player?.name,
      player?.avatar_url,
      player?.color,
      player?.spectrum,
      enemy?.name,
      enemy?.color,
      enemy?.silhouette,
    ],
  );

  const [remote, setRemote] = useState(null);

  useEffect(() => {
    let cancelled = false;
    animaApi.battleModels
      .resolve({
        player: playerPayload(player),
        enemy: enemyPayload(enemy),
      })
      .then((data) => {
        if (!cancelled && data?.player && data?.enemy) setRemote(data);
      })
      .catch(() => {
        /* Local catalog is enough to render. */
      });
    return () => {
      cancelled = true;
    };
  }, [
    player?.name,
    player?.avatar_url,
    player?.color,
    enemy?.name,
    enemy?.color,
    enemy?.silhouette,
  ]);

  return remote || local;
}
