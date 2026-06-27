"use client";

import { CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, TouchEvent } from "react";
import type { CardInstance, PlayerSide, RoomState, Zone } from "@/types/roomState";
import {
  RightClickMenu,
  type MenuAction,
  type MenuNode
} from "@/components/board/RightClickMenu";

type DeckVisibility = "private" | "public";

type CheckingStatus = {
  player: PlayerSide;
  mode: "checking" | "public_checking";
  startedAt: string;
};

type ExtendedRoomState = RoomState & {
  deckVisibility?: Partial<Record<PlayerSide, DeckVisibility>>;
  checkingStatus?: CheckingStatus | null;
};

type BoardMenuAction =
  | MenuAction
  | "deck_public"
  | "deck_private"
  | "toggle_face_up"
  | "seal_from_deck"
  | "seal_to_grave"
  | "source_to_hand"
  | "source_to_shield"
  | "source_to_mana"
  | "source_to_grave";

type SimpleBoardProps = {
  roomState: RoomState;
  myRole: PlayerSide | "spectator" | null;
  isInteractionDisabled?: boolean;
  onDrawCard: (player: PlayerSide) => void;
  onMoveCard: (cardId: string, toZone: Zone) => void;
  onBreakShield: (
    cardId: string,
    choice: "return" | "hand" | "battle"
  ) => void;
  onToggleTapped: (cardId: string) => void;
  onToggleReversed: (cardId: string) => void;
  onToggleFaceUp: (cardId: string) => void;
  onToggleMultipleCardOrientation?: (
    cardIds: string[],
    kind: "tapped" | "reversed" | "faceUp"
  ) => void;
  onMoveCardToDeckTop: (cardId: string) => void;
  onMoveCardToDeckBottom: (cardId: string) => void;
  onMoveCardToDeckAndShuffle: (cardId: string) => void;
  onMoveCardToManaFaceUp: (cardId: string) => void;
  onMoveCardToManaFaceDown: (cardId: string) => void;
  onShuffleDeck: (player: PlayerSide) => void;
  onPeekDeck: (player: PlayerSide, direction: "top" | "bottom", count: number) => void;
  onMoveDeckCardsToZone: (player: PlayerSide, toZone: Zone, count: number) => void;
  onSendDeckTopToBottom: (player: PlayerSide, count: number) => void;
  onRevealCard: (cardId: string) => void;
  onCancelAllRevealedCards: () => void;
  onInspectMultipleDeck: (player: PlayerSide, count: number) => void;
  onInspectPublicDeck: (player: PlayerSide, count: number) => void;
  onInspectDeckSelectModal: (params: {
    player: PlayerSide;
    count: number;
    publicCheck: boolean;
    cardActions: Record<string, Zone | "keep">;
    remainingAction: "keep" | "bottom" | "shuffle" | "order_top" | "order_bottom";
    orderedRemainingIds?: string[];
  }) => void;
  onStackCardToBattle: (cardId: string) => void;
  onMoveMultipleCards: (cardIds: string[], toZone: Zone) => void;
  onSealTopCard?: (targetCardId: string) => void;
  onMoveTopStackCardToGrave?: (cardId: string) => void;
  onMoveStackSourceOnly?: (cardId: string, toZone: Zone) => void;
  onSetDeckVisibility: (player: PlayerSide, status: DeckVisibility) => void;
  onStartCheckingStatus: (
    player: PlayerSide,
    mode: "checking" | "public_checking"
  ) => void;
  onClearCheckingStatus: (player: PlayerSide) => void;
};

type CardMenuState = {
  type: "card";
  x: number;
  y: number;
  card: CardInstance;
  root: MenuNode;
};

type DeckMenuState = {
  type: "deck";
  x: number;
  y: number;
  player: PlayerSide;
  count: number;
  root: MenuNode;
};

type MenuState = CardMenuState | DeckMenuState | null;

type DeckPreviewState = {
  player: PlayerSide;
  direction: "top" | "bottom";
  count: number;
  cardIds: string[];
} | null;

type DeckSelectCardAction = Zone | "keep";

type DeckSelectModalState = {
  player: PlayerSide;
  count: number;
  publicCheck: boolean;
  cardIds: string[];
  cardActions: Record<string, DeckSelectCardAction>;
  remainingAction: "keep" | "bottom" | "shuffle" | "order_top" | "order_bottom" | null;
  orderedRemainingIds: string[];
} | null;

type ShieldBreakModalState = {
  card: CardInstance;
} | null;

type GraveModalState = {
  player: PlayerSide;
  ownerLabel: "me" | "opp";
  cardIds: string[];
} | null;

type SpectatorViewMode = "player1" | "player2" | "player1_open_hands" | "player2_open_hands";

const ZONE_LABELS: Record<Zone, string> = {
  deck: "山札",
  hand: "手札",
  battle: "バトル",
  mana: "マナ",
  grave: "墓地",
  shield: "シールド"
};

const SPECTATOR_FREE_SWITCH_LIMIT = 2;
const SPECTATOR_SWITCH_COOLDOWN_MS = 20_000;

const preloadedCardImageUrls = new Set<string>();

function preloadCardImage(url: string) {
  if (typeof window === "undefined") return;
  if (!url || preloadedCardImageUrls.has(url)) return;

  preloadedCardImageUrls.add(url);

  const image = new Image();
  image.decoding = "async";
  image.src = url;
}


function getDeckVisibility(
  roomState: RoomState,
  player: PlayerSide
): DeckVisibility {
  const status = (roomState as ExtendedRoomState).deckVisibility?.[player];
  return status === "public" ? "public" : "private";
}

function deckVisibilityLabel(status: DeckVisibility) {
  switch (status) {
    case "public":
      return "公開";
    default:
      return "非公開";
  }
}

function canSeeDeckTopCard(params: {
  deckOwner: PlayerSide;
  myRole: PlayerSide | "spectator" | null;
  viewerRole: PlayerSide | null;
  revealAllHands: boolean;
  visibility: DeckVisibility;
}) {
  if (params.visibility !== "public") return false;
  if (params.myRole === params.deckOwner) return true;
  if (params.myRole === "spectator") return params.revealAllHands || params.viewerRole === params.deckOwner;
  return true;
}

function getCheckingStatus(roomState: RoomState) {
  return (roomState as ExtendedRoomState).checkingStatus ?? null;
}

function getCardMeta(card: CardInstance) {
  const maybeCard = card as CardInstance & {
    civilization?: string | null;
    cost?: number | null;
    type?: string | null;
    race?: string | null;
    power?: string | number | null;
    text?: string | null;
  };

  return {
    civilization: maybeCard.civilization ?? null,
    cost: maybeCard.cost ?? null,
    type: maybeCard.type ?? null,
    race: maybeCard.race ?? null,
    power: maybeCard.power ?? null,
    text: maybeCard.text ?? null
  };
}

function getCardDetailValue(card: CardInstance, key: string) {
  const detailCard = card as CardInstance & Record<string, unknown>;
  const value = detailCard[key];

  if (value === null || value === undefined || value === "") return null;

  return String(value);
}

function getCardImageUrl(card: CardInstance) {
  const maybeCard = card as CardInstance & {
    imageUrl?: string | null;
    image_url?: string | null;
    cardImageUrl?: string | null;
    card_image_url?: string | null;
    highImageUrl?: string | null;
    high_image_url?: string | null;
    fullImageUrl?: string | null;
    full_image_url?: string | null;
    originalImageUrl?: string | null;
    original_image_url?: string | null;
  };

  return (
    maybeCard.highImageUrl ??
    maybeCard.high_image_url ??
    maybeCard.fullImageUrl ??
    maybeCard.full_image_url ??
    maybeCard.originalImageUrl ??
    maybeCard.original_image_url ??
    maybeCard.imageUrl ??
    maybeCard.image_url ??
    maybeCard.cardImageUrl ??
    maybeCard.card_image_url ??
    null
  );
}

function getCardThumbnailUrl(card: CardInstance) {
  const maybeCard = card as CardInstance & {
    thumbnailUrl?: string | null;
    thumbnail_url?: string | null;
    cardThumbnailUrl?: string | null;
    card_thumbnail_url?: string | null;
  };

  return (
    maybeCard.thumbnailUrl ??
    maybeCard.thumbnail_url ??
    maybeCard.cardThumbnailUrl ??
    maybeCard.card_thumbnail_url ??
    getCardImageUrl(card)
  );
}

function getCardViewerImageUrl(card: CardInstance) {
  return getCardImageUrl(card) ?? getCardThumbnailUrl(card);
}

function isHiddenDisplayName(displayName: string | undefined) {
  if (!displayName) return false;
  return displayName === "非公開" || displayName.startsWith("シールド");
}

function isDeckStatusAction(action: BoardMenuAction) {
  return action === "deck_public" || action === "deck_private";
}

function createBattleMenu(): MenuNode {
  return {
    label: "バトルゾーン",
    w: {
      label: "向き変更",
      w: { label: "タップ/アンタップ", action: "toggle_tapped" },
      s: { label: "上下反転/解除", action: "toggle_reversed" }
    },
    s: {
      label: "ゾーン移動",
      w: { label: "手札", action: "move_hand" },
      a: { label: "シールド", action: "move_shield" },
      s: { label: "マナ", action: "move_mana" },
      d: { label: "墓地", action: "move_grave" }
    },
    d: {
      label: "その他",
      w: {
        label: "封印",
        w: { label: "山札上から封印", action: "seal_from_deck" as MenuAction },
        s: { label: "封印を墓地へ", action: "seal_to_grave" as MenuAction }
      },
      a: {
        label: "進化元だけ移動",
        w: { label: "手札", action: "source_to_hand" as MenuAction },
        a: { label: "シールド", action: "source_to_shield" as MenuAction },
        s: { label: "マナ", action: "source_to_mana" as MenuAction },
        d: { label: "墓地", action: "source_to_grave" as MenuAction }
      },
      d: {
        label: "山札に戻す",
        w: { label: "山札上", action: "move_deck_top" },
        a: { label: "山札に戻してシャッフル", action: "move_deck_shuffle" },
        s: { label: "山札下", action: "move_deck_bottom" }
      }
    }
  };
}

function createHandMenu(): MenuNode {
  return {
    label: "手札",
    w: {
      label: "使用",
      w: { label: "バトルゾーンへそのまま出す", action: "use_to_battle" },
      a: { label: "既存カードに重ねて出す", action: "use_stack_to_battle" }
    },
    a: {
      label: "表示確認",
      w: { label: "相手に公開する", action: "reveal_to_opponent" }
    },
    s: {
      label: "ゾーン移動",
      a: { label: "シールド", action: "move_shield" },
      s: {
        label: "マナ",
        s: { label: "表向きでマナへ", action: "move_mana_face_up" },
        w: { label: "裏向きでマナへ", action: "move_mana_face_down" }
      },
      d: { label: "墓地", action: "move_grave" }
    },
    d: { label: "マナゾーンへ移動", action: "move_mana" }
  };
}

function createManaMenu(): MenuNode {
  return {
    label: "マナゾーン",
    a: { label: "タップ/アンタップ", action: "toggle_tapped" },
    s: {
      label: "ゾーン移動",
      w: { label: "手札", action: "move_hand" },
      a: { label: "シールド", action: "move_shield" },
      d: { label: "墓地", action: "move_grave" }
    },
    d: {
      label: "山札へ戻す",
      w: { label: "山札上", action: "move_deck_top" },
      s: { label: "山札下", action: "move_deck_bottom" }
    }
  };
}

function createGraveMenu(): MenuNode {
  return {
    label: "墓地",
    s: {
      label: "ゾーン移動",
      w: { label: "手札", action: "move_hand" },
      a: { label: "バトルゾーン", action: "move_battle" },
      s: { label: "マナ", action: "move_mana" }
    },
    d: {
      label: "山札へ戻す",
      w: { label: "山札上", action: "move_deck_top" },
      s: { label: "山札下", action: "move_deck_bottom" }
    }
  };
}

function createShieldMenu(): MenuNode {
  return {
    label: "シールド",
    w: {
      label: "向き変更",
      w: { label: "タップ/アンタップ", action: "toggle_tapped" },
      s: { label: "上下反転/解除", action: "toggle_reversed" },
      d: { label: "表向き/裏向き", action: "toggle_face_up" as MenuAction }
    },
    a: { label: "シールドブレイク", action: "break_shield" },
    s: {
      label: "ゾーン移動",
      w: { label: "手札", action: "move_hand" },
      a: { label: "シールド", action: "move_shield" },
      s: { label: "マナ", action: "move_mana" },
      d: { label: "墓地", action: "move_grave" }
    },
    d: {
      label: "山札へ戻す",
      w: { label: "山札上", action: "move_deck_top" },
      s: { label: "山札下", action: "move_deck_bottom" }
    }
  };
}

function createDeckMenu(count: number): MenuNode {
  return {
    label: count === 1 ? "山札 1枚操作" : `山札 ${count}枚操作`,
    w: {
      label: "状態変更",
      w: { label: "山札公開", action: "deck_public" as MenuAction },
      a: { label: "山札非公開", action: "deck_private" as MenuAction },
    },
    a: {
      label: "山札操作",
      w: { label: "1枚引く", action: "draw_one" },
      a: { label: "上から見る", action: "look_deck_top" },
      s: { label: "下から見る", action: "look_deck_bottom" },
      d: { label: "山札下へ送る", action: "send_deck_bottom" }
    },
    s: {
      label: "ゾーン移動",
      w: { label: "手札", action: "move_hand" },
      a: { label: "シールド", action: "move_shield" },
      s: { label: "マナ", action: "move_mana" },
      d: { label: "墓地", action: "move_grave" }
    },
    d: {
      label: "特殊操作",
      w: { label: "シャッフル", action: "shuffle_deck" },
      a: { label: "複数枚確認", action: "inspect_multiple" },
      s: { label: "山札公開確認", action: "inspect_public_deck" }
    }
  };
}

function createMenuForCard(card: CardInstance): MenuNode {
  switch (card.zone) {
    case "battle":
      return createBattleMenu();
    case "hand":
      return createHandMenu();
    case "mana":
      return createManaMenu();
    case "grave":
      return createGraveMenu();
    case "shield":
      return createShieldMenu();
    default:
      return {
        label: ZONE_LABELS[card.zone]
      };
  }
}

function canSeeCardName(
  card: CardInstance,
  myRole: PlayerSide | "spectator" | null,
  viewerRole: PlayerSide | null = null,
  revealAllHands = false
) {
  const isPlayerSelf = myRole !== "spectator" && myRole !== null && card.owner === myRole;
  const isSpectatorViewingOwner =
    myRole === "spectator" && viewerRole !== null && card.owner === viewerRole;
  const isOwnerSideView = isPlayerSelf || isSpectatorViewingOwner;

  if (card.zone === "deck") return false;

  if (isOwnerSideView) {
    if (card.zone === "shield") return card.faceUp;
    return true;
  }

  if (card.zone === "hand") {
    return revealAllHands || card.faceUp;
  }

  if (card.zone === "shield") {
    return card.faceUp;
  }

  if (card.zone === "mana") {
    return card.faceUp;
  }

  return true;
}

function canSeeCardFace(
  card: CardInstance,
  myRole: PlayerSide | "spectator" | null,
  viewerRole: PlayerSide | null = null,
  revealAllHands = false
) {
  return canSeeCardName(card, myRole, viewerRole, revealAllHands);
}

function canOpenCardViewer(
  card: CardInstance,
  myRole: PlayerSide | "spectator" | null,
  viewerRole: PlayerSide | null = null,
  revealAllHands = false
) {
  return canSeeCardFace(card, myRole, viewerRole, revealAllHands);
}

function getVisibleCardName(
  card: CardInstance,
  myRole: PlayerSide | "spectator" | null,
  fallback?: string,
  viewerRole: PlayerSide | null = null,
  revealAllHands = false
) {
  if (!canSeeCardName(card, myRole, viewerRole, revealAllHands)) {
    if (card.zone === "shield") return fallback ?? "シールド";
    return "非公開";
  }

  return card.name;
}

function getMenuPositionFromElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();

  return {
    x: rect.left + rect.width * 0.5,
    y: rect.top + rect.height * 0.3
  };
}

function areCardBoxesEqual(
  prev: Readonly<{
    card: CardInstance;
    displayName?: string;
    selected: boolean;
    canOperate: boolean;
    canOpenViewer: boolean;
    stackCount: number;
    selectionOrder: number | null;
  }>,
  next: Readonly<{
    card: CardInstance;
    displayName?: string;
    selected: boolean;
    canOperate: boolean;
    canOpenViewer: boolean;
    stackCount: number;
    selectionOrder: number | null;
  }>
) {
  return (
    prev.card === next.card &&
    prev.displayName === next.displayName &&
    prev.selected === next.selected &&
    prev.canOperate === next.canOperate &&
    prev.canOpenViewer === next.canOpenViewer &&
    prev.stackCount === next.stackCount &&
    prev.selectionOrder === next.selectionOrder
  );
}

const CardBox = memo(function CardBox({
  card,
  displayName,
  selected,
  canOperate,
  canOpenViewer,
  stackCount,
  selectionOrder,
  onClickCard,
  onOpenMenu,
  onOpenTouchMenu
}: {
  card: CardInstance;
  displayName?: string;
  selected: boolean;
  canOperate: boolean;
  canOpenViewer: boolean;
  stackCount: number;
  selectionOrder: number | null;
  onClickCard: (event: MouseEvent<HTMLDivElement>) => void;
  onOpenMenu: (event: MouseEvent<HTMLDivElement>, card: CardInstance) => void;
  onOpenTouchMenu: (element: HTMLElement, card: CardInstance) => void;
}) {
  const rotation = card.tapped ? 90 : card.reversed ? 180 : 0;
  const cardImageUrl = getCardThumbnailUrl(card);
  const canShowCardFace = canOpenViewer && !isHiddenDisplayName(displayName);
  const longPressTimerRef = useRef<number | null>(null);
  const lastCardClickAtRef = useRef(0);

  function clearLongPressTimer() {
    if (!longPressTimerRef.current) return;

    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (!canOperate) return;

    const touch = event.touches[0];
    if (!touch) return;

    event.preventDefault();
    clearLongPressTimer();

    const element = event.currentTarget;

    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      onOpenTouchMenu(element, card);
    }, 430);
  }

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, []);

  return (
    <div
      onClick={(event) => {
        const now = Date.now();
        if (now - lastCardClickAtRef.current < 120) return;
        lastCardClickAtRef.current = now;
        onClickCard(event);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!canOperate) return;

        onOpenMenu(event, card);
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={clearLongPressTimer}
      onTouchCancel={clearLongPressTimer}
      onTouchMove={clearLongPressTimer}
      style={{
        border: selected ? "2px solid #4ea3ff" : "1px solid #555",
        borderRadius: 8,
        padding: 8,
        background: "#050505",
        color: "#fff",
        aspectRatio: "63 / 88",
        minWidth: 0,
        contain: "layout paint",
        display: "grid",
        gap: 6,
        placeItems: "center",
        textAlign: "center",
        fontSize: 12,
        cursor: canOperate ? "context-menu" : canOpenViewer ? "pointer" : "default",
        touchAction: canOperate ? "none" : "manipulation",
        userSelect: "none",
        WebkitUserSelect: "none",
        boxShadow: selected ? "0 0 12px rgba(78,163,255,.75)" : "none",
        transform: `rotate(${rotation}deg)`
      }}
    >
      {selectionOrder !== null && (
        <span
          style={{
            justifySelf: "start",
            alignSelf: "start",
            border: "1px solid #4ea3ff",
            borderRadius: 999,
            padding: "2px 7px",
            background: "#0f172a",
            color: "#fff",
            fontSize: 11,
            fontWeight: 700
          }}
        >
          {selectionOrder}
        </span>
      )}

      {cardImageUrl && canShowCardFace ? (
        <img
          src={cardImageUrl}
          draggable={false}
          decoding="async"
          alt={displayName ?? card.name}
          loading="lazy"
          style={{
            width: "100%",
            maxHeight: 128,
            objectFit: "contain",
            borderRadius: 6,
            background: "#111"
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            minHeight: 72,
            border: "1px dashed #475569",
            borderRadius: 6,
            display: "grid",
            placeItems: "center",
            padding: 6,
            background: "#020617",
            color: isHiddenDisplayName(displayName) ? "#94a3b8" : "#e2e8f0"
          }}
        >
          <strong>{displayName ?? card.name}</strong>
        </div>
      )}

      {cardImageUrl && canShowCardFace && (
        <strong>{displayName ?? card.name}</strong>
      )}

      {!cardImageUrl && canShowCardFace && (
        <span style={{ fontSize: 10, color: "#facc15" }}>
          プロキシ表示
        </span>
      )}

      <span style={{ fontSize: 11, opacity: 0.75 }}>
        {ZONE_LABELS[card.zone]}
      </span>

      {stackCount > 1 && (
        <span style={{ fontSize: 10, color: "#ffd166" }}>
          重なり：{stackCount}枚
        </span>
      )}

      {card.zone === "hand" && card.faceUp && (
        <span style={{ fontSize: 10, color: "#7ee787" }}>公開中</span>
      )}

      {selected && canOpenViewer && (
        <span style={{ fontSize: 10, color: "#7ee787" }}>
          {stackCount > 1 ? "もう一度クリックで詳細" : "もう一度クリックで表示"}
        </span>
      )}

      {canOperate && (
        <span style={{ fontSize: 10, opacity: 0.55 }}>
          右クリック/長押しで操作
        </span>
      )}
    </div>
  );
}, areCardBoxesEqual);


function CardDetailBlock({
  card,
  labelPrefix
}: {
  card: CardInstance;
  labelPrefix?: string;
}) {
  const imageUrl = getCardViewerImageUrl(card);
  const civilization = getCardDetailValue(card, "civilization");
  const cost = getCardDetailValue(card, "cost");
  const type = getCardDetailValue(card, "type");
  const race = getCardDetailValue(card, "race");
  const power = getCardDetailValue(card, "power");
  const cardText = getCardDetailValue(card, "text");

  return (
    <div
      style={{
        border: "1px solid #334155",
        borderRadius: 10,
        padding: 12,
        background: "#020617",
        display: "grid",
        gap: 10
      }}
    >
      {labelPrefix && (
        <span style={{ color: "#94a3b8", fontSize: 12 }}>{labelPrefix}</span>
      )}

      {imageUrl ? (
        <img
          src={imageUrl}
          draggable={false}
          decoding="async"
          alt={card.name}
          loading="lazy"
          style={{
            width: "100%",
            maxHeight: 360,
            objectFit: "contain",
            borderRadius: 8,
            background: "#111827"
          }}
        />
      ) : (
        <div
          style={{
            minHeight: 220,
            border: "1px dashed #475569",
            borderRadius: 8,
            padding: 16,
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            background: "#0f172a"
          }}
        >
          <div>
            <strong style={{ fontSize: 18 }}>{card.name}</strong>
            <p style={{ color: "#facc15", marginBottom: 0 }}>プロキシ表示</p>
          </div>
        </div>
      )}

      <div>
        <strong style={{ fontSize: 18 }}>{card.name}</strong>
        <p style={{ margin: "4px 0 0", color: "#cbd5e1", fontSize: 13 }}>
          所有者：{card.owner} / ゾーン：{ZONE_LABELS[card.zone]}
          {card.faceUp ? " / 表向き" : " / 裏向き"}
          {card.tapped ? " / タップ" : ""}
          {card.reversed ? " / 上下反転" : ""}
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 8,
          fontSize: 13
        }}
      >
        <span>文明：{civilization ?? "未登録"}</span>
        <span>コスト：{cost ?? "未登録"}</span>
        <span>タイプ：{type ?? "未登録"}</span>
        <span>種族：{race ?? "未登録"}</span>
        <span>パワー：{power ?? "未登録"}</span>
      </div>

      <section
        style={{
          border: "1px solid #334155",
          borderRadius: 8,
          padding: 10,
          background: "#0f172a",
          color: "#e2e8f0",
          whiteSpace: "pre-wrap",
          fontSize: 13,
          lineHeight: 1.6
        }}
      >
        <strong>能力テキスト</strong>
        <p style={{ margin: "6px 0 0" }}>
          {cardText ?? "未登録"}
        </p>
      </section>
    </div>
  );
}


function ModalCardFace({
  card,
  prefix,
  selected,
  onClick,
  onContextMenu
}: {
  card: CardInstance | null | undefined;
  prefix?: string;
  selected?: boolean;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  if (!card) {
    return (
      <div
        className={`modal-card-face ${selected ? "selected" : ""}`}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <strong>不明なカード</strong>
      </div>
    );
  }

  const imageUrl = getCardViewerImageUrl(card);

  return (
    <div
      className={`modal-card-face ${selected ? "selected" : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {prefix && <span>{prefix}</span>}

      {imageUrl ? (
        <img src={imageUrl} alt={card.name} loading="lazy" decoding="async" draggable={false} />
      ) : (
        <div className="modal-card-proxy">
          <strong>{card.name}</strong>
          <small>プロキシ表示</small>
        </div>
      )}

      <strong>{card.name}</strong>
    </div>
  );
}

function DeckBox({
  player,
  count,
  canOperate,
  deckVisibility,
  topCardName,
  onOpenSingleDeckMenu,
  onOpenMultiDeckMenu,
  onOpenMultiDeckTouchMenu
}: {
  player: PlayerSide;
  count: number;
  canOperate: boolean;
  deckVisibility: DeckVisibility;
  topCardName: string | null;
  onOpenSingleDeckMenu: (event: MouseEvent<HTMLButtonElement>, player: PlayerSide) => void;
  onOpenMultiDeckMenu: (event: MouseEvent<HTMLButtonElement>, player: PlayerSide) => void;
  onOpenMultiDeckTouchMenu: (element: HTMLElement, player: PlayerSide) => void;
}) {
  const isPublic = deckVisibility === "public";
  const longPressTimerRef = useRef<number | null>(null);

  function clearLongPressTimer() {
    if (!longPressTimerRef.current) return;

    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function handleTouchStart(event: TouchEvent<HTMLButtonElement>) {
    if (!canOperate) return;

    const touch = event.touches[0];
    if (!touch) return;

    event.preventDefault();
    clearLongPressTimer();

    const element = event.currentTarget;

    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      onOpenMultiDeckTouchMenu(element, player);
    }, 430);
  }

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, []);

  return (
    <button
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!canOperate) return;

        onOpenSingleDeckMenu(event, player);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!canOperate) return;

        onOpenMultiDeckMenu(event, player);
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={clearLongPressTimer}
      onTouchCancel={clearLongPressTimer}
      onTouchMove={clearLongPressTimer}
      disabled={!canOperate && !isPublic}
      style={{
        border: isPublic ? "1px solid #22c55e" : "1px solid #555",
        borderRadius: 10,
        padding: 12,
        background: isPublic ? "#071a0f" : "#050505",
        color: "#fff",
        cursor: canOperate ? "context-menu" : isPublic ? "default" : "not-allowed",
        touchAction: canOperate ? "none" : "manipulation",
        userSelect: "none",
        WebkitUserSelect: "none",
        textAlign: "left"
      }}
    >
      <strong>山札：{count} 枚</strong>
      <br />
      <span
        style={{
          fontSize: 12,
          color: isPublic ? "#86efac" : "#cbd5e1"
        }}
      >
        状態：{deckVisibilityLabel(deckVisibility)}
      </span>
      <br />
      {isPublic && (
        <>
          <span style={{ fontSize: 12, color: "#bbf7d0" }}>
            山札上：{topCardName ?? "カードなし"}
          </span>
          <br />
        </>
      )}
      {canOperate
        ? "ダブルクリック：1枚操作WASD / 右クリック・長押し：枚数指定WASD"
        : isPublic
          ? "公開中：山札上を確認できます"
          : "操作不可"}
    </button>
  );
}

function ZoneCardList({
  title,
  cardIds,
  roomState,
  myRole,
  viewerRole,
  revealAllHands,
  isInteractionDisabled,
  selectedCard,
  selectedCardIds,
  setSelectedCard,
  setSelectedCardIds,
  setViewerCard,
  onOpenMenu,
  onOpenTouchMenu
}: {
  title: string;
  cardIds: string[];
  roomState: RoomState;
  myRole: PlayerSide | "spectator" | null;
  viewerRole: PlayerSide | null;
  revealAllHands: boolean;
  isInteractionDisabled: boolean;
  selectedCard: CardInstance | null;
  selectedCardIds: string[];
  setSelectedCard: (card: CardInstance | null) => void;
  setSelectedCardIds: (cardIds: string[]) => void;
  setViewerCard: (card: CardInstance | null) => void;
  onOpenMenu: (event: MouseEvent<HTMLDivElement>, card: CardInstance) => void;
  onOpenTouchMenu: (element: HTMLElement, card: CardInstance) => void;
}) {
  const instances = roomState.cardInstances;

  return (
    <section
      style={{
        border: "1px solid #334155",
        borderRadius: 10,
        padding: 10,
        background: "#111827"
      }}
    >
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <p>{cardIds.length} 枚</p>

      {cardIds.length === 0 ? (
        <p className="muted">カードはありません。</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 8
          }}
        >
          {cardIds.map((cardId) => {
            const card = instances[cardId];
            if (!card) return null;

            const stackCards = card.stackId ? roomState.stacks[card.stackId] ?? [card.id] : [card.id];
            const stackTopId = stackCards[stackCards.length - 1];

            if (card.zone === "battle" && card.stackId && card.id !== stackTopId) {
              return null;
            }

            const selected = selectedCardIds.includes(card.id);
            const selectionOrder = selected ? selectedCardIds.indexOf(card.id) + 1 : null;
            const canOperate = myRole === card.owner && !isInteractionDisabled;
            const canOpenViewer = canOpenCardViewer(
              card,
              myRole,
              viewerRole,
              revealAllHands
            );

            return (
              <CardBox
                key={cardId}
                card={card}
                selected={selected}
                canOperate={canOperate}
                canOpenViewer={canOpenViewer}
                stackCount={stackCards.length}
                selectionOrder={selectionOrder}
                displayName={getVisibleCardName(
                  card,
                  myRole,
                  undefined,
                  viewerRole,
                  revealAllHands
                )}
                onClickCard={(event) => {
                  if ((event.ctrlKey || event.metaKey || event.shiftKey) && canOperate) {
                    setSelectedCard(card);
                    setSelectedCardIds(
                      selected
                        ? selectedCardIds.filter((id) => id !== card.id)
                        : [...selectedCardIds, card.id]
                    );
                    return;
                  }

                  if (selectedCard?.id === card.id && selectedCardIds.length === 1 && canOpenViewer) {
                    setViewerCard(card);
                    return;
                  }

                  setSelectedCard(card);
                  setSelectedCardIds([card.id]);
                }}
                onOpenMenu={onOpenMenu}
                onOpenTouchMenu={onOpenTouchMenu}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function ShieldList({
  shields,
  roomState,
  myRole,
  viewerRole,
  revealAllHands,
  isInteractionDisabled,
  selectedCard,
  selectedCardIds,
  setSelectedCard,
  setSelectedCardIds,
  setViewerCard,
  onOpenMenu,
  onOpenTouchMenu
}: {
  shields: string[][];
  roomState: RoomState;
  myRole: PlayerSide | "spectator" | null;
  viewerRole: PlayerSide | null;
  revealAllHands: boolean;
  isInteractionDisabled: boolean;
  selectedCard: CardInstance | null;
  selectedCardIds: string[];
  setSelectedCard: (card: CardInstance | null) => void;
  setSelectedCardIds: (cardIds: string[]) => void;
  setViewerCard: (card: CardInstance | null) => void;
  onOpenMenu: (event: MouseEvent<HTMLDivElement>, card: CardInstance) => void;
  onOpenTouchMenu: (element: HTMLElement, card: CardInstance) => void;
}) {
  const instances = roomState.cardInstances;
  const topShieldCards = shields
    .map((stack) => stack[stack.length - 1])
    .filter(Boolean);

  return (
    <section
      style={{
        border: "1px solid #334155",
        borderRadius: 10,
        padding: 10,
        background: "#111827"
      }}
    >
      <h3 style={{ marginTop: 0 }}>シールド</h3>
      <p>{shields.length} 枚</p>

      {topShieldCards.length === 0 ? (
        <p className="muted">シールドはありません。</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 8
          }}
        >
          {topShieldCards.map((cardId, index) => {
            const card = instances[cardId];
            if (!card) return null;

            const selected = selectedCardIds.includes(card.id);
            const selectionOrder = selected ? selectedCardIds.indexOf(card.id) + 1 : null;
            const canOperate = myRole === card.owner && !isInteractionDisabled;
            const canOpenViewer = canOpenCardViewer(
              card,
              myRole,
              viewerRole,
              revealAllHands
            );

            return (
              <CardBox
                key={`${cardId}-${index}`}
                card={card}
                selected={selected}
                canOperate={canOperate}
                canOpenViewer={canOpenViewer}
                stackCount={1}
                selectionOrder={selectionOrder}
                displayName={getVisibleCardName(
                  card,
                  myRole,
                  `シールド ${index + 1}`,
                  viewerRole,
                  revealAllHands
                )}
                onClickCard={(event) => {
                  if ((event.ctrlKey || event.metaKey || event.shiftKey) && canOperate) {
                    setSelectedCard(card);
                    setSelectedCardIds(
                      selected
                        ? selectedCardIds.filter((id) => id !== card.id)
                        : [...selectedCardIds, card.id]
                    );
                    return;
                  }

                  if (selectedCard?.id === card.id && selectedCardIds.length === 1 && canOpenViewer) {
                    setViewerCard(card);
                    return;
                  }

                  setSelectedCard(card);
                  setSelectedCardIds([card.id]);
                }}
                onOpenMenu={onOpenMenu}
                onOpenTouchMenu={onOpenTouchMenu}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}


function SupplyPreviewBlock({
  player
}: {
  player: PlayerSide;
}) {
  return (
    <section
      style={{
        border: "1px dashed #475569",
        borderRadius: 10,
        padding: 10,
        background: "#0f172a",
        color: "#cbd5e1",
        fontSize: 13
      }}
    >
      <strong>サプライ枠</strong>
      <p style={{ margin: "6px 0 0" }}>
        {player} 側のサプライ表示予定枠です。後で player1 が設定したサプライを両プレイヤー視点へ反映します。
      </p>
      <p style={{ margin: "6px 0 0", color: "#94a3b8" }}>
        サプライ画像の追加/削除は管理者のみが行う想定です。
      </p>
    </section>
  );
}

function PlayerBoard({
  player,
  roomState,
  myRole,
  viewerRole,
  revealAllHands,
  isInteractionDisabled,
  selectedCard,
  selectedCardIds,
  setSelectedCard,
  setSelectedCardIds,
  setViewerCard,
  onOpenMenu,
  onOpenTouchMenu,
  onOpenSingleDeckMenu,
  onOpenMultiDeckMenu,
  onOpenMultiDeckTouchMenu
}: {
  player: PlayerSide;
  roomState: RoomState;
  myRole: PlayerSide | "spectator" | null;
  viewerRole: PlayerSide | null;
  revealAllHands: boolean;
  isInteractionDisabled: boolean;
  selectedCard: CardInstance | null;
  selectedCardIds: string[];
  setSelectedCard: (card: CardInstance | null) => void;
  setSelectedCardIds: (cardIds: string[]) => void;
  setViewerCard: (card: CardInstance | null) => void;
  onOpenMenu: (event: MouseEvent<HTMLDivElement>, card: CardInstance) => void;
  onOpenTouchMenu: (element: HTMLElement, card: CardInstance) => void;
  onOpenSingleDeckMenu: (event: MouseEvent<HTMLButtonElement>, player: PlayerSide) => void;
  onOpenMultiDeckMenu: (event: MouseEvent<HTMLButtonElement>, player: PlayerSide) => void;
  onOpenMultiDeckTouchMenu: (element: HTMLElement, player: PlayerSide) => void;
}) {
  const board = roomState.players[player];
  const deckVisibility = getDeckVisibility(roomState, player);
  const canOperateDeck = myRole === player && !isInteractionDisabled;
  const deckTopCardId = board.deckOrder[0] ?? null;
  const deckTopCard = deckTopCardId ? roomState.cardInstances[deckTopCardId] : null;
  const deckTopCardName = deckVisibility === "public" ? deckTopCard?.name ?? null : null;
  const isOpponent = myRole !== player && myRole !== "spectator";

  function renderCards(
    cardIds: string[],
    options?: { compact?: boolean; shieldLabel?: boolean }
  ) {
    const compact = options?.compact ?? false;

    if (cardIds.length === 0) {
      return (
        <div style={{ color: "#666", fontSize: 11, textAlign: "center" }}>
          空
        </div>
      );
    }

    return (
      <div
        style={{
          display: "flex",
          flexWrap: "nowrap",
          gap: compact ? 5 : 7,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          minWidth: 0
        }}
      >
        {cardIds.map((cardId, index) => {
          const card = roomState.cardInstances[cardId];
          if (!card) return null;

          const stackCards = card.stackId ? roomState.stacks[card.stackId] ?? [card.id] : [card.id];
          const stackTopId = stackCards[stackCards.length - 1];

          if (card.zone === "battle" && card.stackId && card.id !== stackTopId) {
            return null;
          }

          const selected = selectedCardIds.includes(card.id);
          const selectionOrder = selected ? selectedCardIds.indexOf(card.id) + 1 : null;
          const canOperate = myRole === card.owner && !isInteractionDisabled;
          const canOpenViewer = canOpenCardViewer(card, myRole, viewerRole, revealAllHands);

          return (
            <div
              key={`${cardId}-${index}`}
              style={{
                width: compact ? 72 : 105,
                minWidth: compact ? 72 : 105
              }}
            >
              <CardBox
                card={card}
                selected={selected}
                canOperate={canOperate}
                canOpenViewer={canOpenViewer}
                stackCount={stackCards.length}
                selectionOrder={selectionOrder}
                displayName={getVisibleCardName(
                  card,
                  myRole,
                  options?.shieldLabel ? `シールド ${index + 1}` : undefined,
                  viewerRole,
                  revealAllHands
                )}
                onClickCard={(event) => {
                  if ((event.ctrlKey || event.metaKey || event.shiftKey) && canOperate) {
                    setSelectedCard(card);
                    setSelectedCardIds(
                      selected
                        ? selectedCardIds.filter((id) => id !== card.id)
                        : [...selectedCardIds, card.id]
                    );
                    return;
                  }

                  if (selectedCard?.id === card.id && selectedCardIds.length === 1 && canOpenViewer) {
                    setViewerCard(card);
                    return;
                  }

                  setSelectedCard(card);
                  setSelectedCardIds([card.id]);
                }}
                onOpenMenu={onOpenMenu}
                onOpenTouchMenu={onOpenTouchMenu}
              />
            </div>
          );
        })}
      </div>
    );
  }

  const topShieldCards = board.shields
    .map((stack) => stack[stack.length - 1])
    .filter(Boolean);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          transform: isOpponent ? "rotate(180deg)" : undefined
        }}
      >
        {renderCards(board.mana, { compact: true })}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isOpponent ? "auto 1fr" : "1fr auto",
          gap: 8,
          alignItems: "center",
          overflow: "hidden"
        }}
      >
        {isOpponent && (
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <div
              style={{
                width: 70,
                height: 98,
                border: "1px dashed #666",
                borderRadius: 8,
                background: "#303030",
                display: "grid",
                placeItems: "center",
                color: "#ddd",
                fontSize: 12,
                position: "relative",
                transform: "rotate(180deg)"
              }}
            >
              墓地
              <span style={{ position: "absolute", right: 4, bottom: 4, fontSize: 10 }}>
                {board.grave.length}
              </span>
            </div>
            <div style={{ transform: "rotate(180deg)" }}>
              <DeckBox
                player={player}
                count={board.deckOrder.length}
                canOperate={canOperateDeck}
                deckVisibility={deckVisibility}
                topCardName={deckTopCardName}
                onOpenSingleDeckMenu={onOpenSingleDeckMenu}
                onOpenMultiDeckMenu={onOpenMultiDeckMenu}
                onOpenMultiDeckTouchMenu={onOpenMultiDeckTouchMenu}
              />
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: isOpponent ? "flex-start" : "flex-end",
            gap: 6,
            overflow: "hidden"
          }}
        >
          {renderCards(topShieldCards, { compact: true, shieldLabel: true })}
        </div>

        {!isOpponent && (
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <DeckBox
              player={player}
              count={board.deckOrder.length}
              canOperate={canOperateDeck}
              deckVisibility={deckVisibility}
              topCardName={deckTopCardName}
              onOpenSingleDeckMenu={onOpenSingleDeckMenu}
              onOpenMultiDeckMenu={onOpenMultiDeckMenu}
              onOpenMultiDeckTouchMenu={onOpenMultiDeckTouchMenu}
            />
            <div
              style={{
                width: 70,
                height: 98,
                border: "1px dashed #666",
                borderRadius: 8,
                background: "#303030",
                display: "grid",
                placeItems: "center",
                color: "#ddd",
                fontSize: 12,
                position: "relative"
              }}
            >
              墓地
              <span style={{ position: "absolute", right: 4, bottom: 4, fontSize: 10 }}>
                {board.grave.length}
              </span>
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          transform: isOpponent ? "rotate(180deg)" : undefined
        }}
      >
        {renderCards(board.battle)}
      </div>
    </>
  );
}

export function SimpleBoard({
  roomState,
  myRole,
  isInteractionDisabled = false,
  onDrawCard,
  onMoveCard,
  onBreakShield,
  onToggleTapped,
  onToggleReversed,
  onToggleFaceUp,
  onToggleMultipleCardOrientation,
  onMoveCardToDeckTop,
  onMoveCardToDeckBottom,
  onMoveCardToDeckAndShuffle,
  onMoveCardToManaFaceUp,
  onMoveCardToManaFaceDown,
  onShuffleDeck,
  onPeekDeck,
  onMoveDeckCardsToZone,
  onSendDeckTopToBottom,
  onRevealCard,
  onCancelAllRevealedCards,
  onInspectMultipleDeck,
  onInspectPublicDeck,
  onInspectDeckSelectModal,
  onStackCardToBattle,
  onMoveMultipleCards,
  onSealTopCard,
  onMoveTopStackCardToGrave,
  onMoveStackSourceOnly,
  onSetDeckVisibility,
  onStartCheckingStatus,
  onClearCheckingStatus,
}: SimpleBoardProps) {
  const [selectedCard, setSelectedCard] = useState<CardInstance | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [viewerCard, setViewerCard] = useState<CardInstance | null>(null);
  const [menuState, setMenuState] = useState<MenuState>(null);
  const [deckPreview, setDeckPreview] = useState<DeckPreviewState>(null);
  const [deckPreviewSelectedCardIds, setDeckPreviewSelectedCardIds] = useState<string[]>([]);
  const [deckSelectModal, setDeckSelectModal] = useState<DeckSelectModalState>(null);
  const [shieldBreakModal, setShieldBreakModal] = useState<ShieldBreakModalState>(null);
  const [graveModal, setGraveModal] = useState<GraveModalState>(null);
  const [spectatorViewMode, setSpectatorViewMode] =
    useState<SpectatorViewMode>("player1");
  const [spectatorSwitchCount, setSpectatorSwitchCount] = useState(0);
  const [spectatorLastSwitchAt, setSpectatorLastSwitchAt] = useState(0);
  const [spectatorViewMessage, setSpectatorViewMessage] = useState("");
  const [showOperationGuide, setShowOperationGuide] = useState(false);

  const viewerStackIds = useMemo(
    () =>
      viewerCard
        ? viewerCard.stackId
          ? roomState.stacks[viewerCard.stackId] ?? [viewerCard.id]
          : [viewerCard.id]
        : [],
    [viewerCard, roomState.stacks]
  );

  const viewerStackCards = useMemo(
    () =>
      viewerStackIds
        .map((cardId) => roomState.cardInstances[cardId])
        .filter((card): card is CardInstance => Boolean(card)),
    [viewerStackIds, roomState.cardInstances]
  );

  const selectedCompareCards = useMemo(
    () =>
      selectedCardIds
        .map((cardId) => roomState.cardInstances[cardId])
        .filter((card): card is CardInstance => Boolean(card)),
    [selectedCardIds, roomState.cardInstances]
  );

  const selectedSingleCard = useMemo(
    () =>
      selectedCardIds.length === 1
        ? roomState.cardInstances[selectedCardIds[0]] ?? null
        : null,
    [selectedCardIds, roomState.cardInstances]
  );

  const canUseSingleCardQuickActions =
    myRole !== null &&
    myRole !== "spectator" &&
    Boolean(selectedSingleCard) &&
    selectedSingleCard?.owner === myRole &&
    !isInteractionDisabled;

  const selectedCardsBelongToMe =
    myRole !== null &&
    myRole !== "spectator" &&
    selectedCompareCards.length > 0 &&
    selectedCompareCards.every((card) => card.owner === myRole);

  const canUseMultipleMove =
    selectedCompareCards.length >= 2 &&
    selectedCardsBelongToMe &&
    !isInteractionDisabled;

  const selectedCardsSummary = useMemo(
    () =>
      selectedCompareCards.length > 0
        ? selectedCompareCards
            .map((card, index) => `${index + 1}. ${getVisibleCardName(card, myRole)}`)
            .join(" / ")
        : "",
    [selectedCompareCards, myRole]
  );

  const checkingStatus = getCheckingStatus(roomState);

  const checkingStatusMessage = checkingStatus
    ? checkingStatus.player === myRole
      ? checkingStatus.mode === "public_checking"
        ? "あなたが山札を公開確認中です。確認を終えると通知が解除されます。"
        : "あなたが確認中です。確認を終えると通知が解除されます。"
      : `${checkingStatus.player}が確認中です。確認場所や内容は非公開です。`
    : "";

  const spectatorViewerRole: PlayerSide | null =
    myRole === "spectator"
      ? spectatorViewMode === "player2" || spectatorViewMode === "player2_open_hands"
        ? "player2"
        : "player1"
      : null;

  const revealAllHands =
    myRole === "spectator" &&
    (spectatorViewMode === "player1_open_hands" ||
      spectatorViewMode === "player2_open_hands");

  const spectatorViewLabel =
    spectatorViewMode === "player1"
      ? "player1視点"
      : spectatorViewMode === "player2"
        ? "player2視点"
        : spectatorViewMode === "player1_open_hands"
          ? "player1視点＋両手札公開"
          : "player2視点＋両手札公開";

  const spectatorFreeSwitchesLeft = Math.max(
    0,
    SPECTATOR_FREE_SWITCH_LIMIT - spectatorSwitchCount
  );

  const boardOrder: PlayerSide[] = useMemo(
    () =>
      myRole === "spectator"
        ? spectatorViewerRole === "player1"
          ? ["player2", "player1"]
          : ["player1", "player2"]
        : ["player2", "player1"],
    [myRole, spectatorViewerRole]
  );

  const visibleBoardOrder = useMemo(
    () =>
      boardOrder.filter((player) => {
        const board = roomState.players[player];
        return (
          board.deckOrder.length > 0 ||
          board.hand.length > 0 ||
          board.battle.length > 0 ||
          board.mana.length > 0 ||
          board.grave.length > 0 ||
          board.shields.length > 0 ||
          myRole === "spectator"
        );
      }),
    [boardOrder, roomState.players, myRole]
  );

  useEffect(() => {
    setSelectedCardIds((currentIds) => {
      const nextIds = currentIds.filter((cardId) => Boolean(roomState.cardInstances[cardId]));
      return nextIds.length === currentIds.length ? currentIds : nextIds;
    });

    setSelectedCard((currentCard) =>
      currentCard && roomState.cardInstances[currentCard.id]
        ? roomState.cardInstances[currentCard.id]
        : null
    );

    setViewerCard((currentCard) =>
      currentCard && roomState.cardInstances[currentCard.id]
        ? roomState.cardInstances[currentCard.id]
        : null
    );
  }, [roomState.cardInstances]);

  const visibleImageUrls = useMemo(() => {
    const urls = new Set<string>();

    visibleBoardOrder.forEach((player) => {
      const board = roomState.players[player];
      const visibleCardIds = [
        ...board.battle,
        ...board.mana,
        ...board.grave,
        ...board.hand,
        ...board.shields.flatMap((stack) => stack)
      ];

      visibleCardIds.forEach((cardId) => {
        const card = roomState.cardInstances[cardId];
        if (!card) return;

        const imageUrl = getCardThumbnailUrl(card);
        if (imageUrl) urls.add(imageUrl);
      });
    });

    viewerStackCards.forEach((card) => {
      const imageUrl = getCardViewerImageUrl(card);
      if (imageUrl) urls.add(imageUrl);
    });

    return Array.from(urls).slice(0, 120);
  }, [visibleBoardOrder, roomState.players, roomState.cardInstances, viewerStackCards]);

  useEffect(() => {
    visibleImageUrls.forEach(preloadCardImage);
  }, [visibleImageUrls]);

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;

      const tagName = target.tagName.toLowerCase();
      return (
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        target.isContentEditable
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;

      const key = event.key.toLowerCase();

      if (key === "t" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (myRole === "player1" || myRole === "player2") {
          event.preventDefault();
          setMenuState(null);
          onDrawCard(myRole);
        }

        return;
      }

      if (key !== "escape") return;

      event.preventDefault();

      if (deckPreview) {
        closeDeckPreview();
        return;
      }

      if (deckSelectModal) {
        closeDeckSelectModal();
        return;
      }

      if (shieldBreakModal) {
        setShieldBreakModal(null);
        return;
      }

      if (graveModal) {
        setGraveModal(null);
        return;
      }

      if (menuState) {
        setMenuState(null);
        return;
      }

      if (viewerCard) {
        setViewerCard(null);
        return;
      }

      if (selectedCardIds.length > 1) {
        setSelectedCard(null);
        setSelectedCardIds([]);
        return;
      }

      onCancelAllRevealedCards();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    deckPreview,
    deckSelectModal,
    menuState,
    myRole,
    onCancelAllRevealedCards,
    onDrawCard,
    selectedCardIds.length,
    graveModal,
    shieldBreakModal,
    viewerCard
  ]);

  function openCardMenu(event: MouseEvent<HTMLDivElement>, card: CardInstance) {
    event.preventDefault();
    event.stopPropagation();

    if (isInteractionDisabled || myRole === "spectator" || card.owner !== myRole) return;

    setSelectedCard(card);
    if (!selectedCardIds.includes(card.id)) {
      setSelectedCardIds([card.id]);
    }
    setMenuState({
      type: "card",
      ...getMenuPositionFromElement(event.currentTarget),
      card,
      root: createMenuForCard(card)
    });
  }


  function openCardTouchMenu(element: HTMLElement, card: CardInstance) {
    if (isInteractionDisabled || myRole === "spectator" || card.owner !== myRole) return;

    setSelectedCard(card);
    if (!selectedCardIds.includes(card.id)) {
      setSelectedCardIds([card.id]);
    }
    setMenuState({
      type: "card",
      ...getMenuPositionFromElement(element),
      card,
      root: createMenuForCard(card)
    });
  }

  function openSingleDeckMenu(event: MouseEvent<HTMLButtonElement>, player: PlayerSide) {
    event.preventDefault();
    event.stopPropagation();

    if (isInteractionDisabled || myRole !== player) return;

    setMenuState({
      type: "deck",
      ...getMenuPositionFromElement(event.currentTarget),
      player,
      count: 1,
      root: createDeckMenu(1)
    });
  }

  function openMultiDeckMenu(event: MouseEvent<HTMLButtonElement>, player: PlayerSide) {
    event.preventDefault();
    event.stopPropagation();

    if (isInteractionDisabled || myRole !== player) return;

    const menuPosition = {
      x: Math.min(Math.max(event.clientX, 160), window.innerWidth - 160),
      y: Math.min(Math.max(event.clientY, 120), window.innerHeight - 180)
    };

    const raw = window.prompt("山札から操作する枚数を入力してください。", "1");
    if (!raw) return;

    const parsed = Number.parseInt(raw, 10);
    const count = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

    window.setTimeout(() => {
      setMenuState({
        type: "deck",
        ...menuPosition,
        player,
        count,
        root: createDeckMenu(count)
      });
    }, 0);
  }


  function openMultiDeckTouchMenu(element: HTMLElement, player: PlayerSide) {
    if (isInteractionDisabled || myRole !== player) return;

    const elementPosition = getMenuPositionFromElement(element);
    const menuPosition = {
      x: Math.min(Math.max(elementPosition.x, 160), window.innerWidth - 160),
      y: Math.min(Math.max(elementPosition.y, 120), window.innerHeight - 180)
    };

    const raw = window.prompt("山札から操作する枚数を入力してください。", "1");
    if (!raw) return;

    const parsed = Number.parseInt(raw, 10);
    const count = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

    window.setTimeout(() => {
      setMenuState({
        type: "deck",
        ...menuPosition,
        player,
        count,
        root: createDeckMenu(count)
      });
    }, 0);
  }

  function getZoneFromCardAction(action: BoardMenuAction): Zone | null {
    switch (action) {
      case "move_hand":
        return "hand";
      case "move_battle":
      case "use_to_battle":
        return "battle";
      case "move_mana":
        return "mana";
      case "move_grave":
        return "grave";
      case "move_shield":
        return "shield";
      default:
        return null;
    }
  }

  function handleCardMenuAction(action: BoardMenuAction, cardId: string) {
    if (isInteractionDisabled) return;

    const multiMoveZone = getZoneFromCardAction(action);
    const orientationKind =
      action === "toggle_tapped"
        ? "tapped"
        : action === "toggle_reversed"
          ? "reversed"
          : action === "toggle_face_up"
            ? "faceUp"
            : null;

    if (
      orientationKind &&
      selectedCardIds.length > 1 &&
      selectedCardIds.includes(cardId)
    ) {
      if (onToggleMultipleCardOrientation) {
        onToggleMultipleCardOrientation(selectedCardIds, orientationKind);
      } else {
        selectedCardIds.forEach((selectedId) => {
          if (orientationKind === "tapped") onToggleTapped(selectedId);
          if (orientationKind === "reversed") onToggleReversed(selectedId);
          if (orientationKind === "faceUp") onToggleFaceUp(selectedId);
        });
      }

      setSelectedCard(null);
      setSelectedCardIds([]);
      return;
    }

    if (
      multiMoveZone &&
      selectedCardIds.length > 1 &&
      selectedCardIds.includes(cardId)
    ) {
      onMoveMultipleCards(selectedCardIds, multiMoveZone);
      setSelectedCard(null);
      setSelectedCardIds([]);
      return;
    }

    switch (action) {
      case "toggle_tapped":
        onToggleTapped(cardId);
        return;
      case "toggle_reversed":
        onToggleReversed(cardId);
        return;
      case "toggle_face_up":
        onToggleFaceUp(cardId);
        return;
      case "reveal_to_opponent":
        onRevealCard(cardId);
        return;
      case "move_hand":
        onMoveCard(cardId, "hand");
        return;
      case "move_battle":
      case "use_to_battle":
        onMoveCard(cardId, "battle");
        return;
      case "use_stack_to_battle":
        onStackCardToBattle(cardId);
        return;
      case "move_mana":
        onMoveCard(cardId, "mana");
        return;
      case "move_mana_face_up":
        onMoveCardToManaFaceUp(cardId);
        return;
      case "move_mana_face_down":
        onMoveCardToManaFaceDown(cardId);
        return;
      case "move_grave":
        onMoveCard(cardId, "grave");
        return;
      case "move_shield":
        onMoveCard(cardId, "shield");
        return;
      case "move_deck_top":
        onMoveCardToDeckTop(cardId);
        return;
      case "move_deck_bottom":
        onMoveCardToDeckBottom(cardId);
        return;
      case "move_deck_shuffle":
        onMoveCardToDeckAndShuffle(cardId);
        return;
      case "break_shield": {
        const card = roomState.cardInstances[cardId];

        if (!card) return;

        setShieldBreakModal({ card });
        return;
      }
      case "seal_from_deck":
        onSealTopCard?.(cardId);
        return;
      case "seal_to_grave":
        onMoveTopStackCardToGrave?.(cardId);
        return;
      case "source_to_hand":
        onMoveStackSourceOnly?.(cardId, "hand");
        return;
      case "source_to_shield":
        onMoveStackSourceOnly?.(cardId, "shield");
        return;
      case "source_to_mana":
        onMoveStackSourceOnly?.(cardId, "mana");
        return;
      case "source_to_grave":
        onMoveStackSourceOnly?.(cardId, "grave");
        return;
      default:
        console.info("未接続のカード操作:", action);
    }
  }

  function openDeckPreview(
    player: PlayerSide,
    direction: "top" | "bottom",
    count: number
  ) {
    const deckOrder = roomState.players[player].deckOrder;
    const safeCount = Math.max(1, Math.min(count, deckOrder.length));

    if (safeCount <= 0) {
      setDeckPreview({
        player,
        direction,
        count: 0,
        cardIds: []
      });
      return;
    }

    const cardIds =
      direction === "top"
        ? deckOrder.slice(0, safeCount)
        : deckOrder.slice(-safeCount);

    setMenuState(null);
    setDeckPreviewSelectedCardIds([]);
    setDeckPreview({
      player,
      direction,
      count: safeCount,
      cardIds
    });

    onStartCheckingStatus(player, "checking");
    onPeekDeck(player, direction, safeCount);
  }

  function openDeckSelectModal(
    player: PlayerSide,
    count: number,
    publicCheck: boolean
  ) {
    const deckOrder = roomState.players[player].deckOrder;
    const safeCount = Math.max(1, Math.min(count, deckOrder.length));

    if (safeCount <= 0) {
      setDeckSelectModal({
        player,
        count: 0,
        publicCheck,
        cardIds: [],
        cardActions: {},
        remainingAction: "keep",
        orderedRemainingIds: []
      });
      return;
    }

    const checkedCardIds = deckOrder.slice(0, safeCount);

    setMenuState(null);
    setDeckSelectModal({
      player,
      count: safeCount,
      publicCheck,
      cardIds: checkedCardIds,
      cardActions: Object.fromEntries(
        checkedCardIds.map((cardId) => [cardId, "keep" as DeckSelectCardAction])
      ),
      remainingAction: "keep",
      orderedRemainingIds: checkedCardIds
    });

    onStartCheckingStatus(player, publicCheck ? "public_checking" : "checking");
  }

  function closeDeckPreview() {
    if (deckPreview) {
      onClearCheckingStatus(deckPreview.player);
    }

    setDeckPreviewSelectedCardIds([]);
    setSelectedCard(null);
    setSelectedCardIds([]);
    setDeckPreview(null);
  }

  function closeDeckSelectModal() {
    if (deckSelectModal) {
      onClearCheckingStatus(deckSelectModal.player);
    }

    setDeckSelectModal(null);
  }


  useEffect(() => {
    return () => {
      if (deckPreview) {
        onClearCheckingStatus(deckPreview.player);
      }

      if (deckSelectModal) {
        onClearCheckingStatus(deckSelectModal.player);
      }
    };
  }, [deckPreview, deckSelectModal, onClearCheckingStatus]);

  function getDeckSelectRemainingIds(modal: NonNullable<DeckSelectModalState>) {
    return modal.cardIds.filter((cardId) => modal.cardActions[cardId] === "keep");
  }

  function getDeckSelectOrderedRemainingIds(modal: NonNullable<DeckSelectModalState>) {
    const remainingIds = getDeckSelectRemainingIds(modal);
    const remainingSet = new Set(remainingIds);
    const orderedIds = modal.orderedRemainingIds.filter((cardId) =>
      remainingSet.has(cardId)
    );
    const missingIds = remainingIds.filter((cardId) => !orderedIds.includes(cardId));

    return [...orderedIds, ...missingIds];
  }

  function moveDeckSelectOrderItem(cardId: string, direction: "up" | "down") {
    if (!deckSelectModal) return;

    const orderedIds = getDeckSelectOrderedRemainingIds(deckSelectModal);
    const index = orderedIds.indexOf(cardId);

    if (index < 0) return;

    const nextIndex = direction === "up" ? index - 1 : index + 1;

    if (nextIndex < 0 || nextIndex >= orderedIds.length) return;

    const nextOrderedIds = [...orderedIds];
    [nextOrderedIds[index], nextOrderedIds[nextIndex]] = [
      nextOrderedIds[nextIndex],
      nextOrderedIds[index]
    ];

    setDeckSelectModal({
      ...deckSelectModal,
      orderedRemainingIds: nextOrderedIds
    });
  }

  function toggleSelectedCardFromModal(card: CardInstance, append: boolean) {
    const canOperate = myRole === card.owner && !isInteractionDisabled;

    if (!canOperate) {
      if (canOpenCardViewer(card, myRole, spectatorViewerRole, revealAllHands)) {
        setViewerCard(card);
      }
      return;
    }

    setSelectedCard(card);

    if (append) {
      setSelectedCardIds((previous) =>
        previous.includes(card.id)
          ? previous.filter((id) => id !== card.id)
          : [...previous, card.id]
      );
      return;
    }

    setSelectedCardIds([card.id]);
  }

  function openModalCardContextMenu(
    event: MouseEvent<HTMLDivElement>,
    card: CardInstance
  ) {
    event.preventDefault();
    event.stopPropagation();

    const canOperate = myRole === card.owner && !isInteractionDisabled;

    if (!canOperate) {
      if (canOpenCardViewer(card, myRole, spectatorViewerRole, revealAllHands)) {
        setViewerCard(card);
      }
      return;
    }

    setSelectedCard(card);

    if (!selectedCardIds.includes(card.id)) {
      setSelectedCardIds([card.id]);
    }

    openCardMenu(event, card);
  }

  function handleDeckMenuAction(action: BoardMenuAction, player: PlayerSide, count: number) {
    if (isInteractionDisabled) return;

    if (action === "deck_public") {
      onSetDeckVisibility(player, "public");
      return;
    }

    if (action === "deck_private") {
      onSetDeckVisibility(player, "private");
      return;
    }

    switch (action) {
      case "draw_one":
        onDrawCard(player);
        return;
      case "shuffle_deck":
        onShuffleDeck(player);
        return;
      case "look_deck_top":
        openDeckPreview(player, "top", count);
        return;
      case "look_deck_bottom":
        openDeckPreview(player, "bottom", count);
        return;
      case "send_deck_bottom":
        onSendDeckTopToBottom(player, count);
        return;
      case "move_hand":
        onMoveDeckCardsToZone(player, "hand", count);
        return;
      case "move_shield":
        onMoveDeckCardsToZone(player, "shield", count);
        return;
      case "move_mana":
        onMoveDeckCardsToZone(player, "mana", count);
        return;
      case "move_grave":
        onMoveDeckCardsToZone(player, "grave", count);
        return;
      case "inspect_multiple":
        openDeckSelectModal(player, count, false);
        return;
      case "inspect_public_deck":
        openDeckSelectModal(player, count, true);
        onInspectPublicDeck(player, count);
        return;
      default:
        console.info("未接続の山札操作:", action);
    }
  }

  function handleMenuAction(action: BoardMenuAction) {
    if (!menuState) return;

    const currentMenuState = menuState;
    setMenuState(null);

    if (myRole === "spectator" || isInteractionDisabled) {
      return;
    }

    if (currentMenuState.type === "card") {
      handleCardMenuAction(action, currentMenuState.card.id);
      return;
    }

    handleDeckMenuAction(
      action,
      currentMenuState.player,
      currentMenuState.count
    );
  }

  function changeSpectatorViewMode(nextMode: SpectatorViewMode) {
    if (myRole !== "spectator") return;

    if (nextMode === spectatorViewMode) {
      setSpectatorViewMessage("すでに選択中の観戦視点です。");
      return;
    }

    const now = Date.now();

    if (
      spectatorSwitchCount >= SPECTATOR_FREE_SWITCH_LIMIT &&
      now - spectatorLastSwitchAt < SPECTATOR_SWITCH_COOLDOWN_MS
    ) {
      const remainingSeconds = Math.ceil(
        (SPECTATOR_SWITCH_COOLDOWN_MS - (now - spectatorLastSwitchAt)) / 1000
      );

      setSpectatorViewMessage(
        `視点切り替えはあと${remainingSeconds}秒後にできます。`
      );
      return;
    }

    const nextSwitchCount = spectatorSwitchCount + 1;

    setSpectatorViewMode(nextMode);
    setSpectatorSwitchCount(nextSwitchCount);
    setSpectatorLastSwitchAt(now);
    setSelectedCard(null);
    setSelectedCardIds([]);
    setViewerCard(null);
    setMenuState(null);
    closeDeckPreview();
    closeDeckSelectModal();
    setShieldBreakModal(null);
    setGraveModal(null);
    setSpectatorViewMessage(
      nextSwitchCount >= SPECTATOR_FREE_SWITCH_LIMIT
        ? "視点を切り替えました。次回以降は20秒のクールタイムがあります。"
        : "視点を切り替えました。"
    );
  }


  function getDisplayPlayers(): { upperPlayer: PlayerSide; lowerPlayer: PlayerSide } {
    if (myRole === "player2") return { upperPlayer: "player1", lowerPlayer: "player2" };

    if (myRole === "spectator") {
      const lowerPlayer = spectatorViewerRole === "player2" ? "player2" : "player1";
      return {
        upperPlayer: lowerPlayer === "player1" ? "player2" : "player1",
        lowerPlayer
      };
    }

    return { upperPlayer: "player2", lowerPlayer: "player1" };
  }

  const getTopShieldCardIds = useCallback(
    (player: PlayerSide) =>
      roomState.players[player].shields
        .map((stack) => stack[stack.length - 1])
        .filter(Boolean),
    [roomState.players]
  );

  const handleHtmlCardClick = useCallback((
    event: MouseEvent<HTMLDivElement>,
    card: CardInstance,
    canOperate: boolean,
    canOpenViewer: boolean
  ) => {
    if (!canOperate) {
      setMenuState(null);
      setSelectedCard(null);
      setSelectedCardIds([]);

      if (canOpenViewer) {
        setViewerCard(card);
      }

      return;
    }

    if ((event.ctrlKey || event.metaKey || event.shiftKey) && canOperate) {
      setSelectedCard(card);
      setSelectedCardIds(
        selectedCardIds.includes(card.id)
          ? selectedCardIds.filter((id) => id !== card.id)
          : [...selectedCardIds, card.id]
      );
      return;
    }

    if (selectedCard?.id === card.id && selectedCardIds.length === 1 && canOpenViewer) {
      setViewerCard(card);
      return;
    }

    setSelectedCard(card);
    setSelectedCardIds([card.id]);
  }, [selectedCard?.id, selectedCardIds]);

  function renderHtmlCard(
    cardId: string,
    className: string,
    ownerLabel: "me" | "opp",
    fallback?: string,
    extraStyle?: CSSProperties
  ) {
    const card = roomState.cardInstances[cardId];
    if (!card) return null;

    const stackCards = card.stackId ? roomState.stacks[card.stackId] ?? [card.id] : [card.id];
    const stackTopId = stackCards[stackCards.length - 1];

    if (card.zone === "battle" && card.stackId && card.id !== stackTopId) return null;

    const canOperate = myRole === card.owner && !isInteractionDisabled;
    const canOpenViewer = canOpenCardViewer(card, myRole, spectatorViewerRole, revealAllHands);
    const selected = selectedCardIds.includes(card.id);
    const visibleName = getVisibleCardName(card, myRole, fallback, spectatorViewerRole, revealAllHands);
    const imageUrl = getCardThumbnailUrl(card);
    const showFace = canOpenViewer && !isHiddenDisplayName(visibleName);
    const isFaceDown = !showFace || isHiddenDisplayName(visibleName);
    const selectedOrder = selected ? selectedCardIds.indexOf(card.id) + 1 : null;

    return (
      <div
        key={cardId}
        className={`dm-card ${className} ${selected ? "selected" : ""} ${!canOperate && canOpenViewer ? "viewer-only" : ""} ${card.tapped ? "tapped" : ""} ${card.reversed ? "reversed" : ""} ${isFaceDown ? "face-down" : ""}`}
        data-owner={ownerLabel}
        data-zone={card.zone}
        title={showFace ? card.name : visibleName}
        onClick={(event) => handleHtmlCardClick(event, card, canOperate, canOpenViewer)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();

          if (!canOperate) {
            setMenuState(null);

            if (canOpenViewer) {
              setViewerCard(card);
            }

            return;
          }

          openCardMenu(event, card);
        }}
        style={{
          backgroundImage: imageUrl && showFace ? `url(${imageUrl})` : undefined,
          ...extraStyle
        }}
      >
        {!imageUrl || !showFace ? <span>{visibleName}</span> : null}
        {selectedOrder !== null && <span className="dm-selection-order">{selectedOrder}</span>}
        {stackCards.length > 1 && <span className="dm-stack-count">重{stackCards.length}</span>}
      </div>
    );
  }

  function renderZoneArea(
    player: PlayerSide,
    zone: "mana" | "battle",
    ownerLabel: "me" | "opp",
    label: string
  ) {
    const board = roomState.players[player];
    const cardIds = zone === "mana" ? board.mana : board.battle;
    const className = zone === "mana" ? "mana-card" : "field";

    return (
      <section className={`zone-area ${zone}-area ${ownerLabel}`}>

        <div className="zone-cards">
          {cardIds.length > 0 ? (
            cardIds.map((cardId, index) => {
              const shouldOverlapMana = zone === "mana" && cardIds.length > 10;
              const manaCardWidth = 66;
              const manaMaxWidth = 720;
              const manaMinStep = 18;
              const manaStep =
                cardIds.length <= 1
                  ? manaCardWidth
                  : Math.max(
                      manaMinStep,
                      Math.min(
                        manaCardWidth,
                        (manaMaxWidth - manaCardWidth) / (cardIds.length - 1)
                      )
                    );

              return renderHtmlCard(
                cardId,
                className,
                ownerLabel,
                undefined,
                shouldOverlapMana
                  ? {
                      marginLeft: index === 0 ? 0 : manaStep - manaCardWidth,
                      zIndex: index + 1
                    }
                  : undefined
              );
            })
          ) : (
            <div className={`zone-empty ${zone === "battle" ? "battle-empty" : "mana-empty"}`}>
              {label}
            </div>
          )}
        </div>
      </section>
    );
  }

  function renderShieldArea(player: PlayerSide, ownerLabel: "me" | "opp", label: string) {
    const shieldIds = getTopShieldCardIds(player);

    return (
      <section className="shield-zone">

        <div className="dm-shields">
          {shieldIds.length > 0 ? (
            shieldIds.map((cardId, index) =>
              renderHtmlCard(cardId, "shield", ownerLabel, `シールド ${index + 1}`)
            )
          ) : (
            <div className="zone-empty shield-empty">シールド</div>
          )}
        </div>
      </section>
    );
  }

  function renderPile(player: PlayerSide, type: "deck" | "grave", ownerLabel: "me" | "opp") {
    const board = roomState.players[player];
    const count = type === "deck" ? board.deckOrder.length : board.grave.length;
    const canOperate = type === "deck" && myRole === player && !isInteractionDisabled;
    const deckVisibility = getDeckVisibility(roomState, player);
    const topCardId = board.deckOrder[0] ?? null;
    const topCard = topCardId ? roomState.cardInstances[topCardId] : null;
    const canSeeTopCard = canSeeDeckTopCard({
      deckOwner: player,
      myRole,
      viewerRole: spectatorViewerRole,
      revealAllHands,
      visibility: deckVisibility
    });
    const deckDisplayLabel =
      canSeeTopCard && topCard ? topCard.name : "山札";
    const deckTitle =
      canSeeTopCard && topCard
        ? `山札上：${topCard.name}`
        : `山札：${count}枚 / ${deckVisibilityLabel(deckVisibility)}`;

    if (type === "grave") {
      const graveTopCardId = board.grave[board.grave.length - 1] ?? null;
      const graveTopCard = graveTopCardId ? roomState.cardInstances[graveTopCardId] : null;
      const canOperateGrave = Boolean(graveTopCard) && myRole === player && !isInteractionDisabled;
      const canOpenGraveViewer =
        Boolean(graveTopCard) &&
        canOpenCardViewer(graveTopCard!, myRole, spectatorViewerRole, revealAllHands);
      const visibleGraveName = graveTopCard
        ? getVisibleCardName(graveTopCard, myRole, "墓地", spectatorViewerRole, revealAllHands)
        : "墓地";

      return (
        <div
          className="dm-card grave"
          data-owner={ownerLabel}
          data-zone="grave"
          title={graveTopCard ? `墓地：${visibleGraveName}` : "墓地"}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();

            if (board.grave.length === 0) return;

            setGraveModal({
              player,
              ownerLabel,
              cardIds: board.grave
            });
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();

            if (board.grave.length === 0) return;

            setGraveModal({
              player,
              ownerLabel,
              cardIds: board.grave
            });
          }}
        >
          <span>{count > 0 ? visibleGraveName : "墓地"}</span>
          <span className="badge">{count}</span>
        </div>
      );
    }

    return (
      <button
        type="button"
        className={`dm-card deck ${deckVisibility === "public" ? "public" : ""}`}
        data-owner={ownerLabel}
        data-zone="deck"
        title={deckTitle}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();

          if (!canOperate) return;

          openSingleDeckMenu(event, player);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();

          if (!canOperate) return;

          openMultiDeckMenu(event, player);
        }}
      >
        <span>{deckDisplayLabel}</span>
        <span className="badge">{count}</span>
      </button>
    );
  }

  function renderViewerSlot(card: CardInstance | null, label: string) {
    if (!card) return <div className="viewer-card" />;

    const canOpen = canOpenCardViewer(card, myRole, spectatorViewerRole, revealAllHands);
    const imageUrl = getCardViewerImageUrl(card);
    const visibleName = getVisibleCardName(card, myRole, label, spectatorViewerRole, revealAllHands);

    return (
      <div className={`viewer-card ${!imageUrl || !canOpen ? "no-image-view" : "image-view"}`}>
        {imageUrl && canOpen ? (
          <img
            src={imageUrl}
            alt={card.name}
            loading="lazy"
            className="viewer-card-image"
          />
        ) : (
          visibleName
        )}
      </div>
    );
  }

  const { upperPlayer, lowerPlayer } = useMemo(
    () => getDisplayPlayers(),
    [myRole, spectatorViewerRole]
  );
  const upperBoard = roomState.players[upperPlayer];
  const lowerBoard = roomState.players[lowerPlayer];
  const viewerMainCard = viewerCard ?? (selectedCompareCards.length > 0 ? selectedCompareCards[0] : null);
  const viewerSubCard = selectedCompareCards.length > 1 ? selectedCompareCards[1] : null;

  return (
    <section className="dm-stage">
      <button
        type="button"
        className="operation-guide-button"
        onClick={() => setShowOperationGuide((value) => !value)}
      >
        操作ガイド
      </button>

      {showOperationGuide && (
        <section className="operation-guide-popup">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <strong>操作ガイド</strong>
            <button type="button" onClick={() => setShowOperationGuide(false)}>
              閉じる
            </button>
          </div>
          <div>
            クリック：選択 / もう一度クリック：ビュアー表示<br />
            Ctrl・Shift・Cmd＋クリック：複数選択<br />
            右クリック/長押し：WASDメニュー<br />
            Esc：確認画面を閉じる / Ctrl+Z：直前操作の取り消し確認<br />
            非公開領域のカード名は相手・観戦者には表示されません。<br />重なっているカードはビュアー下部で一覧確認できます。<br />相手カードは操作不可で、表示可能なカードだけビュアー表示できます。
          </div>
        </section>
      )}

      {myRole === "spectator" && (
        <section className="spectator-panel">
          <strong>観戦視点：{spectatorViewLabel}</strong>

          <div className="spectator-buttons">
            {[
              ["player1", "player1視点"],
              ["player2", "player2視点"],
              ["player1_open_hands", "player1視点＋両手札公開"],
              ["player2_open_hands", "player2視点＋両手札公開"]
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={spectatorViewMode === mode ? "active" : ""}
                onClick={() => changeSpectatorViewMode(mode as SpectatorViewMode)}
              >
                {label}
              </button>
            ))}
          </div>

          <span>
            残り自由切替：{spectatorFreeSwitchesLeft}回
            {spectatorFreeSwitchesLeft === 0 ? " / 以降20秒クールタイム" : ""}
          </span>

          {spectatorViewMessage && <span>{spectatorViewMessage}</span>}
        </section>
      )}
      <style>{`
        .board-disabled-overlay{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:1303;border:1px solid #facc15;border-radius:999px;background:rgba(39,32,7,.94);color:#fde68a;font-size:11px;font-weight:700;padding:6px 12px;pointer-events:none}.spectator-panel{position:fixed;left:232px;top:48px;z-index:1302;width:min(520px,calc(100vw - 260px));border:1px solid #334155;border-radius:12px;background:rgba(15,23,42,.94);box-shadow:0 18px 48px rgba(0,0,0,.45);padding:10px;color:#e2e8f0;font-size:11px;display:grid;gap:7px}.spectator-buttons{display:flex;gap:6px;flex-wrap:wrap}.spectator-buttons button{border:1px solid #475569;border-radius:999px;background:#202020;color:#fff;padding:5px 8px;font-size:11px;cursor:pointer}.spectator-buttons button.active{border-color:#4ea3ff;background:#12365c}
        .dm-stage{--blue:#4ea3ff;--green:#00ff66;position:fixed;left:220px;right:0;top:0;bottom:0;width:auto;height:100dvh;max-height:100dvh;overflow:hidden;background:#171717;color:#f2f2f2;user-select:none;z-index:1}
        .dm-container{width:100%;height:100%;max-height:100%;display:grid;grid-template-columns:minmax(560px,52%) minmax(360px,48%);overflow:hidden;border-radius:0;background:#171717}
        .dm-board{width:100%;min-width:0;min-width:0;height:100%;padding:8px 2px 6px 4px;display:grid;grid-template-rows:102px 114px 132px 2px 132px 114px 102px;gap:5px;background:linear-gradient(180deg,#1c1c1c,#151515);position:relative;overflow:hidden}
        .dm-sidebar{width:100%;min-width:0;min-width:0;height:100%;padding:4px 0 6px 4px;background:#222;border-left:2px solid #333;display:grid;grid-template-rows:28px minmax(220px, 1fr) 190px;gap:6px;overflow:hidden;min-width:0}
        .dm-row,.dm-mana,.dm-shield-line,.dm-shields,.dm-piles{display:flex;align-items:center;justify-content:center}
        .dm-row{gap:11px;overflow:hidden}.dm-mana{gap:0;overflow:hidden;justify-content:center;padding:0 4px}.dm-shield-line{position:relative;justify-content:center;gap:8px;overflow:hidden}.dm-shields{display:flex;align-items:center;justify-content:center;gap:7px;min-width:340px;min-height:92px}.dm-piles{gap:7px}.dm-sep{height:2px;background:#444;align-self:center}
        .zone-area,.shield-zone{position:relative;width:100%;height:100%;display:grid;place-items:center;overflow:hidden;border:2px dashed rgba(78,163,255,.34);border-radius:12px;background:rgba(78,163,255,.055);box-shadow:inset 0 0 0 1px rgba(255,255,255,.04)}
        .zone-area.opp{transform:rotate(180deg)}
        .zone-cards{display:flex;align-items:center;justify-content:center;gap:11px;overflow:hidden;width:100%;height:100%;padding:18px 8px 6px}
        .mana-area .zone-cards{gap:0}
        .zone-title{position:absolute;left:8px;top:6px;z-index:4;color:#dbeafe;font-size:11px;font-weight:700;background:rgba(15,23,42,.82);border:1px solid rgba(96,165,250,.45);border-radius:999px;padding:2px 8px;pointer-events:none}
        .zone-empty{border:1px dashed #64748b;border-radius:8px;color:#94a3b8;display:grid;place-items:center;font-size:12px;background:rgba(15,23,42,.42)}
        .battle-empty{width:92px;height:129px}
        .mana-empty{width:68px;height:96px}
        .shield-empty{width:66px;height:92px}
        .dm-card{position:relative;flex:0 0 auto;border-radius:8px;border:1px solid #5c5c5c;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;cursor:pointer;transition:filter .15s,box-shadow .15s,transform .15s;background-size:cover;background-position:center;color:#fff;padding:4px;overflow:hidden;word-break:break-word}
        .dm-card.viewer-only{cursor:pointer;border-color:#64748b}.dm-card.viewer-only:hover{box-shadow:0 0 0 2px rgba(148,163,184,.35)}.dm-card:hover{filter:brightness(1.18)}.dm-card.selected{box-shadow:0 0 0 3px var(--blue),0 0 14px rgba(78,163,255,.65);z-index:10}
        .field{width:90px;height:126px;background:#292929;border:2px dashed #4a4a4a}.mana-card{width:66px;height:92px;background:#1f5533}.shield{width:64px;height:90px;background:#555;color:transparent}.deck{width:48px;height:67px;background:#444;color:#ddd}.deck.public{border-color:#22c55e;background:#1f5533}.grave{width:64px;height:90px;background:#303030;border-style:dashed}
        .shield.face-down::after,.dm-card.face-down::after{content:"裏";color:#ddd;background:#222;border-radius:999px;padding:2px 10px}
        .badge,.dm-selection-order,.dm-stack-count{position:absolute;background:#111;border:1px solid #777;border-radius:999px;padding:2px 6px;font-size:10px;color:#ddd}.badge{right:4px;bottom:4px}.dm-selection-order{right:4px;top:4px;border-color:var(--blue);color:#fff;font-weight:700}.dm-stack-count{left:4px;bottom:4px;background:#000b;color:#fff}
        .opponent-hand{height:48px;background:rgba(255,255,255,.035);border-radius:7px;display:flex;align-items:center;justify-content:flex-end;gap:2px;padding:3px 5px;overflow:hidden}.op-card{width:28px;height:40px;border-radius:3px;background:#555;border:1px solid #666;flex:0 0 auto}.operation-guide-button{position:fixed;left:calc(220px + 42% + 12px);top:8px;z-index:1300;border:1px solid #555;border-radius:999px;background:#202020;color:#fff;padding:5px 10px;font-size:11px;line-height:1.1;cursor:pointer}.operation-guide-popup{position:fixed;left:calc(220px + 42% + 12px);top:38px;z-index:1301;width:360px;border:1px solid #334155;border-radius:10px;background:rgba(15,23,42,.97);color:#e2e8f0;font-size:11px;line-height:1.5;padding:10px;box-shadow:0 18px 48px rgba(0,0,0,.45);display:grid;gap:8px}.operation-guide-popup button{border:1px solid #555;border-radius:8px;background:#202020;color:#fff;padding:4px 8px;cursor:pointer}.modal-backdrop{position:fixed;inset:0;z-index:9200;background:rgba(0,0,0,.72);display:grid;place-items:center;padding:20px}.deck-modal{width:min(760px,100%);max-height:86vh;overflow:auto;border:1px solid #64748b;border-radius:14px;background:#111827;color:#f8fafc;padding:14px;display:grid;gap:12px;box-shadow:0 24px 64px rgba(0,0,0,.55)}.deck-modal.wide{width:min(980px,100%)}.modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.modal-head p{margin:4px 0 0;color:#94a3b8;font-size:12px}.modal-head button,.modal-actions button,.modal-choice button,.order-row button{border:1px solid #475569;border-radius:8px;background:#202020;color:#fff;padding:6px 9px;cursor:pointer}.modal-head button:hover,.modal-actions button:hover,.modal-choice button:hover,.order-row button:hover{background:#303030}.modal-head button:disabled,.modal-actions button:disabled,.modal-choice button:disabled,.order-row button:disabled{opacity:.45;cursor:not-allowed}.modal-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}.modal-card{border:1px solid #475569;border-radius:10px;background:#050505;color:#fff;min-height:120px;display:grid;gap:6px;place-items:center;text-align:center;padding:10px}.modal-card.selectable{cursor:pointer;user-select:none}.modal-card.selectable.selected{border:2px solid #4ea3ff;box-shadow:0 0 12px rgba(78,163,255,.65)}.modal-card.large{max-width:230px;aspect-ratio:63/88;justify-self:center}.modal-card-face{cursor:pointer;display:grid;gap:6px;place-items:center;text-align:center}.modal-card-face img{width:100%;max-height:220px;object-fit:contain;border-radius:8px;background:#111827}.modal-card-face>strong{font-size:13px;line-height:1.35}.modal-card-face>span{color:#94a3b8;font-size:12px}.modal-card-proxy{min-height:150px;width:100%;border:1px dashed #475569;border-radius:8px;padding:10px;display:grid;gap:6px;place-items:center;background:#0f172a}.modal-card-proxy small{color:#facc15}.modal-choice{border:1px solid #334155;border-radius:10px;background:#0f172a;padding:10px;display:grid;gap:8px}.modal-choice>div{display:flex;flex-wrap:wrap;gap:7px}.modal-choice button.active{border-color:#4ea3ff;background:#12365c}.order-row{display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center}.modal-actions{display:flex;gap:8px;flex-wrap:wrap}.viewer-guide{display:grid;gap:3px;margin-top:-4px;margin-bottom:0;align-self:start;justify-self:start;z-index:5}.viewer-guide button{justify-self:start;border:1px solid #555;border-radius:999px;background:#202020;color:#fff;padding:3px 8px;font-size:10px;line-height:1.1;cursor:pointer}.viewer-guide-panel{border:1px solid #334155;border-radius:8px;background:rgba(15,23,42,.94);color:#e2e8f0;font-size:10px;line-height:1.35;padding:4px 7px}
        .viewer{position:relative;min-height:0;height:100%;background:rgba(255,255,255,.04);border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:stretch;gap:3px;padding:3px 7px 2px;transform:none;overflow:hidden}.viewer-title{font-size:11px;color:#aaa;line-height:1}.viewer-slots{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:stretch;justify-content:stretch;width:100%;height:100%;min-height:0}.stack-viewer{position:absolute;left:10px;right:10px;bottom:6px;z-index:6;border:1px solid #475569;border-radius:10px;background:rgba(15,23,42,.88);padding:6px;color:#e2e8f0;font-size:10px;max-height:110px;overflow:auto}.stack-viewer strong{display:block;margin-bottom:3px}.stack-viewer ol{margin:0;padding-left:18px;display:grid;gap:2px}.stack-viewer button{border:none;background:transparent;color:#bfdbfe;padding:0;text-align:left;cursor:pointer;font-size:10px}.stack-viewer button:hover{text-decoration:underline}.viewer-card{width:100%;height:100%;min-width:0;max-height:none;border:2px dashed #555;border-radius:16px;background:#2c2c2c;color:#bbb;display:flex;align-items:center;justify-content:center;font-size:16px;text-align:center;background-size:contain;background-repeat:no-repeat;background-position:center;padding:8px;box-sizing:border-box;overflow:hidden}.viewer-card-image{width:100%;height:100%;object-fit:contain;display:block;border-radius:12px;background:#111827}.hint{font-size:10px;color:#aaa;text-align:center;line-height:1.25;flex:0 0 auto;margin-top:-22px;pointer-events:none}
        .dm-log{height:240px;background:#111;border:1px solid #333;border-radius:8px;padding:6px;overflow:auto;color:var(--green);font-size:10px;font-family:ui-monospace,Consolas,monospace;line-height:1.35}
        .modal-card.selected{border:2px solid #4ea3ff;box-shadow:0 0 12px rgba(78,163,255,.65)}.my-hand{position:relative;height:190px;margin-top:8px;width:100%;box-sizing:border-box;background:rgba(255,255,255,.035);border:1px dashed rgba(255,255,255,.13);border-radius:10px;display:flex;align-items:center;justify-content:flex-start;overflow-x:auto;overflow-y:hidden;padding:24px 8px 6px;gap:7px;scroll-behavior:smooth}.hand-card{width:108px;height:152px;background:#202020;color:#f8fafc;border-radius:10px;font-weight:700;font-size:11px;background-size:contain;background-repeat:no-repeat;background-position:center}.hand-card:hover{transform:translateY(-6px)}.hand-title{position:absolute;left:10px;top:6px;z-index:4;color:#aaa;font-size:11px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:2px 8px}.hand-empty{width:132px;height:186px;border:1px dashed #555;border-radius:10px;display:grid;place-items:center;color:#777;background:rgba(0,0,0,.18)}
        .center-character{position:absolute;width:82px;height:82px;left:95%;border-radius:18px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;color:#aaa;font-size:12px;pointer-events:none;z-index:6}.my-character{top:89.5%;transform:translate(-50%,-50%)}.opp-character{top:10.5%;transform:translate(-50%,-50%) rotate(180deg)}
        .opp-shield-line .opp-piles{position:absolute;left:6px}.my-shield-line .my-piles{position:absolute;right:6px}.opp-shield-line .dm-shields{margin-left:132px;min-width:390px;justify-content:flex-start}.my-shield-line .dm-shields{margin-right:132px;min-width:390px;justify-content:flex-end}
        .dm-card[data-owner="opp"][data-zone="battle"],.dm-card[data-owner="opp"][data-zone="shield"],.dm-card[data-owner="opp"][data-zone="grave"],.dm-card[data-owner="opp"][data-zone="deck"]{transform:rotate(180deg)}
        .dm-card[data-owner="me"][data-zone="mana"]{transform:rotate(180deg)}.dm-card[data-owner="opp"][data-zone="mana"]{transform:rotate(0deg)}
        .dm-card.tapped[data-owner="me"][data-zone="mana"]{transform:rotate(270deg)}.dm-card.tapped[data-owner="opp"][data-zone="mana"]{transform:rotate(90deg)}
        .dm-card.tapped[data-owner="opp"][data-zone="battle"],.dm-card.tapped[data-owner="opp"][data-zone="shield"],.dm-card.tapped[data-owner="opp"][data-zone="grave"],.dm-card.tapped[data-owner="opp"][data-zone="deck"]{transform:rotate(270deg)}
        .dm-card.reversed[data-owner="opp"][data-zone="battle"],.dm-card.reversed[data-owner="opp"][data-zone="shield"],.dm-card.reversed[data-owner="opp"][data-zone="grave"],.dm-card.reversed[data-owner="opp"][data-zone="deck"]{transform:rotate(0deg)}.dm-card.reversed[data-owner="me"][data-zone="mana"]{transform:rotate(0deg)}

        /* タップ/アンタップ表示の明示ルール
           自分側の通常カードはアンタップ=正位置、タップ=時計回り90°。 */
        .dm-card[data-owner="me"][data-zone="battle"],
        .dm-card[data-owner="me"][data-zone="shield"],
        .dm-card[data-owner="me"][data-zone="grave"],
        .dm-card[data-owner="me"][data-zone="deck"]{transform:rotate(0deg)!important}
        .dm-card.tapped[data-owner="me"][data-zone="battle"],
        .dm-card.tapped[data-owner="me"][data-zone="shield"],
        .dm-card.tapped[data-owner="me"][data-zone="grave"],
        .dm-card.tapped[data-owner="me"][data-zone="deck"]{transform:rotate(90deg)!important}
        .dm-card.reversed[data-owner="me"][data-zone="battle"],
        .dm-card.reversed[data-owner="me"][data-zone="shield"],
        .dm-card.reversed[data-owner="me"][data-zone="grave"],
        .dm-card.reversed[data-owner="me"][data-zone="deck"]{transform:rotate(180deg)!important}

        .modal-card.selectable{cursor:pointer;user-select:none;position:relative}
        .modal-card.selectable.selected,.modal-card.selected{border:2px solid #4ea3ff!important;box-shadow:0 0 12px rgba(78,163,255,.75)!important}
        .modal-selection-order{position:absolute;right:6px;top:6px;z-index:5;border:1px solid #4ea3ff;border-radius:999px;background:#0f172a;color:#fff;font-size:12px;font-weight:700;padding:2px 8px}
        .modal-select-button{border:1px solid #475569;border-radius:999px;background:#202020;color:#fff;padding:4px 9px;font-size:12px;cursor:pointer}
        .modal-select-button:hover{background:#303030}

        .mana-card,.hand-card{position:relative}
        .mana-card:hover,.hand-card:hover{z-index:999!important}
        .mana-card:not(:first-child),.hand-card:not(:first-child){transition:margin-left .18s ease,transform .15s ease,box-shadow .15s ease}


        .modal-card-action-label{font-size:12px;color:#cbd5e1}
        .modal-card-action-buttons{display:flex;flex-wrap:wrap;gap:5px;justify-content:center}
        .modal-card-action-buttons button{border:1px solid #475569;border-radius:999px;background:#202020;color:#fff;padding:4px 7px;font-size:11px;cursor:pointer}
        .modal-card-action-buttons button.active{border-color:#4ea3ff;background:#12365c}
        .modal-card-action-buttons button:hover{background:#303030}

      `}</style>

      {isInteractionDisabled && (
        <div className="board-disabled-overlay">
          操作できない状態です。処理中・別端末・観戦・終了済みの可能性があります。
        </div>
      )}

      <div className="dm-container">
        <main className="dm-board">
          <div className="dm-mana">{renderZoneArea(upperPlayer, "mana", "opp", "相手マナ")}</div>
          <div className="dm-shield-line opp-shield-line">
            <div className="dm-piles opp-piles">
              {renderPile(upperPlayer, "grave", "opp")}
              {renderPile(upperPlayer, "deck", "opp")}
            </div>
            {renderShieldArea(upperPlayer, "opp", "相手シールド")}
          </div>
          <div className="dm-row">{renderZoneArea(upperPlayer, "battle", "opp", "相手バトルゾーン")}</div>
          <div className="dm-sep" />
          <div className="dm-row">{renderZoneArea(lowerPlayer, "battle", "me", "自分バトルゾーン")}</div>
          <div className="dm-shield-line my-shield-line">
            {renderShieldArea(lowerPlayer, "me", "自分シールド")}
            <div className="dm-piles my-piles">
              {renderPile(lowerPlayer, "deck", "me")}
              {renderPile(lowerPlayer, "grave", "me")}
            </div>
          </div>
          <div className="dm-mana">{renderZoneArea(lowerPlayer, "mana", "me", "自分マナ")}</div>
        </main>

        <aside className="dm-sidebar">
          <div className="opponent-hand" title={`相手手札：${upperBoard.hand.length}枚`}>
            {upperBoard.hand.length > 0 ? (
              upperBoard.hand.map((cardId) => <div key={cardId} className="op-card" />)
            ) : (
              <span style={{ color: "#777", fontSize: 11 }}>相手手札：0枚</span>
            )}
          </div>

          <section className="viewer">
            <div className="viewer-slots">
              {renderViewerSlot(viewerMainCard, "メイン枠")}
              {renderViewerSlot(viewerSubCard, "サブ枠")}
            </div>

            {viewerStackCards.length > 1 && (
              <section className="stack-viewer">
                <strong>重なっているカード：{viewerStackCards.length}枚</strong>
                <ol>
                  {[...viewerStackCards].reverse().map((stackCard, index) => (
                    <li key={stackCard.id}>
                      <button
                        type="button"
                        onClick={() => setViewerCard(stackCard)}
                      >
                        {index === 0 ? "一番上：" : `${index + 1}枚目：`}
                        {getVisibleCardName(
                          stackCard,
                          myRole,
                          undefined,
                          spectatorViewerRole,
                          revealAllHands
                        )}
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            <div className="hint">
              左クリック: 選択 / Ctrl+クリック: 複数選択<br />
              右クリック: 十字メニュー / Esc: 探索ウィンドウ表示切替
            </div>
          </section>

          <div className="my-hand">
            <span className="hand-title">自分手札：{lowerBoard.hand.length}枚</span>
            {lowerBoard.hand.length > 0 ? (
              lowerBoard.hand.map((cardId, index) => {
                const shouldOverlapHand = lowerBoard.hand.length > 5;
                const handCardWidth = 108;
                const handGap = 7;
                const handMaxWidth = 560;
                const handMinStep = 34;
                const handStep =
                  lowerBoard.hand.length <= 1
                    ? handCardWidth + handGap
                    : Math.max(
                        handMinStep,
                        Math.min(
                          handCardWidth + handGap,
                          (handMaxWidth - handCardWidth) /
                            (lowerBoard.hand.length - 1)
                        )
                      );

                return renderHtmlCard(
                  cardId,
                  "hand-card",
                  "me",
                  undefined,
                  shouldOverlapHand
                    ? {
                        marginLeft: index === 0 ? 0 : handStep - handCardWidth - handGap,
                        zIndex: index + 1
                      }
                    : undefined
                );
              })
            ) : (
              <div className="hand-empty">手札</div>
            )}
          </div>
        </aside>
      </div>


      {deckPreview && (
  <section className="modal-backdrop" onClick={closeDeckPreview}>
    <div className="deck-modal" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head">
        <div>
          <strong>山札確認：{deckPreview.player}</strong>
          <p>
            {deckPreview.direction === "top" ? "上から" : "下から"}
            {deckPreview.count}枚を確認中です。
            {deckPreviewSelectedCardIds.length > 0
              ? ` / ${deckPreviewSelectedCardIds.length}枚選択中`
              : ""}
          </p>
        </div>
        <button type="button" onClick={closeDeckPreview}>閉じる</button>
      </div>

      {deckPreview.cardIds.length === 0 ? (
        <p>山札がありません。</p>
      ) : (
        <div className="modal-card-grid">
          {deckPreview.cardIds.map((cardId, index) => {
            const card = roomState.cardInstances[cardId];
            const selected = deckPreviewSelectedCardIds.includes(cardId);
            const selectedOrder = selected
              ? deckPreviewSelectedCardIds.indexOf(cardId) + 1
              : null;

            function selectDeckPreviewCard(append: boolean) {
              if (!card) return;

              if (append) {
                setDeckPreviewSelectedCardIds((previous) => {
                  const next = previous.includes(cardId)
                    ? previous.filter((id) => id !== cardId)
                    : [...previous, cardId];

                  setSelectedCard(card);
                  setSelectedCardIds(next);

                  return next;
                });
                return;
              }

              setDeckPreviewSelectedCardIds([cardId]);
              setSelectedCard(card);
              setSelectedCardIds([cardId]);
            }

            return (
              <div
                key={cardId}
                className={`modal-card selectable ${selected ? "selected" : ""}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();

                  
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();

                  if (!card) return;

                  const activeIds =
                    deckPreviewSelectedCardIds.length > 1 &&
                    deckPreviewSelectedCardIds.includes(cardId)
                      ? deckPreviewSelectedCardIds
                      : [cardId];

                  setDeckPreviewSelectedCardIds(activeIds);
                  setSelectedCard(card);
                  setSelectedCardIds(activeIds);

                  openCardMenu(event, card);
                }}
              >
                {selectedOrder !== null && (
                  <span className="modal-selection-order">
                    {selectedOrder}
                  </span>
                )}

                <ModalCardFace
                  card={card}
                  prefix={`${index + 1}枚目`}
                  selected={selected}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  </section>
)}

      {deckSelectModal && (
        <section className="modal-backdrop" onClick={closeDeckSelectModal}>
          <div className="deck-modal wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <strong>
                  {deckSelectModal.publicCheck ? "山札公開確認" : "山札確認"}：
                  {deckSelectModal.player}
                </strong>
                <p>
                  各カードの移動先を選んでください。「残す」にしたカードだけが山札へ戻ります。
                </p>
              </div>
              <button type="button" onClick={closeDeckSelectModal}>閉じる</button>
            </div>

            {deckSelectModal.cardIds.length === 0 ? (
              <p>山札がありません。</p>
            ) : (
              <>
                <div className="modal-card-grid">
                  {deckSelectModal.cardIds.map((cardId, index) => {
                    const card = roomState.cardInstances[cardId];
                    const action = deckSelectModal.cardActions[cardId] ?? "keep";

                    function setDeckSelectCardAction(nextAction: DeckSelectCardAction) {
                      setDeckSelectModal((currentModal) => {
                        if (!currentModal) return currentModal;

                        const nextCardActions = {
                          ...currentModal.cardActions,
                          [cardId]: nextAction
                        };

                        const nextRemainingIds = currentModal.cardIds.filter(
                          (id) => nextCardActions[id] === "keep"
                        );

                        return {
                          ...currentModal,
                          cardActions: nextCardActions,
                          orderedRemainingIds: nextRemainingIds
                        };
                      });
                    }

                    return (
                      <div
                        key={cardId}
                        className={`modal-card selectable ${action !== "keep" ? "selected" : ""}`}
                      >
                        <ModalCardFace
                          card={card}
                          prefix={`${index + 1}枚目`}
                          selected={action !== "keep"}
                        />

                        <div className="modal-card-action-label">
                          現在：{
                            action === "keep"
                              ? "山札に残す"
                              : action === "hand"
                                ? "手札"
                                : action === "battle"
                                  ? "バトル"
                                  : action === "mana"
                                    ? "マナ"
                                    : action === "grave"
                                      ? "墓地"
                                      : action === "shield"
                                        ? "シールド"
                                        : action
                          }
                        </div>

                        <div className="modal-card-action-buttons">
                          {[
                            ["keep", "残す"],
                            ["hand", "手札"],
                            ["mana", "マナ"],
                            ["grave", "墓地"],
                            ["battle", "バトル"],
                            ["shield", "盾"]
                          ].map(([nextAction, label]) => (
                            <button
                              key={nextAction}
                              type="button"
                              className={action === nextAction ? "active" : ""}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setDeckSelectCardAction(nextAction as DeckSelectCardAction);
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <section className="modal-choice">
                  <strong>「残す」にしたカードの処理</strong>
                  <div>
                    {[
                      ["keep", "そのまま戻す"],
                      ["bottom", "山札下へ送る"],
                      ["shuffle", "山札をシャッフル"],
                      ["order_top", "順番指定して山札上へ"],
                      ["order_bottom", "順番指定して山札下へ"]
                    ].map(([action, label]) => (
                      <button
                        key={action}
                        type="button"
                        className={deckSelectModal.remainingAction === action ? "active" : ""}
                        onClick={() =>
                          setDeckSelectModal({
                            ...deckSelectModal,
                            remainingAction: action as
                              | "keep"
                              | "bottom"
                              | "shuffle"
                              | "order_top"
                              | "order_bottom",
                            orderedRemainingIds:
                              action === "order_top" || action === "order_bottom"
                                ? getDeckSelectOrderedRemainingIds(deckSelectModal)
                                : deckSelectModal.orderedRemainingIds
                          })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </section>

                {(deckSelectModal.remainingAction === "order_top" ||
                  deckSelectModal.remainingAction === "order_bottom") && (
                  <section className="modal-choice ordered">
                    <strong>山札へ戻すカードの順番</strong>
                    <p>「残す」にしたカードだけを、上から順に並べてください。</p>
                    {getDeckSelectOrderedRemainingIds(deckSelectModal).length === 0 ? (
                      <p className="muted">山札へ戻すカードはありません。</p>
                    ) : (
                      getDeckSelectOrderedRemainingIds(deckSelectModal).map((cardId, index, orderedIds) => {
                        const card = roomState.cardInstances[cardId];

                        return (
                          <div key={cardId} className="order-row">
                            <span>{index + 1}. {card?.name ?? "不明なカード"}</span>
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => moveDeckSelectOrderItem(cardId, "up")}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={index === orderedIds.length - 1}
                              onClick={() => moveDeckSelectOrderItem(cardId, "down")}
                            >
                              ↓
                            </button>
                          </div>
                        );
                      })
                    )}
                  </section>
                )}

                <div className="modal-actions">
                  <button
                    type="button"
                    disabled={!deckSelectModal.remainingAction}
                    onClick={() => {
                      if (!deckSelectModal.remainingAction) return;

                      onInspectDeckSelectModal({
                        player: deckSelectModal.player,
                        count: deckSelectModal.count,
                        publicCheck: deckSelectModal.publicCheck,
                        cardActions: deckSelectModal.cardActions,
                        remainingAction: deckSelectModal.remainingAction,
                        orderedRemainingIds:
                          deckSelectModal.remainingAction === "order_top" ||
                          deckSelectModal.remainingAction === "order_bottom"
                            ? getDeckSelectOrderedRemainingIds(deckSelectModal)
                            : undefined
                      });

                      closeDeckSelectModal();
                    }}
                  >
                    指定した通りに移動する
                  </button>
                  <button type="button" onClick={closeDeckSelectModal}>キャンセル</button>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {shieldBreakModal && (
        <section className="modal-backdrop" onClick={() => setShieldBreakModal(null)}>
          <div className="deck-modal shield-break" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <strong>シールドブレイク</strong>
                <p>自分だけが確認しています。処理を選んでください。</p>
              </div>
              <button type="button" onClick={() => setShieldBreakModal(null)}>閉じる</button>
            </div>

            <div className="modal-card large">
              <ModalCardFace card={shieldBreakModal.card} />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  onBreakShield(shieldBreakModal.card.id, "return");
                  setShieldBreakModal(null);
                }}
              >
                シールドに戻す
              </button>
              <button
                type="button"
                onClick={() => {
                  onBreakShield(shieldBreakModal.card.id, "hand");
                  setShieldBreakModal(null);
                }}
              >
                手札に加える
              </button>
              <button
                type="button"
                onClick={() => {
                  onBreakShield(shieldBreakModal.card.id, "battle");
                  setShieldBreakModal(null);
                }}
              >
                バトルゾーンに出す
              </button>
            </div>
          </div>
        </section>
      )}


      {graveModal && (
        <section className="modal-backdrop" onClick={() => setGraveModal(null)}>
          <div className="deck-modal wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <strong>墓地一覧：{graveModal.player}</strong>
                <p>
                  Shift+クリックで複数選択できます。カードを右クリックするとWASDメニューを開きます。
                </p>
              </div>
              <button type="button" onClick={() => setGraveModal(null)}>
                閉じる
              </button>
            </div>

            <div className="modal-card-grid">
              {graveModal.cardIds.length === 0 ? (
                <p>墓地にカードはありません。</p>
              ) : (
                graveModal.cardIds.map((cardId, index) => {
                  const card = roomState.cardInstances[cardId];
                  if (!card) return null;

                  return (
                    <div
                      key={`${cardId}-${index}`}
                      className={`modal-card ${selectedCardIds.includes(cardId) ? "selected" : ""}`}
                    >
                      <ModalCardFace
                        card={card}
                        prefix={`${index + 1}枚目`}
                        selected={selectedCardIds.includes(cardId)}
                        onClick={(event) => {
                          toggleSelectedCardFromModal(
                            card,
                            event.shiftKey || event.ctrlKey || event.metaKey
                          );
                        }}
                        onContextMenu={(event) => {
                          openModalCardContextMenu(event, card);
                        }}
                      />
                    </div>
                  );
                })
              )}
            </div>

            {selectedCardIds.length >= 2 && (
              <p style={{ margin: 0, color: "#bfdbfe", fontSize: 12 }}>
                {selectedCardIds.length}枚選択中です。選択したカードの右クリックメニューからまとめて移動できます。
              </p>
            )}
          </div>
        </section>
      )}


      {menuState && (
        <RightClickMenu
          root={menuState.root}
          x={menuState.x}
          y={menuState.y}
          onClose={() => setMenuState(null)}
          onAction={handleMenuAction}
        />
      )}
    </section>
  );
}