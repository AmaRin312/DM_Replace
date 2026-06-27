"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getOrCreateProfile } from "@/lib/auth/getOrCreateProfile";
import { createInitialRoomState } from "@/lib/room-state/createInitialRoomState";
import { SimpleBoard } from "@/components/board/SimpleBoard";
import type { PlayerSide, RoomState, Zone } from "@/types/roomState";

type Room = {
  id: string;
  room_code: string;
  owner_id: string;
  player1_id: string;
  player2_id: string | null;
  status: "waiting" | "playing" | "finished";
  started_at: string | null;
  created_at: string;
};

type RoomMember = {
  id: string;
  user_id: string;
  role: "player1" | "player2" | "spectator";
  selected_deck_id: string | null;
  joined_at: string;
  last_seen_at: string | null;
  active_client_id: string | null;
  profiles: {
    nickname: string | null;
    role: string;
  } | null;
};

type SavedDeck = {
  id: string;
  name: string;
};

type DeckCardRow = {
  slot_index: number;
  card_id: string | null;
  card_name: string;
  image_url?: string | null;
  imageUrl?: string | null;
  civilization?: string | null;
  cost?: number | null;
  type?: string | null;
  race?: string | null;
  power?: string | number | null;
  text?: string | null;
};

type CardMasterRow = {
  id: string;
  name: string;
  image_url: string | null;
  civilization: string | null;
  cost: number | null;
  type: string | null;
  race: string | null;
  power: string | null;
  text: string | null;
  is_official: boolean;
};

type Profile = {
  id: string;
  nickname: string | null;
};

type UndoSnapshot = {
  state: RoomState;
  eventType: string;
  message: string;
};

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

type RoomStateRow = {
  state_json: RoomState | null;
  updated_at: string | null;
  operation_count: number | null;
};

function toTimeValue(value: string | null | undefined) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}


function getDeckVisibility(
  state: RoomState | null,
  player: PlayerSide
): DeckVisibility {
  const status = (state as ExtendedRoomState | null)?.deckVisibility?.[player];
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

function zoneLabel(zone: Zone) {
  switch (zone) {
    case "hand":
      return "手札";
    case "battle":
      return "バトルゾーン";
    case "mana":
      return "マナ";
    case "grave":
      return "墓地";
    case "deck":
      return "山札";
    case "shield":
      return "シールド";
    default:
      return zone;
  }
}

function removeCardFromShieldStacks(shields: string[][], cardId: string) {
  return shields
    .map((stack) => stack.filter((id) => id !== cardId))
    .filter((stack) => stack.length > 0);
}

function removeCardsFromShieldStacks(shields: string[][], cardIds: string[]) {
  const removeSet = new Set(cardIds);

  return shields
    .map((stack) => stack.filter((id) => !removeSet.has(id)))
    .filter((stack) => stack.length > 0);
}

function shuffleArray<T>(items: T[]) {
  const copied = [...items];

  for (let i = copied.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copied[i], copied[j]] = [copied[j], copied[i]];
  }

  return copied;
}

function shouldHideCardName(zone: Zone) {
  return zone === "hand" || zone === "shield" || zone === "deck";
}

function actorDisplayName(profile: { nickname?: string | null } | null | undefined) {
  return profile?.nickname ?? "プレイヤー";
}

function safeCardNameForLog(card: { name: string; zone: Zone } | null | undefined) {
  if (!card) return "カード";
  return shouldHideCardName(card.zone) ? "カード" : `「${card.name}」`;
}

function safeCardPayloadName(card: { name: string; zone: Zone } | null | undefined) {
  if (!card) return null;
  return shouldHideCardName(card.zone) ? null : card.name;
}

function publicMoveMessage(params: {
  actorName: string;
  count?: number;
  fromZone?: Zone;
  toZone: Zone;
  cardLabel?: string;
}) {
  const countText = params.count && params.count > 1 ? `${params.count}枚` : "";
  const cardText = params.cardLabel ?? "カード";
  const fromText = params.fromZone ? `${zoneLabel(params.fromZone)}から` : "";

  return `${params.actorName}が${cardText}${countText}を${fromText}${zoneLabel(params.toZone)}へ移動しました。`;
}

function compactOperationMessage(message: string) {
  return message.replace(/\s+/g, " ").trim().slice(0, 140);
}

function compactOperationPayload(payload?: Record<string, unknown>) {
  if (!payload) return {};

  const allowedKeys = [
    "cardId",
    "cardIds",
    "fromZone",
    "toZone",
    "count",
    "player",
    "choice",
    "eventType"
  ];

  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => allowedKeys.includes(key))
  );
}

function undoableActionLabel(eventType: string) {
  switch (eventType) {
    case "move_card":
      return "カード移動";
    case "move_multiple_cards":
      return "複数カード移動";
    case "move_stack_cards":
      return "重なっているカードの移動";
    case "card_state":
      return "カード状態変更";
    case "move_mana_face":
      return "マナへの表裏指定移動";
    default:
      return "直前操作";
  }
}

function notUndoableReason(eventType: string) {
  switch (eventType) {
    case "draw":
      return "ドローは山札順に影響するため、取り消し対象外です。";
    case "shuffle_deck":
    case "return_to_deck_and_shuffle":
      return "シャッフルを含む操作は山札順に影響するため、取り消し対象外です。";
    case "deck_check":
    case "deck_public_check":
    case "deck_select":
    case "deck_public_select":
    case "move_from_deck":
    case "deck_order":
      return "山札順が絡む操作は取り消し対象外です。";
    case "shield_break":
    case "shield_break_check":
      return "シールドブレイクは確認情報を含むため、取り消し対象外です。";
    case "start_game":
      return "対戦開始は取り消し対象外です。";
    default:
      return "この操作は現在の安全版Ctrl+Zでは取り消し対象外です。";
  }
}

function getStackCardIdsForMove(roomState: RoomState, cardId: string) {
  const card = roomState.cardInstances[cardId];

  if (!card?.stackId) {
    return [cardId];
  }

  const stackIds = roomState.stacks[card.stackId] ?? [cardId];

  return stackIds.filter((id) => Boolean(roomState.cardInstances[id]));
}

function getStackTopCardId(roomState: RoomState, stackId: string) {
  const stackIds = roomState.stacks[stackId] ?? [];
  return stackIds[stackIds.length - 1] ?? null;
}

function getStackSummary(roomState: RoomState, cardId: string) {
  const card = roomState.cardInstances[cardId];

  if (!card?.stackId) {
    return {
      stackId: null,
      cardIds: [cardId],
      topCardId: cardId,
      count: 1
    };
  }

  const cardIds = getStackCardIdsForMove(roomState, cardId);
  const topCardId = getStackTopCardId(roomState, card.stackId) ?? cardId;

  return {
    stackId: card.stackId,
    cardIds,
    topCardId,
    count: cardIds.length
  };
}

function cleanStacksAfterMovingCards(
  roomState: RoomState,
  nextCardInstances: RoomState["cardInstances"],
  movedCardIds: string[]
) {
  const movedSet = new Set(movedCardIds);
  const nextStacks: RoomState["stacks"] = {};

  Object.entries(roomState!.stacks).forEach(([stackId, stackCardIds]) => {
    const remainingIds = stackCardIds.filter((id) => !movedSet.has(id));

    if (remainingIds.length >= 2) {
      nextStacks[stackId] = remainingIds;

      remainingIds.forEach((id) => {
        const card = nextCardInstances[id];
        if (!card) return;

        nextCardInstances[id] = {
          ...card,
          stackId
        };
      });
    } else if (remainingIds.length === 1) {
      const onlyId = remainingIds[0];
      const card = nextCardInstances[onlyId];

      if (card) {
        nextCardInstances[onlyId] = {
          ...card,
          stackId: null
        };
      }
    }
  });

  return nextStacks;
}

function applyDeckCardFieldsToCard(
  card: RoomState["cardInstances"][string],
  deckCard: DeckCardRow
): RoomState["cardInstances"][string] {
  const imageUrl = deckCard.image_url ?? deckCard.imageUrl ?? null;

  return {
    ...card,
    cardId: deckCard.card_id ?? (card as typeof card & { cardId?: string | null }).cardId ?? null,
    imageUrl: imageUrl ?? (card as typeof card & { imageUrl?: string | null }).imageUrl ?? null,
    image_url: imageUrl ?? (card as typeof card & { image_url?: string | null }).image_url ?? null,
    civilization:
      deckCard.civilization ??
      (card as typeof card & { civilization?: string | null }).civilization ??
      null,
    cost:
      deckCard.cost ??
      (card as typeof card & { cost?: number | null }).cost ??
      null,
    type:
      deckCard.type ??
      (card as typeof card & { type?: string | null }).type ??
      null,
    race:
      deckCard.race ??
      (card as typeof card & { race?: string | null }).race ??
      null,
    power:
      deckCard.power ??
      (card as typeof card & { power?: string | number | null }).power ??
      null,
    text:
      deckCard.text ??
      (card as typeof card & { text?: string | null }).text ??
      null
  } as typeof card & {
    cardId?: string | null;
    imageUrl?: string | null;
    image_url?: string | null;
    civilization?: string | null;
    cost?: number | null;
    type?: string | null;
    race?: string | null;
    power?: string | number | null;
    text?: string | null;
  };
}

function applyDeckImageUrlsToInitialState(
  initialState: RoomState,
  player1DeckCards: DeckCardRow[],
  player2DeckCards: DeckCardRow[]
): RoomState {
  const nextCardInstances = { ...initialState.cardInstances };

  const applyToPlayer = (player: PlayerSide, deckCards: DeckCardRow[]) => {
    if (deckCards.length === 0) return;

    const deckCardQueuesByName = new Map<string, DeckCardRow[]>();

    deckCards.forEach((deckCard) => {
      const key = normalizeCardNameForLookup(deckCard.card_name);
      const queue = deckCardQueuesByName.get(key) ?? [];
      queue.push(deckCard);
      deckCardQueuesByName.set(key, queue);
    });

    const playerCardIds = Object.values(initialState.cardInstances)
      .filter((card) => card.owner === player)
      .map((card) => card.id);

    const orderedPlayerCardIds = [
      ...initialState.players[player].shields.flatMap((stack) => stack),
      ...initialState.players[player].hand,
      ...initialState.players[player].deckOrder,
      ...initialState.players[player].battle,
      ...initialState.players[player].mana,
      ...initialState.players[player].grave,
      ...playerCardIds.filter(
        (cardId) =>
          !initialState.players[player].shields.flatMap((stack) => stack).includes(cardId) &&
          !initialState.players[player].hand.includes(cardId) &&
          !initialState.players[player].deckOrder.includes(cardId) &&
          !initialState.players[player].battle.includes(cardId) &&
          !initialState.players[player].mana.includes(cardId) &&
          !initialState.players[player].grave.includes(cardId)
      )
    ];

    orderedPlayerCardIds.forEach((cardInstanceId, index) => {
      const card = nextCardInstances[cardInstanceId];
      if (!card) return;

      const cardNameKey = normalizeCardNameForLookup(card.name);
      const queue = deckCardQueuesByName.get(cardNameKey);
      const deckCardFromName = queue?.shift();
      const deckCard = deckCardFromName ?? deckCards[index];

      if (!deckCard) return;

      nextCardInstances[cardInstanceId] = applyDeckCardFieldsToCard(card, deckCard);
    });
  };

  applyToPlayer("player1", player1DeckCards);
  applyToPlayer("player2", player2DeckCards);

  return {
    ...initialState,
    cardInstances: nextCardInstances
  };
}

function shuffleDeckCards<T>(cards: T[]): T[] {
  const next = [...cards];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

function createSoloPreparationRoomState(params: {
  roomId: string;
  player: PlayerSide;
  deckCards: DeckCardRow[];
}): RoomState {
  const { roomId, player, deckCards } = params;
  const shuffledCards = shuffleDeckCards(deckCards);
  const shieldCards = shuffledCards.slice(0, 5);
  const handCards = shuffledCards.slice(5, 10);
  const remainingDeckCards = shuffleDeckCards(shuffledCards.slice(10));
  const orderedCards = [...shieldCards, ...handCards, ...remainingDeckCards];

  const deckOrder: string[] = [];
  const hand: string[] = [];
  const shields: string[][] = [];
  const cardInstances: RoomState["cardInstances"] = {};

  orderedCards.forEach((deckCard, index) => {
    const safeName = deckCard.card_name || `カード${index + 1}`;
    const cardInstanceId = `${player}_prep_${index}_${deckCard.card_id ?? safeName}`;
    const imageUrl = deckCard.image_url ?? deckCard.imageUrl ?? null;

    let zone: Zone = "deck";

    if (index < 5) {
      shields.push([cardInstanceId]);
      zone = "shield";
    } else if (index < 10) {
      hand.push(cardInstanceId);
      zone = "hand";
    } else {
      deckOrder.push(cardInstanceId);
      zone = "deck";
    }

    cardInstances[cardInstanceId] = {
      id: cardInstanceId,
      cardId: deckCard.card_id ?? null,
      name: safeName,
      owner: player,
      zone,
      faceUp: false,
      tapped: false,
      reversed: false,
      stackId: null,
      imageUrl: imageUrl ?? null,
      image_url: imageUrl ?? null,
      civilization: deckCard.civilization ?? null,
      cost: deckCard.cost ?? null,
      type: deckCard.type ?? null,
      race: deckCard.race ?? null,
      power: deckCard.power ?? null,
      text: deckCard.text ?? null
    } as RoomState["cardInstances"][string] & {
      cardId?: string | null;
      imageUrl?: string | null;
      image_url?: string | null;
      civilization?: string | null;
      cost?: number | null;
      type?: string | null;
      race?: string | null;
      power?: string | number | null;
      text?: string | null;
    };
  });

  const playerBoard = {
    deckOrder,
    hand,
    battle: [] as string[],
    mana: [] as string[],
    grave: [] as string[],
    shields
  };

  const emptyBoard = {
    deckOrder: [] as string[],
    hand: [] as string[],
    battle: [] as string[],
    mana: [] as string[],
    grave: [] as string[],
    shields: [] as string[][]
  };

  return {
    roomId,
    players: {
      player1: player === "player1" ? playerBoard : emptyBoard,
      player2: player === "player2" ? playerBoard : emptyBoard
    },
    cardInstances,
    stacks: {}
  };
}

function askZoneForSelectedDeckCard(): Zone | null {
  const choice = window.prompt(
    "選んだカードをどこへ移動しますか？\n\n1：手札\n2：バトルゾーン\n3：マナ\n4：墓地\n5：シールド",
    "1"
  );

  if (choice === null) return null;

  switch (choice) {
    case "1":
      return "hand";
    case "2":
      return "battle";
    case "3":
      return "mana";
    case "4":
      return "grave";
    case "5":
      return "shield";
    default:
      window.alert("1〜5 の数字で入力してください。");
      return null;
  }
}

function normalizeCardNameForLookup(name: string) {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0)
    );
}

function mergeDeckCardWithMaster(
  deckCard: DeckCardRow,
  masterCard: CardMasterRow | undefined
): DeckCardRow {
  if (!masterCard) return deckCard;

  return {
    ...deckCard,
    card_id: deckCard.card_id ?? masterCard.id,
    image_url: masterCard.image_url ?? deckCard.image_url ?? deckCard.imageUrl ?? null,
    imageUrl: masterCard.image_url ?? deckCard.imageUrl ?? deckCard.image_url ?? null,
    civilization: masterCard.civilization ?? deckCard.civilization ?? null,
    cost: masterCard.cost ?? deckCard.cost ?? null,
    type: masterCard.type ?? deckCard.type ?? null,
    race: masterCard.race ?? deckCard.race ?? null,
    power: masterCard.power ?? deckCard.power ?? null,
    text: masterCard.text ?? deckCard.text ?? null
  };
}

async function enrichDeckCardsFromCardMaster(
  deckCards: DeckCardRow[]
): Promise<DeckCardRow[]> {
  const uniqueNames = Array.from(
    new Set(
      deckCards
        .map((card) => normalizeCardNameForLookup(card.card_name))
        .filter(Boolean)
    )
  );

  if (uniqueNames.length === 0) return deckCards;

  const { data, error } = await supabase
    .from("cards")
    .select("id, name, image_url, civilization, cost, type, race, power, text, is_official")
    .in("name", uniqueNames);

  if (error) {
    console.warn("カードマスター参照に失敗しました。deck_cards の情報のみで続行します。", error);
    return deckCards;
  }

  const masterMap = new Map<string, CardMasterRow>();

  ((data ?? []) as CardMasterRow[]).forEach((card) => {
    masterMap.set(normalizeCardNameForLookup(card.name), card);
  });

  return deckCards.map((deckCard) =>
    mergeDeckCardWithMaster(
      deckCard,
      masterMap.get(normalizeCardNameForLookup(deckCard.card_name))
    )
  );
}

async function getDeckCards(deckId: string): Promise<DeckCardRow[] | null> {
  const { data: detailData, error: detailError } = await supabase
    .from("deck_cards")
    .select("slot_index, card_id, card_name, image_url, civilization, cost, type, race, power, text")
    .eq("deck_id", deckId)
    .order("slot_index", { ascending: true });

  if (!detailError && detailData && detailData.length === 40) {
    return enrichDeckCardsFromCardMaster(detailData as DeckCardRow[]);
  }

  const { data, error } = await supabase
    .from("deck_cards")
    .select("slot_index, card_id, card_name")
    .eq("deck_id", deckId)
    .order("slot_index", { ascending: true });

  if (error) {
    console.error(error);
    return null;
  }

  if (!data || data.length !== 40) {
    return null;
  }

  return enrichDeckCardsFromCardMaster(data as DeckCardRow[]);
}


async function getDeckCardsForPreparation(deckId: string): Promise<DeckCardRow[]> {
  const { data: detailData, error: detailError } = await supabase
    .from("deck_cards")
    .select("slot_index, card_id, card_name, image_url, civilization, cost, type, race, power, text")
    .eq("deck_id", deckId)
    .order("slot_index", { ascending: true });

  if (!detailError && detailData && detailData.length > 0) {
    return enrichDeckCardsFromCardMaster(detailData as DeckCardRow[]);
  }

  const { data, error } = await supabase
    .from("deck_cards")
    .select("slot_index, card_id, card_name")
    .eq("deck_id", deckId)
    .order("slot_index", { ascending: true });

  if (error) {
    console.error("準備盤面用デッキ取得エラー:", error);
    return [];
  }

  return enrichDeckCardsFromCardMaster((data ?? []) as DeckCardRow[]);
}


function normalizeRoomStateForDisplay(state: RoomState | null): ExtendedRoomState | null {
  if (!state) return null;

  const seenCardIds = new Set<string>();
  const nextCardInstances: RoomState["cardInstances"] = { ...state.cardInstances };

  const cleanList = (cardIds: string[], owner: PlayerSide, zone: Zone) => {
    const nextIds: string[] = [];

    cardIds.forEach((cardId) => {
      const card = nextCardInstances[cardId];
      if (!card || seenCardIds.has(cardId)) return;

      seenCardIds.add(cardId);
      nextIds.push(cardId);
      nextCardInstances[cardId] = {
        ...card,
        owner,
        zone
      };
    });

    return nextIds;
  };

  const cleanShields = (shields: string[][], owner: PlayerSide) => {
    return shields
      .map((stack) => cleanList(stack, owner, "shield"))
      .filter((stack) => stack.length > 0);
  };

  const cleanPlayer = (owner: PlayerSide) => {
    const player = state.players[owner];

    return {
      ...player,
      deckOrder: cleanList(player.deckOrder, owner, "deck"),
      hand: cleanList(player.hand, owner, "hand"),
      battle: cleanList(player.battle, owner, "battle"),
      mana: cleanList(player.mana, owner, "mana"),
      grave: cleanList(player.grave, owner, "grave"),
      shields: cleanShields(player.shields, owner)
    };
  };

  const nextStacks: RoomState["stacks"] = {};

  Object.entries(state.stacks).forEach(([stackId, cardIds]) => {
    const existingIds = cardIds.filter((cardId) => Boolean(nextCardInstances[cardId]));

    if (existingIds.length >= 2) {
      nextStacks[stackId] = existingIds;
    }
  });

  const currentDeckVisibility = (state as ExtendedRoomState).deckVisibility ?? {};
  const nextDeckVisibility: Partial<Record<PlayerSide, DeckVisibility>> = {
    player1: currentDeckVisibility.player1 === "public" ? "public" : "private",
    player2: currentDeckVisibility.player2 === "public" ? "public" : "private"
  };

  return {
    ...state,
    deckVisibility: nextDeckVisibility,
    players: {
      player1: cleanPlayer("player1"),
      player2: cleanPlayer("player2")
    },
    cardInstances: nextCardInstances,
    stacks: nextStacks
  };
}


function validateRoomStateForSave(state: RoomState) {
  const seenCardIds = new Set<string>();

  const checkList = (cardIds: string[], owner: PlayerSide, zone: Zone) => {
    for (const cardId of cardIds) {
      const card = state.cardInstances[cardId];

      if (!card) {
        return `${zoneLabel(zone)}に存在しないカードが含まれています。`;
      }

      if (card.owner !== owner) {
        return `${zoneLabel(zone)}に別プレイヤーのカードが含まれています。`;
      }

      if (seenCardIds.has(cardId)) {
        return "同じカードが複数のゾーンに存在しています。再読み込みしてください。";
      }

      seenCardIds.add(cardId);
    }

    return null;
  };

  for (const player of ["player1", "player2"] as PlayerSide[]) {
    const board = state.players[player];
    const checks = [
      checkList(board.deckOrder, player, "deck"),
      checkList(board.hand, player, "hand"),
      checkList(board.battle, player, "battle"),
      checkList(board.mana, player, "mana"),
      checkList(board.grave, player, "grave"),
      ...board.shields.map((stack) => checkList(stack, player, "shield"))
    ];

    const error = checks.find(Boolean);
    if (error) return error;
  }

  return null;
}

export default function RoomDetailPage() {
  const params = useParams();
  const router = useRouter();
  const roomCode = params.roomCode as string;

  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [myRole, setMyRole] = useState<RoomMember["role"] | null>(null);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [savedDecks, setSavedDecks] = useState<SavedDeck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingDeck, setSavingDeck] = useState(false);
  const [starting, setStarting] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [clientId] = useState(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }

    return `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  });
  const [isStaleClient, setIsStaleClient] = useState(false);
  const [isBoardOperationPending, setIsBoardOperationPending] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState("");
  const boardOperationLockRef = useRef(false);
  const boardOperationUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeReloadSequenceRef = useRef(0);
  const realtimeReloadInFlightRef = useRef(false);
  const realtimeReloadQueuedRef = useRef(false);
  const lastRealtimeReloadAtRef = useRef(0);
  const lastAcceptedRoomStateUpdatedAtRef = useRef(0);
  const lastAcceptedOperationCountRef = useRef(0);
  const [showParticipantsPanel, setShowParticipantsPanel] = useState(false);
  const [showDeckPanel, setShowDeckPanel] = useState(false);
  const [showStartPanel, setShowStartPanel] = useState(false);
  const [activeLeftPopup, setActiveLeftPopup] = useState<"participants" | "deck" | "start" | null>(null);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyHeight = document.body.style.height;
    const previousHtmlHeight = document.documentElement.style.height;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.height = "100dvh";
    document.documentElement.style.height = "100dvh";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.height = previousBodyHeight;
      document.documentElement.style.height = previousHtmlHeight;
    };
  }, []);


  function unlockBoardOperation() {
    boardOperationLockRef.current = false;
    setIsBoardOperationPending(false);

    if (boardOperationUnlockTimerRef.current) {
      clearTimeout(boardOperationUnlockTimerRef.current);
      boardOperationUnlockTimerRef.current = null;
    }
  }

  function beginBoardOperation(actionLabel = "操作") {
    if (boardOperationLockRef.current) {
      setMessage(`${actionLabel}を処理中です。完了してから次の操作をしてください。`);
      return false;
    }

    boardOperationLockRef.current = true;
    setIsBoardOperationPending(true);

    if (boardOperationUnlockTimerRef.current) {
      clearTimeout(boardOperationUnlockTimerRef.current);
    }

    boardOperationUnlockTimerRef.current = setTimeout(() => {
      unlockBoardOperation();
    }, 8000);

    return true;
  }

  async function reloadRoomFromServer() {
    setMessage("ルームと盤面を再読み込みしています。");
    await loadRoom();
    unlockBoardOperation();
    setMessage("ルームと盤面を再読み込みしました。");
  }

  async function refreshMyConnectionStatus() {
    setMessage("接続状態を更新しています。");
    setIsStaleClient(false);
    unlockBoardOperation();
    await updateMyLastSeen();
    await loadRoom();
    setMessage("接続状態を更新しました。");
  }

  function scheduleRealtimeReload() {
    realtimeReloadQueuedRef.current = true;
    const sequence = realtimeReloadSequenceRef.current + 1;
    realtimeReloadSequenceRef.current = sequence;

    if (realtimeReloadTimerRef.current) {
      clearTimeout(realtimeReloadTimerRef.current);
    }

    const elapsedFromLastReload = Date.now() - lastRealtimeReloadAtRef.current;
    const delay = elapsedFromLastReload < 700 ? 700 : 450;

    realtimeReloadTimerRef.current = setTimeout(async () => {
      realtimeReloadTimerRef.current = null;

      if (sequence !== realtimeReloadSequenceRef.current) return;

      if (realtimeReloadInFlightRef.current) {
        scheduleRealtimeReload();
        return;
      }

      realtimeReloadQueuedRef.current = false;
      realtimeReloadInFlightRef.current = true;

      try {
        await loadRoom({ silent: true });
        lastRealtimeReloadAtRef.current = Date.now();
      } finally {
        realtimeReloadInFlightRef.current = false;

        if (realtimeReloadQueuedRef.current) {
          scheduleRealtimeReload();
        }
      }
    }, delay);
  }

  async function saveOperationLog(params: {
    eventType: string;
    message: string;
    payload?: Record<string, unknown>;
  }) {
    if (!room || !myProfile) return;

    const { error } = await supabase.from("room_operation_logs").insert({
      room_id: room!.id,
      actor_user_id: myProfile.id,
      actor_name: actorDisplayName(myProfile),
      event_type: params.eventType,
      message: compactOperationMessage(params.message),
      payload: compactOperationPayload(params.payload)
    });

    if (error) {
      console.error("操作ログ保存エラー:", error);
    }
  }

  async function persistRoomState(
    nextState: RoomState,
    options: { operationCount?: number; mode?: "update" | "upsert" } = {}
  ) {
    if (!room) {
      unlockBoardOperation();
      return new Error("ルーム情報を確認できません。ページを再読み込みしてください。");
    }

    const normalizedState = normalizeRoomStateForDisplay(nextState) ?? nextState;
    const validationError = validateRoomStateForSave(normalizedState);

    if (validationError) {
      unlockBoardOperation();
      return new Error(validationError);
    }

    const nextUpdatedAt = new Date().toISOString();
    const nextOperationCount =
      Math.max(lastAcceptedOperationCountRef.current, 0) + (options.operationCount ?? 1);

    const payload = {
      state_json: normalizedState,
      operation_count: nextOperationCount,
      updated_at: nextUpdatedAt
    };

    const result =
      options.mode === "upsert"
        ? await supabase.from("room_state").upsert({
            room_id: room.id,
            ...payload
          })
        : await supabase
            .from("room_state")
            .update(payload)
            .eq("room_id", room.id);

    if (result.error) {
      unlockBoardOperation();
      return result.error;
    }

    setRoomState(normalizedState);
    lastAcceptedRoomStateUpdatedAtRef.current = toTimeValue(nextUpdatedAt);
    lastAcceptedOperationCountRef.current = nextOperationCount;
    setLastSyncedAt(new Date().toLocaleTimeString());
    unlockBoardOperation();
    return null;
  }

  function rememberUndoSnapshot(params: {
    eventType: string;
    message: string;
  }) {
    if (!roomState) return;

    setUndoSnapshot({
      state: roomState,
      eventType: params.eventType,
      message: params.message
    });
  }

  function clearUndoSnapshot(params?: {
    eventType?: string;
    reason?: string;
  }) {
    setUndoSnapshot(null);

    if (params?.reason) {
      setMessage(params.reason);
      return;
    }

    if (params?.eventType) {
      setMessage(notUndoableReason(params.eventType));
    }
  }

  function canChangeBoardState(actionLabel = "操作") {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return false;
    }

    if (!room || !roomState) {
      setMessage(`${actionLabel}を実行できる盤面状態ではありません。`);
      return false;
    }

    const canUsePreparationBoard =
      room.status === "waiting" && (myRole === "player1" || myRole === "player2");

    if (room.status !== "playing" && !canUsePreparationBoard) {
      setMessage("対戦中または準備盤面でのみカード操作できます。終了済みルームでは確認だけできます。");
      return false;
    }

    if (myRole === "spectator") {
      setMessage("観戦者はカードを操作できません。");
      return false;
    }

    return beginBoardOperation(actionLabel);
  }



  async function updateMyLastSeen() {
    if (!room || !myProfile) return;

    const { data: member, error: readError } = await supabase
      .from("room_members")
      .select("id, active_client_id, last_seen_at")
      .eq("room_id", room!.id)
      .eq("user_id", myProfile.id)
      .is("left_at", null)
      .maybeSingle();

    if (readError) {
      console.error("接続状態確認エラー:", readError);
      return;
    }

    if (!member) return;

    if (member.active_client_id && member.active_client_id !== clientId) {
      const lastSeenAt = member.last_seen_at
        ? new Date(member.last_seen_at).getTime()
        : 0;
      const isRecentOtherClient =
        lastSeenAt > 0 && Date.now() - lastSeenAt < 45_000;

      if (isRecentOtherClient) {
        setIsStaleClient(true);
        setConnectionMessage("別端末で同じアカウントが開かれている可能性があります。");
        return;
      }

      setIsStaleClient(false);
      setConnectionMessage("前回接続が古いため、この画面で操作権限を復旧しました。");
    }

    const { error } = await supabase
      .from("room_members")
      .update({
        last_seen_at: new Date().toISOString(),
        active_client_id: clientId
      })
      .eq("id", member.id);

    if (error) {
      console.error("最終アクセス時刻更新エラー:", error);
      setConnectionMessage("接続状態の更新に失敗しました。");
      return;
    }

    setIsStaleClient(false);
  }

  async function ensureRoomMembership(params: {
  roomData: Room;
  profileId: string;
  currentMembers: RoomMember[];
}): Promise<{ role: RoomMember["role"]; selectedDeckId: string | null; message?: string } | null> {
  const { roomData, profileId, currentMembers } = params;

  const existingMember = currentMembers.find(
    (member) => member.user_id === profileId
  );

  if (existingMember) {
    return {
      role: existingMember.role,
      selectedDeckId: existingMember.selected_deck_id
    };
  }

  const { data: existingMemberInDb, error: existingMemberReadError } = await supabase
  .from("room_members")
  .select("id, role, selected_deck_id")
  .eq("room_id", roomData.id)
  .eq("user_id", profileId)
  .maybeSingle();

if (existingMemberReadError) {
  console.error("既存メンバー確認エラー:", existingMemberReadError);
}

if (existingMemberInDb) {
  const { error: reactivateError } = await supabase
    .from("room_members")
    .update({
      left_at: null,
      last_seen_at: new Date().toISOString(),
      active_client_id: clientId
    })
    .eq("id", existingMemberInDb.id);

  if (reactivateError) {
    console.error("再入室更新エラー:", reactivateError);
  }

  return {
    role: existingMemberInDb.role as RoomMember["role"],
    selectedDeckId: existingMemberInDb.selected_deck_id ?? null,
    message: "再入室しました。"
  };
}

  if (roomData.status !== "waiting") {
    return null;
  }

  const now = new Date().toISOString();
  const activePlayer1 = currentMembers.find((member) => member.role === "player1");
  const activePlayer2 = currentMembers.find((member) => member.role === "player2");
  const activeSpectators = currentMembers.filter((member) => member.role === "spectator");

  let nextRole: RoomMember["role"] = "spectator";

  if ((roomData.player1_id === profileId || roomData.owner_id === profileId) && !activePlayer1) {
    nextRole = "player1";
  } else if (!roomData.player2_id && !activePlayer2 && roomData.player1_id !== profileId) {
    nextRole = "player2";
  } else if (activeSpectators.length >= 3) {
    return {
      role: "spectator",
      selectedDeckId: null,
      message: "観戦者上限に達しているため、閲覧のみの状態です。"
    };
  }

  const { error: memberInsertError } = await supabase.from("room_members").insert({
    room_id: roomData.id,
    user_id: profileId,
    role: nextRole,
    selected_deck_id: null,
    joined_at: now,
    last_seen_at: now,
    active_client_id: clientId
  });

  if (memberInsertError) {
    console.error("自動入室エラー:", memberInsertError);

    const { data: duplicatedMember } = await supabase
      .from("room_members")
      .select("id, role, selected_deck_id")
      .eq("room_id", roomData.id)
      .eq("user_id", profileId)
      .is("left_at", null)
      .maybeSingle();

    if (duplicatedMember) {
      return {
        role: duplicatedMember.role as RoomMember["role"],
        selectedDeckId: duplicatedMember.selected_deck_id ?? null,
        message: "既に入室済みだったため、その状態でルームを表示します。"
      };
    }

    return {
      role: "spectator",
      selectedDeckId: null,
      message: `自動入室に失敗しましたが、ルーム表示は続行します：${memberInsertError.message}`
    };
  }

  if (nextRole === "player2") {
    const { error: roomUpdateError } = await supabase
      .from("rooms")
      .update({
        player2_id: profileId
      })
      .eq("id", roomData.id)
      .is("player2_id", null);

    if (roomUpdateError) {
      console.error("player2枠更新エラー:", roomUpdateError);
    }
  }

  return {
    role: nextRole,
    selectedDeckId: null,
    message:
      nextRole === "player1"
        ? "player1として部屋に入室しました。player2を待機できます。"
        : nextRole === "player2"
          ? "player2として入室しました。"
          : "観戦者として入室しました。"
  };
}

  async function loadRoom(options?: { silent?: boolean }) {
    if (!options?.silent) setLoading(true);

    try {
      const profile = await getOrCreateProfile();

      if (!profile) {
        setMessage("ログイン情報を確認できませんでした。");
        setLoading(false);
        return;
      }

      setMyProfile({
        id: profile.id,
        nickname: profile.nickname ?? null
      });

      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select(
          "id, room_code, owner_id, player1_id, player2_id, status, started_at, created_at"
        )
        .eq("room_code", roomCode)
        .maybeSingle();

      if (roomError) {
        console.error(roomError);
        setMessage(`ルーム情報の取得に失敗しました：${roomError.message}`);
        setLoading(false);
        return;
      }

      if (!roomData) {
        setMessage("ルームが見つかりません。");
        setLoading(false);
        return;
      }

      const typedRoomData = roomData as Room;

      const readMembers = async () => {
        const { data, error } = await supabase
          .from("room_members")
          .select("id, user_id, role, selected_deck_id, joined_at, last_seen_at, active_client_id")
          .eq("room_id", typedRoomData.id)
          .is("left_at", null)
          .order("joined_at", { ascending: true });

        if (error) {
          console.error("参加者情報取得エラー:", error);
          setMessage(`参加者情報の取得に失敗しました：${error.message}`);
          return [] as RoomMember[];
        }

        const baseMembers = (data ?? []) as Array<Omit<RoomMember, "profiles">>;
        const profileIds = Array.from(new Set(baseMembers.map((member) => member.user_id).filter(Boolean)));

        let profileMap = new Map<string, { nickname: string | null; role: string }>();

        if (profileIds.length > 0) {
          const { data: profileRows, error: profileReadError } = await supabase
            .from("profiles")
            .select("id, nickname, role")
            .in("id", profileIds);

          if (profileReadError) {
            console.warn("参加者プロフィール取得エラー:", profileReadError);
          } else {
            profileMap = new Map(
              ((profileRows ?? []) as Array<{ id: string; nickname: string | null; role: string | null }>).map((profileRow) => [
                profileRow.id,
                {
                  nickname: profileRow.nickname ?? null,
                  role: profileRow.role ?? "user"
                }
              ])
            );
          }
        }

        return baseMembers.map((member) => ({
          ...member,
          profiles: profileMap.get(member.user_id) ?? null
        })) as RoomMember[];
      };

      const initialMembers = await readMembers();

      const ensuredMembership = await ensureRoomMembership({
        roomData: typedRoomData,
        profileId: profile.id,
        currentMembers: initialMembers
      });

      const refreshedMembers = await readMembers();
      const myMember = refreshedMembers.find((member) => member.user_id === profile.id);

      const { data: deckData, error: deckError } = await supabase
        .from("decks")
        .select("id, name")
        .eq("owner_id", profile.id)
        .order("updated_at", { ascending: false });

      if (deckError) {
        console.error("デッキ一覧取得エラー:", deckError);
      }

      const { data: stateData, error: stateError } = await supabase
        .from("room_state")
        .select("state_json, updated_at, operation_count")
        .eq("room_id", typedRoomData.id)
        .maybeSingle();

      if (stateError) {
        console.error("盤面状態取得エラー:", stateError);
      }

      const stateRow = (stateData as RoomStateRow | null) ?? null;
      const incomingRoomStateUpdatedAt = toTimeValue(stateRow?.updated_at);
      const incomingOperationCount = stateRow?.operation_count ?? 0;
      const shouldAcceptIncomingRoomState =
        !options?.silent ||
        incomingRoomStateUpdatedAt >= lastAcceptedRoomStateUpdatedAtRef.current ||
        incomingOperationCount >= lastAcceptedOperationCountRef.current;

      const { data: latestRoomData } = await supabase
        .from("rooms")
        .select(
          "id, room_code, owner_id, player1_id, player2_id, status, started_at, created_at"
        )
        .eq("id", typedRoomData.id)
        .maybeSingle();

      setRoom((latestRoomData as Room | null) ?? typedRoomData);
      setMembers(refreshedMembers);
      setMyRole((myMember?.role as RoomMember["role"]) ?? ensuredMembership?.role ?? null);
      setSelectedDeckId(myMember?.selected_deck_id ?? ensuredMembership?.selectedDeckId ?? "");
      setSavedDecks(deckData ?? []);

      const loadedRoomState = (stateRow?.state_json as RoomState | null) ?? null;
      let nextLoadedRoomState = loadedRoomState;

      if (loadedRoomState) {
        const player1Member = refreshedMembers.find((member) => member.role === "player1");
        const player2Member = refreshedMembers.find((member) => member.role === "player2");

        const [player1DeckCards, player2DeckCards] = await Promise.all([
          player1Member?.selected_deck_id
            ? getDeckCardsForPreparation(player1Member.selected_deck_id)
            : Promise.resolve([] as DeckCardRow[]),
          player2Member?.selected_deck_id
            ? getDeckCardsForPreparation(player2Member.selected_deck_id)
            : Promise.resolve([] as DeckCardRow[])
        ]);

        nextLoadedRoomState = normalizeRoomStateForDisplay(
          applyDeckImageUrlsToInitialState(
            loadedRoomState,
            player1DeckCards,
            player2DeckCards
          )
        );

        if (JSON.stringify(nextLoadedRoomState) !== JSON.stringify(loadedRoomState)) {
          const { error: repairError } = await supabase
            .from("room_state")
            .update({
              state_json: nextLoadedRoomState,
              updated_at: new Date().toISOString()
            })
            .eq("room_id", typedRoomData.id);

          if (repairError) {
            console.warn("盤面カード画像情報の補完に失敗しました。表示のみ続行します。", repairError);
          }
        }
      }

      if (shouldAcceptIncomingRoomState) {
        setRoomState(normalizeRoomStateForDisplay(nextLoadedRoomState));
        if (incomingRoomStateUpdatedAt > 0) {
          lastAcceptedRoomStateUpdatedAtRef.current = incomingRoomStateUpdatedAt;
        }
        if (incomingOperationCount > 0) {
          lastAcceptedOperationCountRef.current = incomingOperationCount;
        }
      }

      const activeMember = myMember ?? refreshedMembers.find((member) => member.user_id === profile.id);

      if (activeMember) {
        await supabase
          .from("room_members")
          .update({
            last_seen_at: new Date().toISOString(),
            active_client_id: clientId
          })
          .eq("id", activeMember.id);
      }

      setIsStaleClient(false);

      if (!options?.silent) {
        if (ensuredMembership?.message) {
          setMessage(ensuredMembership.message);
        } else {
          setMessage("");
        }
      }
    } catch (error) {
      console.error("ルーム詳細ページの読み込みでエラー:", error);
      setMessage(
        error instanceof Error
          ? `ルーム詳細ページの読み込みでエラーが発生しました：${error.message}`
          : "ルーム詳細ページの読み込みで予期しないエラーが発生しました。"
      );
    } finally {
      setLastSyncedAt(new Date().toLocaleTimeString());
      setConnectionMessage("");
      setLoading(false);
    }
  }

  async function createOrUpdatePreparationBoard(deckId: string) {
    if (!room) {
      setMessage("ルーム情報を確認できません。ページを再読み込みしてください。");
      return;
    }

    if (myRole !== "player1" && myRole !== "player2") {
      setMessage("準備盤面を作成できるのはプレイヤーのみです。");
      return;
    }

    if (room.status !== "waiting") {
      setMessage("盤面リセットは対戦開始前のみ実行できます。");
      return;
    }

    if (!deckId) {
      setMessage("先に使用デッキを選択してください。");
      return;
    }

    const player = myRole;

    setMessage(`${player}用の盤面をリセットしています。`);

    try {
      const deckCards = await getDeckCardsForPreparation(deckId);

      if (deckCards.length === 0) {
        setMessage("盤面をリセットできませんでした。デッキにカードが登録されているか確認してください。");
        return;
      }

      const soloPreparationState = createSoloPreparationRoomState({
        roomId: room.id,
        player,
        deckCards
      });

      const previousState = roomState;
      const nextPlayerBoard = soloPreparationState.players[player];
      const nextPlayerCardInstances = Object.fromEntries(
        Object.entries(soloPreparationState.cardInstances).filter(
          ([, card]) => card.owner === player
        )
      ) as RoomState["cardInstances"];

      const nextCardInstances = previousState
        ? Object.fromEntries(
            Object.entries(previousState.cardInstances).filter(
              ([, card]) => card.owner !== player
            )
          ) as RoomState["cardInstances"]
        : {};

      const nextStacks = previousState
        ? Object.fromEntries(
            Object.entries(previousState.stacks).filter(([, cardIds]) =>
              cardIds.every((cardId) => previousState.cardInstances[cardId]?.owner !== player)
            )
          ) as RoomState["stacks"]
        : {};

      const nextState: RoomState = previousState
        ? {
            ...previousState,
            players: {
              ...previousState.players,
              [player]: nextPlayerBoard
            },
            cardInstances: {
              ...nextCardInstances,
              ...nextPlayerCardInstances
            },
            stacks: nextStacks
          }
        : soloPreparationState;

      const error = await persistRoomState(nextState, { operationCount: 1, mode: "upsert" });

      if (error) {
        console.error("盤面リセットエラー:", error);
        setMessage(`盤面リセットに失敗しました：${error.message}`);
        return;
      }

      setRoomState(nextState);
      setShowDeckPanel(false);
      setActiveLeftPopup(null);
      setMessage(
        `${player}の盤面をリセットしました。手札${nextPlayerBoard.hand.length}枚、シールド${nextPlayerBoard.shields.length}枚、山札${nextPlayerBoard.deckOrder.length}枚です。`
      );
    } catch (error) {
      console.error("盤面リセット中の予期しないエラー:", error);
      setMessage(
        error instanceof Error
          ? `盤面リセット中にエラーが発生しました：${error.message}`
          : "盤面リセット中に予期しないエラーが発生しました。"
      );
    }
  }

  async function saveSelectedDeck() {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room || !myProfile || !myRole) return;

    if (myRole === "spectator") {
      setMessage("観戦者はデッキを選択できません。");
      return;
    }

    if (!selectedDeckId) {
      setMessage("使用するデッキを選択してください。");
      return;
    }

    setSavingDeck(true);
    setMessage("");

    try {
      const { error } = await supabase
        .from("room_members")
        .update({
          selected_deck_id: selectedDeckId
        })
        .eq("room_id", room!.id)
        .eq("user_id", myProfile.id)
        .is("left_at", null);

      if (error) {
        console.error(error);
        setMessage("デッキ選択の保存に失敗しました。");
        return;
      }

      setMessage("使用デッキを保存しました。");

      await loadRoom();
    } finally {
      setSavingDeck(false);
    }
  }

  async function startMatch() {
    setMessage("対戦開始処理を確認しています。");

    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (starting) {
      setMessage("対戦開始処理中です。");
      return;
    }

    if (!room) {
      setMessage("ルーム情報を確認できません。ページを再読み込みしてください。");
      return;
    }

    if (myRole !== "player1") {
      setMessage("対戦開始はplayer1のみ実行できます。");
      return;
    }

    const player1Member = members.find((member) => member.role === "player1");
    const player2Member = members.find((member) => member.role === "player2");

    if (!player1Member) {
      setMessage("player1情報を確認できません。");
      return;
    }

    if (!player2Member) {
      setMessage("対戦準備画面で待機中です。player2が入室すると対戦開始できるようになります。");
      return;
    }

    if (!player1Member.selected_deck_id) {
      setMessage("player1のデッキが選択されていません。");
      return;
    }

    if (!player2Member.selected_deck_id) {
      setMessage("player2のデッキが選択されていません。");
      return;
    }

    const ok = window.confirm("両者の選択デッキで対戦を開始しますか？");
    if (!ok) {
      setMessage("対戦開始をキャンセルしました。");
      return;
    }

    setStarting(true);
    setMessage("デッキ情報を読み込んでいます。");

    try {
      const player1DeckCards = await getDeckCards(player1Member.selected_deck_id);
      const player2DeckCards = await getDeckCards(player2Member.selected_deck_id);

      if (!player1DeckCards) {
        setMessage("player1のデッキが40枚ではないか、取得に失敗しました。");
        return;
      }

      if (!player2DeckCards) {
        setMessage("player2のデッキが40枚ではないか、取得に失敗しました。");
        return;
      }

      setMessage("初期盤面を作成しています。");

      const initialState = typeof applyDeckImageUrlsToInitialState === "function"
        ? applyDeckImageUrlsToInitialState(
            createInitialRoomState({
              roomId: room.id,
              player1DeckCards,
              player2DeckCards
            }),
            player1DeckCards,
            player2DeckCards
          )
        : createInitialRoomState({
            roomId: room.id,
            player1DeckCards,
            player2DeckCards
          });

      const stateError = await persistRoomState(initialState, { operationCount: 0, mode: "upsert" });

      if (stateError) {
        console.error(stateError);
        setMessage(`盤面状態の作成に失敗しました：${stateError.message}`);
        return;
      }

      setMessage("ルーム状態を対戦中に更新しています。");

      const { error: roomError } = await supabase
        .from("rooms")
        .update({
          status: "playing",
          started_at: new Date().toISOString()
        })
        .eq("id", room.id);

      if (roomError) {
        console.error(roomError);
        setMessage(`対戦開始に失敗しました：${roomError.message}`);
        return;
      }

      await saveOperationLog({
        eventType: "start_game",
        message: `${actorDisplayName(myProfile)}が対戦を開始しました。`,
        payload: {
          player1DeckId: player1Member.selected_deck_id,
          player2DeckId: player2Member.selected_deck_id
        }
      });

      setMessage("対戦を開始しました。");
      await loadRoom();
    } catch (error) {
      console.error("対戦開始処理で予期しないエラー:", error);
      setMessage(
        error instanceof Error
          ? `対戦開始処理でエラーが発生しました：${error.message}`
          : "対戦開始処理で予期しないエラーが発生しました。"
      );
    } finally {
      setStarting(false);
    }
  }

  async function finishMatch() {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room) return;

    if (myRole !== "player1" && myRole !== "player2") {
      setMessage("対戦終了はプレイヤーのみ実行できます。");
      return;
    }

    const ok = window.confirm(
      "対戦を終了しますか？\n\n盤面とログは残ります。部屋を完全に閉じる場合は、別の「部屋を解散」ボタンを使用してください。"
    );
    if (!ok) return;

    const { error } = await supabase
      .from("rooms")
      .update({
        status: "finished",
        finished_at: new Date().toISOString()
      })
      .eq("id", room.id);

    if (error) {
      console.error(error);
      setMessage("対戦終了に失敗しました。");
      return;
    }

    await saveOperationLog({
      eventType: "finish_match",
      message: `${actorDisplayName(myProfile)}が対戦を終了しました。`,
      payload: {
        roomId: room!.id
      }
    });

    clearUndoSnapshot({
      reason: "対戦を終了しました。盤面とログは確認用に残っています。"
    });

    await loadRoom();
  }

  async function dissolveRoom() {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room || !myProfile) return;

    const canDissolve = myRole === "player1" || room.owner_id === myProfile.id;

    if (!canDissolve) {
      setMessage("部屋の解散はplayer1またはルーム作成者のみ実行できます。");
      return;
    }

    const firstOk = window.confirm(
      "部屋を解散しますか？\n\n解散すると盤面・操作ログ・参加状態を整理します。対戦終了だけしたい場合は「対戦終了」を使用してください。"
    );
    if (!firstOk) return;

    const secondOk = window.confirm(
      "本当に部屋を解散しますか？\n\nこの操作では盤面状態を削除し、参加者を退出扱いにします。"
    );
    if (!secondOk) return;

    const logDeleteOk = window.confirm(
      "操作ログも削除してよいですか？\n\n削除すると、この対戦の操作履歴は確認できなくなります。"
    );
    if (!logDeleteOk) {
      setMessage("部屋解散をキャンセルしました。操作ログは削除されていません。");
      return;
    }

    const now = new Date().toISOString();

    const { error: roomStateError } = await supabase
      .from("room_state")
      .delete()
      .eq("room_id", room!.id);

    if (roomStateError) {
      console.error(roomStateError);
      setMessage("盤面状態の削除に失敗しました。");
      return;
    }

    const { error: logError } = await supabase
      .from("room_operation_logs")
      .delete()
      .eq("room_id", room!.id);

    if (logError) {
      console.error(logError);
      setMessage("操作ログの削除に失敗しました。");
      return;
    }

    const { error: memberError } = await supabase
      .from("room_members")
      .update({
        left_at: now,
        active_client_id: null
      })
      .eq("room_id", room!.id)
      .is("left_at", null);

    if (memberError) {
      console.error(memberError);
      setMessage("参加者情報の更新に失敗しました。");
      return;
    }

    const { error: roomError } = await supabase
      .from("rooms")
      .update({
        status: "finished",
        finished_at: now
      })
      .eq("id", room.id);

    if (roomError) {
      console.error(roomError);
      setMessage("部屋の解散に失敗しました。");
      return;
    }

    setRoomState(null);
    setUndoSnapshot(null);
    setMessage("部屋を解散しました。");

    router.push("/rooms");
  }

  async function leaveRoom() {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room || !myProfile || !myRole) return;

    if (myRole !== "player1" && myRole !== "player2" && myRole !== "spectator") {
      setMessage("退出できる参加状態ではありません。");
      return;
    }

    const ok = window.confirm("このルームから退出しますか？");
    if (!ok) return;

    const now = new Date().toISOString();

    const { error: memberError } = await supabase
      .from("room_members")
      .update({
        left_at: now,
        active_client_id: null
      })
      .eq("room_id", room!.id)
      .eq("user_id", myProfile.id)
      .is("left_at", null);

    if (memberError) {
      console.error(memberError);
      setMessage("退出処理に失敗しました。");
      return;
    }

    if (myRole === "player2") {
      const { error: roomError } = await supabase
        .from("rooms")
        .update({
          player2_id: null
        })
        .eq("id", room.id);

      if (roomError) {
        console.error(roomError);
        setMessage("player2枠の更新に失敗しました。");
        return;
      }
    }

    if (myRole === "player1") {
      const player2Member = members.find(
        (member) => member.role === "player2" && member.user_id !== myProfile.id
      );

      if (player2Member) {
        const { error: ownerTransferError } = await supabase
          .from("rooms")
          .update({
            owner_id: player2Member.user_id,
            player1_id: player2Member.user_id,
            player2_id: null
          })
          .eq("id", room.id);

        if (ownerTransferError) {
          console.error(ownerTransferError);
          setMessage("player2への所有権譲渡に失敗しました。");
          return;
        }

        const { error: roleTransferError } = await supabase
          .from("room_members")
          .update({
            role: "player1"
          })
          .eq("id", player2Member.id);

        if (roleTransferError) {
          console.error(roleTransferError);
          setMessage("player2のplayer1昇格に失敗しました。");
          return;
        }

        await saveOperationLog({
          eventType: "leave_room",
          message: `${actorDisplayName(myProfile)}が退出し、player2にルーム所有権を譲渡しました。`,
          payload: {
            leavingRole: myRole,
            newOwnerUserId: player2Member.user_id
          }
        });
      } else {
        const { error: roomError } = await supabase
          .from("rooms")
          .update({
            status: "finished",
            finished_at: now
          })
          .eq("id", room.id);

        if (roomError) {
          console.error(roomError);
          setMessage("ルーム状態の更新に失敗しました。");
          return;
        }

        await saveOperationLog({
          eventType: "leave_room",
          message: `${actorDisplayName(myProfile)}が退出しました。player1不在のためルームを終了しました。`,
          payload: {
            leavingRole: myRole
          }
        });
      }
    }

    if (myRole === "spectator") {
      await saveOperationLog({
        eventType: "leave_room",
        message: `${actorDisplayName(myProfile)}が観戦から退出しました。`,
        payload: {
          leavingRole: myRole
        }
      });
    }

    setMessage("ルームから退出しました。");
    window.location.href = "/rooms";
  }

  async function drawCard(player: PlayerSide) {
    if (!canChangeBoardState("ドロー")) return;

    if (myRole !== player) {
      setMessage("自分の山札のみ操作できます。");
      return;
    }

    clearUndoSnapshot();

    const deckOrder = roomState!.players[player].deckOrder;

    if (deckOrder.length === 0) {
      setMessage("山札がありません。");
      return;
    }

    const drawnCardId = deckOrder[0];

    const nextState: RoomState = {
      ...roomState!,
      players: {
        ...roomState!.players,
        [player]: {
          ...roomState!.players[player],
          deckOrder: deckOrder.slice(1),
          hand: [...roomState!.players[player].hand, drawnCardId]
        }
      },
      cardInstances: {
        ...roomState!.cardInstances,
        [drawnCardId]: {
          ...roomState!.cardInstances[drawnCardId],
          zone: "hand",
          faceUp: false
        }
      }
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("ドローに失敗しました。");
      return;
    }

    await saveOperationLog({
      eventType: "draw",
      message: `${actorDisplayName(myProfile)}がカードを1枚引きました。`,
      payload: {
        player,
        cardInstanceId: drawnCardId
      }
    });

    setRoomState(nextState);
    setMessage("カードを1枚引きました。");
  }

  async function moveMultipleCards(cardIds: string[], toZone: Zone) {
    if (!canChangeBoardState("複数カード移動")) return;

    if (!myRole || myRole === "spectator") return;

    const requestedCardIds = Array.from(new Set(cardIds));

    if (requestedCardIds.length < 2) {
      setMessage("複数選択されたカードがありません。");
      return;
    }

    const expandedCardIds = Array.from(
      new Set(
        requestedCardIds.flatMap((cardId) => getStackCardIdsForMove(roomState!, cardId))
      )
    );

    const requestedStackIds = requestedCardIds
      .map((cardId) => roomState!.cardInstances[cardId]?.stackId ?? null)
      .filter((stackId): stackId is string => Boolean(stackId));

    if (requestedStackIds.length > 0) {
      const uniqueStackIds = Array.from(new Set(requestedStackIds));
      uniqueStackIds.forEach((stackId) => {
        const stackIds = roomState!.stacks[stackId] ?? [];
        stackIds.forEach((id) => {
          if (!expandedCardIds.includes(id)) {
            expandedCardIds.push(id);
          }
        });
      });
    }

    const cards = expandedCardIds
      .map((cardId) => roomState!.cardInstances[cardId])
      .filter((card): card is NonNullable<typeof card> => Boolean(card));

    if (cards.length !== expandedCardIds.length) {
      setMessage("選択されたカードの一部が見つかりません。");
      return;
    }

    const hasOtherPlayerCard = cards.some((card) => card.owner !== myRole);

    if (hasOtherPlayerCard) {
      setMessage("自分のカードのみ複数操作できます。");
      return;
    }

    const player = roomState!.players[myRole];
    const removeSet = new Set(expandedCardIds);
    const removeFrom = (list: string[]) => list.filter((id) => !removeSet.has(id));

    const nextPlayer = {
      ...player,
      deckOrder: removeFrom(player.deckOrder),
      hand: removeFrom(player.hand),
      battle: removeFrom(player.battle),
      mana: removeFrom(player.mana),
      grave: removeFrom(player.grave),
      shields: removeCardsFromShieldStacks(player.shields, expandedCardIds)
    };

    if (toZone === "hand") {
      nextPlayer.hand = [...nextPlayer.hand, ...expandedCardIds];
    }

    if (toZone === "battle") {
      nextPlayer.battle = [...nextPlayer.battle, ...expandedCardIds];
    }

    if (toZone === "mana") {
      nextPlayer.mana = [...nextPlayer.mana, ...expandedCardIds];
    }

    if (toZone === "grave") {
      nextPlayer.grave = [...nextPlayer.grave, ...expandedCardIds];
    }

    if (toZone === "shield") {
      nextPlayer.shields = [
        ...nextPlayer.shields,
        ...expandedCardIds.map((cardId) => [cardId])
      ];
    }

    if (toZone === "deck") {
      nextPlayer.deckOrder = [...expandedCardIds, ...nextPlayer.deckOrder];
    }

    const nextCardInstances = { ...roomState!.cardInstances };

    expandedCardIds.forEach((cardId) => {
      const card = nextCardInstances[cardId];
      if (!card) return;

      nextCardInstances[cardId] = {
        ...card,
        zone: toZone,
        faceUp: toZone === "battle" || toZone === "mana" || toZone === "grave",
        tapped: false,
        reversed: false,
        stackId: null
      };
    });

    const nextStacks = cleanStacksAfterMovingCards(
      roomState!,
      nextCardInstances,
      expandedCardIds
    );

    const nextState: RoomState = {
      ...roomState!,
      players: {
        ...roomState!.players,
        [myRole]: nextPlayer
      },
      cardInstances: nextCardInstances,
      stacks: nextStacks
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("複数カードの移動に失敗しました。");
      return;
    }

    const fromZones = Array.from(new Set(cards.map((card) => card.zone)));
    const shouldHideNames = fromZones.some((zone) => shouldHideCardName(zone));
    const movedStackCount = expandedCardIds.length - requestedCardIds.length;

    await saveOperationLog({
      eventType: "move_multiple_cards",
      message: `${actorDisplayName(myProfile)}がカード${expandedCardIds.length}枚を${zoneLabel(
        toZone
      )}へ移動しました。`,
      payload: {
        cardInstanceIds: expandedCardIds,
        requestedCardInstanceIds: requestedCardIds,
        cardNames: shouldHideNames ? null : cards.map((card) => card.name),
        fromZones,
        toZone,
        count: expandedCardIds.length,
        movedStackCount
      }
    });

    setRoomState(nextState);
    setMessage(
      movedStackCount > 0
        ? `重なっていたカードを含め、カード${expandedCardIds.length}枚を${zoneLabel(
            toZone
          )}へ移動しました。`
        : `カード${expandedCardIds.length}枚を${zoneLabel(toZone)}へ移動しました。`
    );
  }

  async function stackCardToBattle(cardId: string) {
    if (!canChangeBoardState("重ね出し")) return;

    const card = roomState!.cardInstances[cardId];

    if (!card) {
      setMessage("カードが見つかりません。");
      return;
    }

    if (card.owner !== myRole) {
      setMessage("自分のカードのみ操作できます。");
      return;
    }

    if (card.zone === "deck" || card.zone === "shield") {
      setMessage("山札・シールドのカードは直接重ね出しできません。");
      return;
    }

    const player = roomState!.players[card.owner];

    const targetCardIds = [
      ...player.battle,
      ...player.grave,
      ...player.mana,
      ...player.hand.filter((id) => id !== cardId)
    ].filter((id, index, array) => array.indexOf(id) === index);

    if (targetCardIds.length === 0) {
      setMessage("重ね先にできるカードがありません。");
      return;
    }

    const targetListText = targetCardIds
      .map((id, index) => {
        const target = roomState!.cardInstances[id];
        return `${index + 1}. ${target?.name ?? "不明なカード"}（${target ? zoneLabel(target.zone) : "不明"}）`;
      })
      .join("\n");

    const raw = window.prompt(
      `重ね先のカード番号を入力してください。\n\n${targetListText}`,
      "1"
    );

    if (raw === null) {
      setMessage("重ね出しをキャンセルしました。");
      return;
    }

    const targetIndex = Number.parseInt(raw, 10) - 1;

    if (
      !Number.isInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= targetCardIds.length
    ) {
      setMessage("有効なカード番号を入力してください。");
      return;
    }

    const targetCardId = targetCardIds[targetIndex];
    const targetCard = roomState!.cardInstances[targetCardId];

    if (!targetCard) {
      setMessage("重ね先のカードが見つかりません。");
      return;
    }

    const sourceZone = card.zone;
    const targetZone = targetCard.zone;
    const stackId = targetCard.stackId ?? `stack_${targetCard.id}`;
    const currentStack = Array.from(new Set(roomState!.stacks[stackId] ?? [targetCard.id]));

    const removeIds = new Set([cardId, targetCard.id]);
    const removeFrom = (list: string[]) => list.filter((id) => !removeIds.has(id));

    const nextPlayer = {
      ...player,
      deckOrder: removeFrom(player.deckOrder),
      hand: removeFrom(player.hand),
      battle: [...removeFrom(player.battle), cardId],
      mana: removeFrom(player.mana),
      grave: removeFrom(player.grave),
      shields: removeCardsFromShieldStacks(player.shields, Array.from(removeIds))
    };

    rememberUndoSnapshot({
      eventType: "stack_card",
      message: `${card.name}を${targetCard.name}に重ねて出す`
    });

    const nextState: RoomState = {
      ...roomState!,
      players: {
        ...roomState!.players,
        [card.owner]: nextPlayer
      },
      cardInstances: {
        ...roomState!.cardInstances,
        [targetCard.id]: {
          ...targetCard,
          zone: "battle",
          faceUp: true,
          tapped: false,
          reversed: false,
          stackId
        },
        [cardId]: {
          ...card,
          zone: "battle",
          faceUp: true,
          tapped: false,
          reversed: false,
          stackId
        }
      },
      stacks: {
        ...roomState!.stacks,
        [stackId]: [...currentStack.filter((id) => id !== cardId), cardId]
      }
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("重ね出しに失敗しました。");
      return;
    }

    await saveOperationLog({
      eventType: "stack_card",
      message: `${actorDisplayName(myProfile)}が${zoneLabel(sourceZone)}のカードを${zoneLabel(targetZone)}のカードに重ねて出しました。`,
      payload: {
        cardInstanceId: cardId,
        cardName: shouldHideCardName(sourceZone) ? null : card.name,
        targetCardInstanceId: targetCard.id,
        targetCardName: shouldHideCardName(targetZone) ? null : targetCard.name,
        sourceZone,
        targetZone,
        stackId
      }
    });

    setRoomState(nextState);
    setMessage(`${card.name} を ${targetCard.name} に重ねて出しました。`);
  }

  async function moveCard(cardId: string, toZone: Zone) {
    if (!canChangeBoardState("カード移動")) return;

    const card = roomState!.cardInstances[cardId];

    if (!card) {
      setMessage("カードが見つかりません。");
      return;
    }

    if (card.owner !== myRole) {
      setMessage("自分のカードのみ操作できます。");
      return;
    }

    const movingIds = getStackCardIdsForMove(roomState!, cardId);
    const movingCards = movingIds
      .map((id) => roomState!.cardInstances[id])
      .filter((movingCard): movingCard is NonNullable<typeof movingCard> =>
        Boolean(movingCard)
      );

    if (movingCards.length !== movingIds.length) {
      setMessage("重なっているカードの一部が見つかりません。");
      return;
    }

    const fromZone = card.zone;
    const player = roomState!.players[card.owner];
    const movingSet = new Set(movingIds);

    const removeFrom = (list: string[]) => list.filter((id) => !movingSet.has(id));

    const nextPlayer = {
      ...player,
      deckOrder: removeFrom(player.deckOrder),
      hand: removeFrom(player.hand),
      battle: removeFrom(player.battle),
      mana: removeFrom(player.mana),
      grave: removeFrom(player.grave),
      shields:
        fromZone === "shield"
          ? removeCardsFromShieldStacks(player.shields, movingIds)
          : player.shields
    };

    const keepAsStack = toZone === "battle" && movingIds.length > 1 && Boolean(card.stackId);

    if (toZone === "hand") {
      nextPlayer.hand = [...nextPlayer.hand, ...movingIds];
    }

    if (toZone === "battle") {
      const movingTopId = movingIds[movingIds.length - 1] ?? cardId;
      nextPlayer.battle = [...nextPlayer.battle, movingTopId];
    }

    if (toZone === "mana") {
      nextPlayer.mana = [...nextPlayer.mana, ...movingIds];
    }

    if (toZone === "grave") {
      nextPlayer.grave = [...nextPlayer.grave, ...movingIds];
    }

    if (toZone === "shield") {
      nextPlayer.shields = [...nextPlayer.shields, ...movingIds.map((id) => [id])];
    }

    if (toZone === "deck") {
      nextPlayer.deckOrder = [...movingIds, ...nextPlayer.deckOrder];
    }

    const nextFaceUp =
      toZone === "battle" || toZone === "mana" || toZone === "grave";

    const nextCardInstances = { ...roomState!.cardInstances };

    movingIds.forEach((movingId) => {
      const movingCard = nextCardInstances[movingId];
      if (!movingCard) return;

      nextCardInstances[movingId] = {
        ...movingCard,
        zone: toZone,
        faceUp: nextFaceUp,
        tapped: false,
        reversed: false,
        stackId: keepAsStack ? movingCard.stackId : null
      };
    });

    const nextStacks = keepAsStack && card.stackId
      ? {
          ...cleanStacksAfterMovingCards(roomState!, nextCardInstances, []),
          [card.stackId]: movingIds
        }
      : cleanStacksAfterMovingCards(roomState!, nextCardInstances, movingIds);

    const nextState: RoomState = {
      ...roomState!,
      players: {
        ...roomState!.players,
        [card.owner]: nextPlayer
      },
      cardInstances: nextCardInstances,
      stacks: nextStacks
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("カード移動に失敗しました。");
      return;
    }

    const hideCardName = shouldHideCardName(fromZone);
    const logCardName =
      movingIds.length > 1
        ? `重なっているカード${movingIds.length}枚`
        : hideCardName
          ? "カード"
          : `「${card.name}」`;

    await saveOperationLog({
      eventType: movingIds.length > 1 ? "move_stack_cards" : "move_card",
      message: `${actorDisplayName(myProfile)}が${logCardName}を${zoneLabel(
        fromZone
      )}から${zoneLabel(toZone)}へ移動しました。`,
      payload: {
        cardInstanceId: cardId,
        cardInstanceIds: movingIds,
        cardName: hideCardName ? null : card.name,
        cardNames: hideCardName ? null : movingCards.map((movingCard) => movingCard.name),
        fromZone,
        toZone,
        owner: card.owner,
        faceUp: nextFaceUp,
        movedAsStack: movingIds.length > 1
      }
    });

    setRoomState(nextState);
    setMessage(
      movingIds.length > 1
        ? `重なっているカード${movingIds.length}枚をまとめて${zoneLabel(
            fromZone
          )}から${zoneLabel(toZone)}へ移動しました。`
        : `${card.name} を ${zoneLabel(fromZone)} から ${zoneLabel(
            toZone
          )} へ移動しました。`
    );
  }

  async function revealCard(cardId: string) {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room || !roomState) return;

    const card = roomState!.cardInstances[cardId];

    if (!card) {
      setMessage("カードが見つかりません。");
      return;
    }

    if (card.owner !== myRole) {
      setMessage("自分のカードのみ公開できます。");
      return;
    }

    if (card.zone !== "hand") {
      setMessage("手札のカードのみ公開できます。");
      return;
    }

    if (card.faceUp) {
      setMessage("このカードはすでに公開中です。");
      return;
    }

    const nextState: RoomState = {
      ...roomState!,
      cardInstances: {
        ...roomState!.cardInstances,
        [cardId]: {
          ...card,
          faceUp: true
        }
      }
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("カード公開に失敗しました。");
      return;
    }

    await saveOperationLog({
      eventType: "reveal_card",
      message: `${actorDisplayName(myProfile)}が手札のカードを公開しました。`,
      payload: {
        cardInstanceId: cardId,
        cardName: null,
        zone: "hand"
      }
    });

    setRoomState(nextState);
    setMessage(`${card.name} を公開しました。Escで公開中のカードをすべて非公開にできます。`);
  }

  async function cancelAllRevealedCards() {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room || !roomState || !myRole) return;

    if (myRole === "spectator") {
      return;
    }

    const myHandIds = roomState!.players[myRole].hand;
    const revealedIds = myHandIds.filter((cardId) => {
      const card = roomState!.cardInstances[cardId];
      return card?.faceUp;
    });

    if (revealedIds.length === 0) {
      return;
    }

    const nextCardInstances = { ...roomState!.cardInstances };

    revealedIds.forEach((cardId) => {
      const card = nextCardInstances[cardId];
      if (!card) return;

      nextCardInstances[cardId] = {
        ...card,
        faceUp: false
      };
    });

    const nextState: RoomState = {
      ...roomState!,
      cardInstances: nextCardInstances
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("公開キャンセルに失敗しました。");
      return;
    }

    await saveOperationLog({
      eventType: "cancel_reveal_cards",
      message: `${actorDisplayName(myProfile)}が公開中の手札を非公開に戻しました。`,
      payload: {
        count: revealedIds.length
      }
    });

    setRoomState(nextState);
    setMessage("公開中の手札をすべて非公開にしました。");
  }

  async function moveCardToManaWithFace(cardId: string, faceUp: boolean) {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room || !roomState) return;

    const card = roomState!.cardInstances[cardId];

    if (!card) {
      setMessage("カードが見つかりません。");
      return;
    }

    if (card.owner !== myRole) {
      setMessage("自分のカードのみ操作できます。");
      return;
    }

    const fromZone = card.zone;
    const player = roomState!.players[card.owner];

    const removeFrom = (list: string[]) => list.filter((id) => id !== cardId);

    const nextPlayer = {
      ...player,
      deckOrder: removeFrom(player.deckOrder),
      hand: removeFrom(player.hand),
      battle: removeFrom(player.battle),
      mana: [...removeFrom(player.mana), cardId],
      grave: removeFrom(player.grave),
      shields:
        fromZone === "shield"
          ? removeCardFromShieldStacks(player.shields, cardId)
          : player.shields
    };

    rememberUndoSnapshot({
      eventType: "move_card",
      message: `${card.name}を${zoneLabel(fromZone)}からマナへ移動`
    });

    const nextState: RoomState = {
      ...roomState!,
      players: {
        ...roomState!.players,
        [card.owner]: nextPlayer
      },
      cardInstances: {
        ...roomState!.cardInstances,
        [cardId]: {
          ...card,
          zone: "mana",
          faceUp,
          tapped: false,
          reversed: false
        }
      }
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("マナゾーンへの移動に失敗しました。");
      return;
    }

    const logCardName = shouldHideCardName(fromZone)
      ? "カード"
      : `「${card.name}」`;

    await saveOperationLog({
      eventType: "move_card",
      message: `${actorDisplayName(myProfile)}が${logCardName}を${zoneLabel(
        fromZone
      )}からマナへ${faceUp ? "表向きで" : "裏向きで"}移動しました。`,
      payload: {
        cardInstanceId: cardId,
        cardName: shouldHideCardName(fromZone) ? null : card.name,
        fromZone,
        toZone: "mana",
        faceUp,
        owner: card.owner
      }
    });

    setRoomState(nextState);
    setMessage(
      `${card.name} をマナへ${faceUp ? "表向きで" : "裏向きで"}移動しました。`
    );
  }

  async function updateCardOrientation(
    cardId: string,
    kind: "tapped" | "reversed" | "faceUp"
  ) {
    if (!canChangeBoardState("カード状態変更")) return;

    const card = roomState!.cardInstances[cardId];

    if (!card) {
      setMessage("カードが見つかりません。");
      return;
    }

    if (card.owner !== myRole) {
      setMessage("自分のカードのみ操作できます。");
      return;
    }

    const nextCard =
      kind === "tapped"
        ? {
            ...card,
            tapped: !Boolean(card.tapped),
            reversed: false
          }
        : {
            ...card,
            [kind]: !Boolean(card[kind])
          };

    rememberUndoSnapshot({
      eventType: "card_state",
      message: `${card.name}の状態変更`
    });

    const nextState: RoomState = {
      ...roomState!,
      cardInstances: {
        ...roomState!.cardInstances,
        [cardId]: nextCard
      }
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("カード状態の変更に失敗しました。");
      return;
    }

    const actionLabel =
      kind === "tapped"
        ? nextCard.tapped
          ? "タップしました"
          : "アンタップしました"
        : kind === "reversed"
          ? nextCard.reversed
            ? "上下反転しました"
            : "上下反転を解除しました"
          : nextCard.faceUp
            ? "表向きにしました"
            : "裏向きにしました";

    const logCardName = shouldHideCardName(card.zone)
      ? "カード"
      : `「${card.name}」`;

    await saveOperationLog({
      eventType: "card_state",
      message: `${actorDisplayName(myProfile)}が${logCardName}を${actionLabel}。`,
      payload: {
        cardInstanceId: cardId,
        cardName: shouldHideCardName(card.zone) ? null : card.name,
        kind,
        value: nextCard[kind]
      }
    });

    setRoomState(nextState);
    setMessage(`${card.name} を${actionLabel}。`);
  }


  async function updateMultipleCardOrientation(
    cardIds: string[],
    kind: "tapped" | "reversed" | "faceUp"
  ) {
    if (!canChangeBoardState("複数カード状態変更")) return;

    const currentRoomState = roomState;

    if (!currentRoomState) {
      setMessage("盤面状態を確認できません。");
      unlockBoardOperation();
      return;
    }

    if (!myRole || myRole === "spectator") {
      setMessage("観戦者はカードを操作できません。");
      unlockBoardOperation();
      return;
    }

    const uniqueCardIds = Array.from(new Set(cardIds));
    const cards = uniqueCardIds
      .map((cardId) => currentRoomState.cardInstances[cardId])
      .filter((card): card is NonNullable<typeof card> => Boolean(card));

    if (cards.length !== uniqueCardIds.length) {
      setMessage("選択されたカードの一部が見つかりません。");
      unlockBoardOperation();
      return;
    }

    if (cards.some((card) => card.owner !== myRole)) {
      setMessage("自分のカードのみ向き変更できます。");
      unlockBoardOperation();
      return;
    }

    const shouldSetTrue = cards.some((card) => !Boolean(card[kind]));
    const nextCardInstances = { ...currentRoomState.cardInstances };

    uniqueCardIds.forEach((cardId) => {
      const card = nextCardInstances[cardId];
      if (!card) return;

      nextCardInstances[cardId] =
        kind === "tapped"
          ? {
              ...card,
              tapped: shouldSetTrue,
              reversed: false
            }
          : {
              ...card,
              [kind]: shouldSetTrue
            };
    });

    rememberUndoSnapshot({
      eventType: "card_state",
      message: `カード${uniqueCardIds.length}枚の状態変更`
    });

    const nextState: RoomState = {
      ...currentRoomState,
      cardInstances: nextCardInstances
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("複数カードの状態変更に失敗しました。");
      return;
    }

    const actionLabel =
      kind === "tapped"
        ? shouldSetTrue
          ? "タップしました"
          : "アンタップしました"
        : kind === "reversed"
          ? shouldSetTrue
            ? "上下反転しました"
            : "上下反転を解除しました"
          : shouldSetTrue
            ? "表向きにしました"
            : "裏向きにしました";

    await saveOperationLog({
      eventType: "card_state",
      message: `${actorDisplayName(myProfile)}がカード${uniqueCardIds.length}枚を${actionLabel}。`,
      payload: {
        cardInstanceIds: uniqueCardIds,
        kind,
        value: shouldSetTrue,
        count: uniqueCardIds.length
      }
    });

    setRoomState(nextState);
    setMessage(`カード${uniqueCardIds.length}枚を${actionLabel}。`);
  }

  async function sealTopCard(targetCardId: string) {
    if (!canChangeBoardState("封印")) return;

    if (!myRole || myRole === "spectator") return;

    const targetCard = roomState!.cardInstances[targetCardId];

    if (!targetCard) {
      setMessage("封印先のカードが見つかりません。");
      return;
    }

    if (targetCard.owner !== myRole || targetCard.zone !== "battle") {
      setMessage("自分のバトルゾーンのカードにのみ封印できます。");
      return;
    }

    const player = roomState!.players[myRole];
    const sealCardId = player.deckOrder[0];

    if (!sealCardId) {
      setMessage("山札がありません。封印できません。");
      return;
    }

    const sealCard = roomState!.cardInstances[sealCardId];

    if (!sealCard) {
      setMessage("山札上のカードが見つかりません。");
      return;
    }

    const stackId = targetCard.stackId ?? `stack_${targetCard.id}`;
    const currentStack = Array.from(new Set(roomState!.stacks[stackId] ?? [targetCard.id]));
    const nextStack = [...currentStack.filter((id) => id !== sealCardId), sealCardId];

    const topBeforeSeal = currentStack[currentStack.length - 1] ?? targetCard.id;
    const nextBattle = [
      ...player.battle.filter((id) => id !== sealCardId && id !== topBeforeSeal && id !== targetCard.id),
      sealCardId
    ];

    rememberUndoSnapshot({
      eventType: "seal_from_deck",
      message: "山札上から封印"
    });

    const nextState: RoomState = {
      ...roomState!,
      players: {
        ...roomState!.players,
        [myRole]: {
          ...player,
          deckOrder: player.deckOrder.slice(1),
          battle: nextBattle
        }
      },
      cardInstances: {
        ...roomState!.cardInstances,
        [targetCard.id]: {
          ...targetCard,
          stackId
        },
        [sealCardId]: {
          ...sealCard,
          zone: "battle",
          faceUp: false,
          tapped: false,
          reversed: false,
          stackId
        }
      },
      stacks: {
        ...roomState!.stacks,
        [stackId]: nextStack
      }
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("封印に失敗しました。");
      return;
    }

    await saveOperationLog({
      eventType: "seal_from_deck",
      message: `${actorDisplayName(myProfile)}が山札上からカードを封印しました。`,
      payload: {
        targetCardInstanceId: targetCard.id,
        sealCardInstanceId: sealCardId,
        stackId
      }
    });

    setRoomState(nextState);
    setMessage("山札上から封印しました。");
  }

  async function moveTopStackCardToGrave(cardId: string) {
    if (!canChangeBoardState("封印を墓地へ")) return;

    if (!myRole || myRole === "spectator") return;

    const selectedCard = roomState!.cardInstances[cardId];

    if (!selectedCard) {
      setMessage("カードが見つかりません。");
      return;
    }

    if (selectedCard.owner !== myRole || selectedCard.zone !== "battle") {
      setMessage("自分のバトルゾーンのカードのみ操作できます。");
      return;
    }

    const stackId = selectedCard.stackId;

    if (!stackId) {
      setMessage("このカードには封印または進化元がありません。");
      return;
    }

    const currentStack = roomState!.stacks[stackId] ?? [];
    const sealCardId = currentStack[currentStack.length - 1];

    if (!sealCardId || currentStack.length < 2) {
      setMessage("墓地へ送れる封印がありません。");
      return;
    }

    const sealCard = roomState!.cardInstances[sealCardId];

    if (!sealCard) {
      setMessage("封印カードが見つかりません。");
      return;
    }

    const remainingStack = currentStack.slice(0, -1);
    const newTopCardId = remainingStack[remainingStack.length - 1];

    if (!newTopCardId) {
      setMessage("封印解除後に残るカードを確認できませんでした。");
      return;
    }

    const player = roomState!.players[myRole];
    const nextCardInstances = { ...roomState!.cardInstances };

    nextCardInstances[sealCardId] = {
      ...sealCard,
      zone: "grave",
      faceUp: true,
      tapped: false,
      reversed: false,
      stackId: null
    };

    remainingStack.forEach((remainingId) => {
      const remainingCard = nextCardInstances[remainingId];
      if (!remainingCard) return;

      nextCardInstances[remainingId] = {
        ...remainingCard,
        stackId: remainingStack.length >= 2 ? stackId : null
      };
    });

    const nextStacks = { ...roomState!.stacks };

    if (remainingStack.length >= 2) {
      nextStacks[stackId] = remainingStack;
    } else {
      delete nextStacks[stackId];
    }

    rememberUndoSnapshot({
      eventType: "seal_to_grave",
      message: "封印を墓地へ"
    });

    const nextState: RoomState = {
      ...roomState!,
      players: {
        ...roomState!.players,
        [myRole]: {
          ...player,
          battle: [...player.battle.filter((id) => id !== sealCardId && id !== newTopCardId), newTopCardId],
          grave: [...player.grave.filter((id) => id !== sealCardId), sealCardId]
        }
      },
      cardInstances: nextCardInstances,
      stacks: nextStacks
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("封印を墓地へ送る処理に失敗しました。");
      return;
    }

    await saveOperationLog({
      eventType: "seal_to_grave",
      message: `${actorDisplayName(myProfile)}が封印を墓地へ送りました。`,
      payload: {
        sealCardInstanceId: sealCardId,
        stackId
      }
    });

    setRoomState(nextState);
    setMessage("封印を墓地へ送りました。");
  }

  async function moveStackSourceOnly(cardId: string, toZone: Zone) {
    if (!canChangeBoardState("進化元移動")) return;

    if (!myRole || myRole === "spectator") return;

    const selectedCard = roomState!.cardInstances[cardId];

    if (!selectedCard) {
      setMessage("カードが見つかりません。");
      return;
    }

    if (selectedCard.owner !== myRole || selectedCard.zone !== "battle") {
      setMessage("自分のバトルゾーンの進化カードのみ操作できます。");
      return;
    }

    const stackId = selectedCard.stackId;

    if (!stackId) {
      setMessage("このカードには進化元がありません。");
      return;
    }

    const currentStack = roomState!.stacks[stackId] ?? [];

    if (currentStack.length < 2) {
      setMessage("移動できる進化元がありません。");
      return;
    }

    const movableSourceIds = currentStack.slice(0, -1);
    const sourceListText = movableSourceIds
      .map((id, index) => {
        const sourceCard = roomState!.cardInstances[id];
        return `${index + 1}. ${sourceCard?.name ?? "不明なカード"}`;
      })
      .join("\n");

    const raw =
      movableSourceIds.length === 1
        ? "1"
        : window.prompt(
            `移動する進化元の番号を入力してください。\n\n${sourceListText}`,
            "1"
          );

    if (raw === null) {
      setMessage("進化元移動をキャンセルしました。");
      return;
    }

    const sourceIndex = Number.parseInt(raw, 10) - 1;

    if (
      !Number.isInteger(sourceIndex) ||
      sourceIndex < 0 ||
      sourceIndex >= movableSourceIds.length
    ) {
      setMessage("有効な番号を入力してください。");
      return;
    }

    const sourceCardId = movableSourceIds[sourceIndex];
    const sourceCard = roomState!.cardInstances[sourceCardId];

    if (!sourceCard) {
      setMessage("進化元カードが見つかりません。");
      return;
    }

    const remainingStack = currentStack.filter((id) => id !== sourceCardId);
    const player = roomState!.players[myRole];
    const nextCardInstances = { ...roomState!.cardInstances };

    nextCardInstances[sourceCardId] = {
      ...sourceCard,
      zone: toZone,
      faceUp: toZone === "battle" || toZone === "mana" || toZone === "grave",
      tapped: false,
      reversed: false,
      stackId: null
    };

    remainingStack.forEach((remainingId) => {
      const remainingCard = nextCardInstances[remainingId];
      if (!remainingCard) return;

      nextCardInstances[remainingId] = {
        ...remainingCard,
        stackId: remainingStack.length >= 2 ? stackId : null
      };
    });

    const removeFrom = (list: string[]) => list.filter((id) => id !== sourceCardId);

    const nextPlayer = {
      ...player,
      deckOrder: removeFrom(player.deckOrder),
      hand: removeFrom(player.hand),
      battle: player.battle,
      mana: removeFrom(player.mana),
      grave: removeFrom(player.grave),
      shields: removeCardFromShieldStacks(player.shields, sourceCardId)
    };

    if (toZone === "hand") {
      nextPlayer.hand = [...nextPlayer.hand, sourceCardId];
    }

    if (toZone === "battle") {
      nextPlayer.battle = [...nextPlayer.battle.filter((id) => id !== sourceCardId), sourceCardId];
    }

    if (toZone === "mana") {
      nextPlayer.mana = [...nextPlayer.mana, sourceCardId];
    }

    if (toZone === "grave") {
      nextPlayer.grave = [...nextPlayer.grave, sourceCardId];
    }

    if (toZone === "shield") {
      nextPlayer.shields = [...nextPlayer.shields, [sourceCardId]];
    }

    const nextStacks = { ...roomState!.stacks };

    if (remainingStack.length >= 2) {
      nextStacks[stackId] = remainingStack;
    } else {
      delete nextStacks[stackId];
    }

    rememberUndoSnapshot({
      eventType: "move_evolution_source",
      message: `進化元を${zoneLabel(toZone)}へ移動`
    });

    const nextState: RoomState = {
      ...roomState!,
      players: {
        ...roomState!.players,
        [myRole]: nextPlayer
      },
      cardInstances: nextCardInstances,
      stacks: nextStacks
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("進化元の移動に失敗しました。");
      return;
    }

    await saveOperationLog({
      eventType: "move_evolution_source",
      message: `${actorDisplayName(myProfile)}が進化元を${zoneLabel(toZone)}へ移動しました。`,
      payload: {
        sourceCardInstanceId: sourceCardId,
        stackId,
        toZone
      }
    });

    setRoomState(nextState);
    setMessage(`進化元を${zoneLabel(toZone)}へ移動しました。`);
  }


  async function moveCardToDeck(
    cardId: string,
    mode: "top" | "bottom" | "shuffle"
  ) {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room || !roomState) return;

    const card = roomState!.cardInstances[cardId];

    if (!card) {
      setMessage("カードが見つかりません。");
      return;
    }

    if (card.owner !== myRole) {
      setMessage("自分のカードのみ操作できます。");
      return;
    }

    const movingIds = getStackCardIdsForMove(roomState!, cardId);
    const movingCards = movingIds
      .map((id) => roomState!.cardInstances[id])
      .filter((movingCard): movingCard is NonNullable<typeof movingCard> =>
        Boolean(movingCard)
      );

    if (movingCards.length !== movingIds.length) {
      setMessage("重なっているカードの一部が見つかりません。");
      return;
    }

    const fromZone = card.zone;
    const player = roomState!.players[card.owner];
    const movingSet = new Set(movingIds);

    const removeFrom = (list: string[]) => list.filter((id) => !movingSet.has(id));
    const deckWithoutMovingCards = removeFrom(player.deckOrder);

    const nextDeckOrder =
      mode === "top"
        ? [...movingIds, ...deckWithoutMovingCards]
        : mode === "bottom"
          ? [...deckWithoutMovingCards, ...movingIds]
          : shuffleArray([...movingIds, ...deckWithoutMovingCards]);

    const nextPlayer = {
      ...player,
      deckOrder: nextDeckOrder,
      hand: removeFrom(player.hand),
      battle: removeFrom(player.battle),
      mana: removeFrom(player.mana),
      grave: removeFrom(player.grave),
      shields:
        fromZone === "shield"
          ? removeCardsFromShieldStacks(player.shields, movingIds)
          : player.shields
    };

    const nextCardInstances = { ...roomState!.cardInstances };

    movingIds.forEach((movingId) => {
      const movingCard = nextCardInstances[movingId];
      if (!movingCard) return;

      nextCardInstances[movingId] = {
        ...movingCard,
        zone: "deck",
        faceUp: false,
        tapped: false,
        reversed: false,
        stackId: null
      };
    });

    const nextStacks = cleanStacksAfterMovingCards(
      roomState!,
      nextCardInstances,
      movingIds
    );

    const nextState: RoomState = {
      ...roomState!,
      players: {
        ...roomState!.players,
        [card.owner]: nextPlayer
      },
      cardInstances: nextCardInstances,
      stacks: nextStacks
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("山札への移動に失敗しました。");
      return;
    }

    const modeLabel =
      mode === "top"
        ? "山札の上へ戻しました"
        : mode === "bottom"
          ? "山札の下へ戻しました"
          : "山札に戻してシャッフルしました";

    const logCardName =
      movingIds.length > 1
        ? `重なっているカード${movingIds.length}枚`
        : shouldHideCardName(fromZone)
          ? "カード"
          : `「${card.name}」`;

    await saveOperationLog({
      eventType:
        mode === "shuffle"
          ? "return_to_deck_and_shuffle"
          : movingIds.length > 1
            ? "return_stack_to_deck"
            : "return_to_deck",
      message: `${actorDisplayName(myProfile)}が${logCardName}を${modeLabel}。`,
      payload: {
        cardInstanceId: cardId,
        cardInstanceIds: movingIds,
        cardName: shouldHideCardName(fromZone) ? null : card.name,
        cardNames: shouldHideCardName(fromZone)
          ? null
          : movingCards.map((movingCard) => movingCard.name),
        fromZone,
        mode,
        movedAsStack: movingIds.length > 1
      }
    });

    setRoomState(nextState);
    setMessage(
      movingIds.length > 1
        ? `重なっているカード${movingIds.length}枚を${modeLabel}。移動後は別々のカードとして扱います。`
        : `${card.name} を${modeLabel}。`
    );
  }

  async function setDeckVisibilityStatus(
    player: PlayerSide,
    status: DeckVisibility
  ) {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room || !roomState || !myProfile) return;

    if (myRole !== player) {
      setMessage("自分の山札のみ状態を変更できます。");
      return;
    }

    const currentState = roomState as ExtendedRoomState;
    const normalizedStatus: DeckVisibility = status === "public" ? "public" : "private";
    const currentStatus = getDeckVisibility(currentState, player);

    if (currentStatus === normalizedStatus) {
      setMessage(`山札はすでに${deckVisibilityLabel(normalizedStatus)}状態です。`);
      return;
    }

    const nextState: ExtendedRoomState = {
      ...currentState,
      roomId: currentState.roomId,
      deckVisibility: {
        ...(currentState.deckVisibility ?? {}),
        [player]: normalizedStatus
      }
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("山札状態の変更に失敗しました。");
      return;
    }

    await saveOperationLog({
      eventType: "deck_visibility",
      message: `${actorDisplayName(myProfile)}が山札を${deckVisibilityLabel(
        normalizedStatus
      )}状態にしました。`,
      payload: {
        player,
        status: normalizedStatus
      }
    });

    setRoomState(nextState);
    clearUndoSnapshot({
      reason: `山札を${deckVisibilityLabel(normalizedStatus)}状態にしました。`
    });
  }

  async function startCheckingStatus(
    player: PlayerSide,
    mode: "checking" | "public_checking"
  ) {
    if (!room || !roomState || myRole !== player) return;

    const currentState = roomState as ExtendedRoomState;
    const nextState: ExtendedRoomState = {
      ...currentState,
      roomId: currentState.roomId,
      checkingStatus: {
        player,
        mode,
        startedAt: new Date().toISOString()
      }
    };

    const error = await persistRoomState(nextState, { operationCount: 0 });

    if (error) {
      console.error("確認中状態の保存エラー:", error);
      return;
    }

    setRoomState(nextState);
  }

  async function clearCheckingStatus(player: PlayerSide) {
    if (!room || !roomState || myRole !== player) return;

    const currentState = roomState as ExtendedRoomState;

    if (currentState.checkingStatus?.player !== player) return;

    const nextState: ExtendedRoomState = {
      ...currentState,
      roomId: currentState.roomId,
      checkingStatus: null
    };

    const error = await persistRoomState(nextState, { operationCount: 0 });

    if (error) {
      console.error("確認中状態の解除エラー:", error);
      return;
    }

    setRoomState(nextState);
  }

  async function shuffleDeck(player: PlayerSide) {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room || !roomState) return;

    if (myRole !== player) {
      setMessage("自分の山札のみ操作できます。");
      return;
    }

    clearUndoSnapshot();

    const nextState: RoomState = {
      ...roomState!,
      players: {
        ...roomState!.players,
        [player]: {
          ...roomState!.players[player],
          deckOrder: shuffleArray(roomState!.players[player].deckOrder)
        }
      }
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("シャッフルに失敗しました。");
      return;
    }

    await saveOperationLog({
      eventType: "shuffle_deck",
      message: `${actorDisplayName(myProfile)}が山札をシャッフルしました。`,
      payload: {
        player
      }
    });

    setRoomState(nextState);
    setMessage("山札をシャッフルしました。");
  }

  async function peekDeck(
    player: PlayerSide,
    direction: "top" | "bottom",
    count: number
  ) {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room || !roomState) return;

    if (myRole !== player) {
      setMessage("自分の山札のみ確認できます。");
      return;
    }

    const deckOrder = roomState!.players[player].deckOrder;
    const safeCount = Math.max(1, Math.min(count, deckOrder.length));

    if (safeCount <= 0) {
      setMessage("山札がありません。");
      return;
    }

    await saveOperationLog({
      eventType: "deck_check",
      message: `${actorDisplayName(myProfile)}が確認中です。`,
      payload: {
        player,
        direction,
        count: safeCount
      }
    });

    setMessage("山札を確認しました。");
  }

  async function moveSelectedDeckCardToZone(params: {
    player: PlayerSide;
    cardActions: Record<string, Zone | "keep">;
    checkedCount: number;
    publicCheck: boolean;
    remainingAction: "keep" | "bottom" | "shuffle" | "order_top" | "order_bottom";
    orderedRemainingIds?: string[];
  }) {
    if (!room || !roomState) return;

    const {
      player,
      cardActions,
      checkedCount,
      publicCheck,
      remainingAction,
      orderedRemainingIds
    } = params;

    if (myRole !== player) {
      setMessage("自分の山札のみ操作できます。");
      return;
    }

    const board = roomState.players[player];
    const checkedIds = board.deckOrder.slice(0, checkedCount);
    const uncheckedIds = board.deckOrder.slice(checkedCount);
    const actionEntries = checkedIds.map((cardId) => ({
      cardId,
      action: cardActions[cardId] ?? "keep"
    }));

    const movedEntries = actionEntries.filter((entry) => entry.action !== "keep");
    const remainingCheckedIds = actionEntries
      .filter((entry) => entry.action === "keep")
      .map((entry) => entry.cardId);

    if (actionEntries.some((entry) => !board.deckOrder.includes(entry.cardId))) {
      setMessage("確認範囲のカードが山札にありません。");
      return;
    }

    let nextDeckOrder: string[];

    if (remainingAction === "bottom") {
      nextDeckOrder = [...uncheckedIds, ...remainingCheckedIds];
    } else if (remainingAction === "shuffle") {
      nextDeckOrder = shuffleArray([...remainingCheckedIds, ...uncheckedIds]);
    } else if (remainingAction === "order_top") {
      nextDeckOrder = [...(orderedRemainingIds ?? remainingCheckedIds), ...uncheckedIds];
    } else if (remainingAction === "order_bottom") {
      nextDeckOrder = [...uncheckedIds, ...(orderedRemainingIds ?? remainingCheckedIds)];
    } else {
      nextDeckOrder = [...remainingCheckedIds, ...uncheckedIds];
    }

    const moveIdsByZone: Record<Zone, string[]> = {
      deck: [],
      hand: [],
      battle: [],
      mana: [],
      grave: [],
      shield: []
    };

    movedEntries.forEach(({ cardId, action }) => {
      if (action === "keep") return;
      moveIdsByZone[action].push(cardId);
    });

    const nextPlayer = {
      ...board,
      deckOrder: nextDeckOrder,
      hand: [...board.hand, ...moveIdsByZone.hand],
      battle: [...board.battle, ...moveIdsByZone.battle],
      mana: [...board.mana, ...moveIdsByZone.mana],
      grave: [...board.grave, ...moveIdsByZone.grave],
      shields: [
        ...board.shields,
        ...moveIdsByZone.shield.map((id) => [id])
      ]
    };

    const nextCardInstances = { ...roomState.cardInstances };

    movedEntries.forEach(({ cardId, action }) => {
      if (action === "keep") return;

      const card = roomState.cardInstances[cardId];

      if (!card) return;

      nextCardInstances[cardId] = {
        ...card,
        zone: action,
        faceUp: action === "mana" || action === "battle" || action === "grave",
        tapped: false,
        reversed: false
      };
    });

    clearUndoSnapshot();

    const nextState: RoomState = {
      ...roomState,
      players: {
        ...roomState.players,
        [player]: nextPlayer
      },
      cardInstances: nextCardInstances
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("山札から選択したカードの移動に失敗しました。");
      return;
    }

    const remainingActionLabel =
      remainingAction === "bottom"
        ? "残りを山札の下へ送りました"
        : remainingAction === "shuffle"
          ? "山札をシャッフルしました"
          : remainingAction === "order_top"
            ? "残りを指定順で山札の上に戻しました"
            : remainingAction === "order_bottom"
              ? "残りを指定順で山札の下へ送りました"
              : "残りをそのまま戻しました";

    const movedSummary = (["hand", "battle", "mana", "grave", "shield"] as Zone[])
      .map((zone) => {
        const count = moveIdsByZone[zone].length;
        return count > 0 ? `${zoneLabel(zone)}${count}枚` : null;
      })
      .filter(Boolean)
      .join("、");

    await saveOperationLog({
      eventType: publicCheck ? "deck_public_select" : "deck_select",
      message: publicCheck
        ? `${actorDisplayName(myProfile)}が山札の上から${checkedCount}枚を公開確認し、${movedSummary || "カード移動なし"}を行いました。${remainingActionLabel}。`
        : `${actorDisplayName(myProfile)}が山札の上から${checkedCount}枚を確認し、${movedSummary || "カード移動なし"}を行いました。${remainingActionLabel}。`,
      payload: {
        player,
        cardActions,
        movedCardInstanceIds: movedEntries.map((entry) => entry.cardId),
        movedPublicCardNames: publicCheck
          ? movedEntries.map((entry) => roomState.cardInstances[entry.cardId]?.name ?? null)
          : null,
        checkedCount,
        publicCheck,
        remainingAction
      }
    });

    setRoomState(nextState);
    setMessage(
      publicCheck
        ? `公開確認したカードを指定通りに移動しました。${remainingActionLabel}。`
        : `確認したカードを指定通りに移動しました。${remainingActionLabel}。`
    );
  }

  async function reorderCheckedDeckCards(params: {
    player: PlayerSide;
    checkedIds: string[];
    orderedIds: string[];
    destination: "top" | "bottom";
    publicCheck: boolean;
  }) {
    if (!room || !roomState) return;

    const { player, checkedIds, orderedIds, destination, publicCheck } = params;

    if (myRole !== player) {
      setMessage("自分の山札のみ操作できます。");
      return;
    }

    if (checkedIds.length === 0) {
      setMessage("順番変更するカードがありません。");
      return;
    }

    const checkedSet = new Set(checkedIds);
    const isValidOrder =
      orderedIds.length === checkedIds.length &&
      orderedIds.every((id) => checkedSet.has(id)) &&
      new Set(orderedIds).size === checkedIds.length;

    if (!isValidOrder) {
      setMessage("順番指定が正しくありません。");
      return;
    }

    const board = roomState.players[player];
    const restDeckOrder = board.deckOrder.filter((id) => !checkedSet.has(id));
    const nextDeckOrder =
      destination === "top"
        ? [...orderedIds, ...restDeckOrder]
        : [...restDeckOrder, ...orderedIds];

    clearUndoSnapshot();

    const nextState: RoomState = {
      ...roomState,
      players: {
        ...roomState.players,
        [player]: {
          ...board,
          deckOrder: nextDeckOrder
        }
      }
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("山札確認後の順番変更に失敗しました。");
      return;
    }

    await saveOperationLog({
      eventType: publicCheck ? "deck_public_order" : "deck_order",
      message: publicCheck
        ? `${actorDisplayName(myProfile)}が山札を公開確認し、確認した${checkedIds.length}枚を指定順で山札${
            destination === "top" ? "上" : "下"
          }へ戻しました。`
        : `${actorDisplayName(myProfile)}が山札を確認し、確認した${checkedIds.length}枚を指定順で山札${
            destination === "top" ? "上" : "下"
          }へ戻しました。`,
      payload: {
        player,
        count: checkedIds.length,
        publicCheck,
        destination,
        orderedCardInstanceIds: orderedIds
      }
    });

    setRoomState(nextState);
    setMessage(
      `確認した${checkedIds.length}枚を指定順で山札${
        destination === "top" ? "上" : "下"
      }へ戻しました。`
    );
  }

async function inspectDeckAndSelect(
  player: PlayerSide,
  count: number,
  publicCheck: boolean
) {
  if (!room || !roomState) return;

  if (myRole !== player) {
    setMessage("自分の山札のみ確認できます。");
    return;
  }

  const board = roomState!.players[player];
  const safeCount = Math.max(1, Math.min(count, board.deckOrder.length));

  if (safeCount <= 0) {
    setMessage("山札がありません。");
    return;
  }

  const targetIds = board.deckOrder.slice(0, safeCount);

  const listText = targetIds
    .map((id, index) => {
      const card = roomState!.cardInstances[id];
      return `${index + 1}. ${card?.name ?? "不明なカード"}`;
    })
    .join("\n");

  const selectedRaw = window.prompt(
    `${publicCheck ? "山札公開確認" : "山札確認"}：上から${safeCount}枚\n\n${listText}\n\n移動するカード番号を入力してください。\n何も移動しない場合は空欄のままOKを押してください。`,
    ""
  );

  if (selectedRaw === null) {
    setMessage("山札確認をキャンセルしました。");
    return;
  }

  if (selectedRaw.trim() === "") {
    const orderChoice = window.prompt(
      [
        publicCheck ? "山札公開確認を終了します。" : "山札確認を終了します。",
        "",
        "確認したカードの順番を変更しますか？",
        "",
        "1：順番変更せずに終了",
        "2：順番を指定して山札の上へ戻す",
        "3：順番を指定して山札の下へ送る"
      ].join(String.fromCharCode(10)),
      "1"
    );

    if (orderChoice === null) {
      setMessage("山札確認をキャンセルしました。");
      return;
    }

    if (orderChoice === "2" || orderChoice === "3") {
      const orderListText = targetIds
        .map((id, index) => {
          const card = roomState.cardInstances[id];
          return `${index + 1}. ${card?.name ?? "不明なカード"}`;
        })
        .join(String.fromCharCode(10));

      const orderRaw = window.prompt(
        [
          "確認したカードの順番を指定してください。",
          "",
          orderListText,
          "",
          "例：3,1,2",
          "※左から順に戻します。"
        ].join(String.fromCharCode(10)),
        targetIds.map((_, index) => String(index + 1)).join(",")
      );

      if (orderRaw === null) {
        setMessage("順番指定をキャンセルしました。");
        return;
      }

      const orderIndexes = orderRaw
        .split(",")
        .map((value) => Number.parseInt(value.trim(), 10) - 1);

      const isValidOrder =
        orderIndexes.length === targetIds.length &&
        orderIndexes.every(
          (index) => Number.isInteger(index) && index >= 0 && index < targetIds.length
        ) &&
        new Set(orderIndexes).size === targetIds.length;

      if (!isValidOrder) {
        setMessage("順番指定が正しくありません。例：3,1,2 の形式で入力してください。");
        return;
      }

      await reorderCheckedDeckCards({
        player,
        checkedIds: targetIds,
        orderedIds: orderIndexes.map((index) => targetIds[index]),
        destination: orderChoice === "2" ? "top" : "bottom",
        publicCheck
      });
      return;
    }

    if (orderChoice !== "1") {
      setMessage("1、2、3 のいずれかを入力してください。");
      return;
    }

    await saveOperationLog({
      eventType: publicCheck ? "deck_public_check" : "deck_check",
      message: publicCheck
        ? `${actorDisplayName(myProfile)}が山札の上から${safeCount}枚を公開確認しました。`
        : `${actorDisplayName(myProfile)}が確認中です。`,
      payload: {
        player,
        count: safeCount,
        publicCheck
      }
    });

    setMessage(
      publicCheck
        ? `山札の上から${safeCount}枚を公開確認しました。`
        : `山札の上から${safeCount}枚を確認しました。`
    );
    return;
  }

  const selectedIndex = Number.parseInt(selectedRaw, 10) - 1;

  if (
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= targetIds.length
  ) {
    setMessage("有効なカード番号を入力してください。");
    return;
  }

  const selectedCardId = targetIds[selectedIndex];
  const toZone = askZoneForSelectedDeckCard();

  if (!toZone) {
    setMessage("移動先の選択をキャンセルしました。");
    return;
  }

  const remainingCheckedIds = targetIds.filter((id) => id !== selectedCardId);

  const lineBreak = String.fromCharCode(10);

  const remainingRaw = window.prompt(
    [
      "選ばなかった確認カードをどうしますか？",
      "",
      "1：そのまま山札の上に戻す",
      "2：山札の下へ送る",
      "3：山札をシャッフルする",
      "4：順番を指定して山札の上に戻す",
      "5：順番を指定して山札の下へ送る"
    ].join(lineBreak),
    "1"
  );

  if (remainingRaw === null) {
    setMessage("残りカードの処理をキャンセルしました。");
    return;
  }

  let remainingAction: "keep" | "bottom" | "shuffle" | "order_top" | "order_bottom";
  let orderedRemainingIds: string[] | undefined;

  if (remainingRaw === "1") {
    remainingAction = "keep";
  } else if (remainingRaw === "2") {
    remainingAction = "bottom";
  } else if (remainingRaw === "3") {
    remainingAction = "shuffle";
  } else if (remainingRaw === "4" || remainingRaw === "5") {
    remainingAction = remainingRaw === "4" ? "order_top" : "order_bottom";

    if (remainingCheckedIds.length > 1) {
      const remainingListText = remainingCheckedIds
        .map((id, index) => {
          const card = roomState!.cardInstances[id];
          return `${index + 1}. ${card?.name ?? "不明なカード"}`;
        })
        .join(lineBreak);

      const orderRaw = window.prompt(
        [
          "残りカードの順番を指定してください。",
          "",
          remainingListText,
          "",
          "例：3,1,2",
          "※左から順に戻します。"
        ].join(lineBreak),
        remainingCheckedIds.map((_, index) => String(index + 1)).join(",")
      );

      if (orderRaw === null) {
        setMessage("順番指定をキャンセルしました。");
        return;
      }

      const orderIndexes = orderRaw
        .split(",")
        .map((value) => Number.parseInt(value.trim(), 10) - 1);

      const isValidOrder =
        orderIndexes.length === remainingCheckedIds.length &&
        orderIndexes.every(
          (index) =>
            Number.isInteger(index) &&
            index >= 0 &&
            index < remainingCheckedIds.length
        ) &&
        new Set(orderIndexes).size === remainingCheckedIds.length;

      if (!isValidOrder) {
        setMessage("順番指定が正しくありません。例：3,1,2 の形式で入力してください。");
        return;
      }

      orderedRemainingIds = orderIndexes.map((index) => remainingCheckedIds[index]);
    } else {
      orderedRemainingIds = remainingCheckedIds;
    }
  } else {
    setMessage("1、2、3、4、5 のいずれかを入力してください。");
    return;
  }

  await moveSelectedDeckCardToZone({
    player,
    cardActions: {
      [selectedCardId]: toZone
    },
    checkedCount: safeCount,
    publicCheck,
    remainingAction,
    orderedRemainingIds
  });
}  

  async function inspectDeckSelectModal(params: {
    player: PlayerSide;
    count: number;
    publicCheck: boolean;
    cardActions: Record<string, Zone | "keep">;
    remainingAction: "keep" | "bottom" | "shuffle" | "order_top" | "order_bottom";
    orderedRemainingIds?: string[];
  }) {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room || !roomState) return;

    const {
      player,
      count,
      publicCheck,
      cardActions,
      remainingAction,
      orderedRemainingIds
    } = params;

    if (myRole !== player) {
      setMessage("自分の山札のみ確認できます。");
      return;
    }

    const board = roomState.players[player];
    const safeCount = Math.max(1, Math.min(count, board.deckOrder.length));
    const checkedIds = board.deckOrder.slice(0, safeCount);
    const checkedSet = new Set(checkedIds);
    const actionCardIds = Object.keys(cardActions).filter((cardId) =>
      checkedSet.has(cardId)
    );

    if (actionCardIds.length === 0) {
      setMessage("確認範囲のカードがありません。");
      return;
    }

    const remainingCheckedIds = checkedIds.filter(
      (cardId) => (cardActions[cardId] ?? "keep") === "keep"
    );

    if (
      (remainingAction === "order_top" || remainingAction === "order_bottom") &&
      remainingCheckedIds.length > 1
    ) {
      const orderIds = orderedRemainingIds ?? [];
      const isValidOrder =
        orderIds.length === remainingCheckedIds.length &&
        orderIds.every((id) => remainingCheckedIds.includes(id)) &&
        new Set(orderIds).size === remainingCheckedIds.length;

      if (!isValidOrder) {
        setMessage("残りカードの順番指定が正しくありません。");
        return;
      }
    }

    await moveSelectedDeckCardToZone({
      player,
      cardActions,
      checkedCount: safeCount,
      publicCheck,
      remainingAction,
      orderedRemainingIds
    });
  }

  async function inspectMultipleDeck(player: PlayerSide, count: number) {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    await inspectDeckAndSelect(player, count, false);
  }

  async function inspectPublicDeck(player: PlayerSide, count: number) {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    await inspectDeckAndSelect(player, count, true);
  }

  async function moveDeckCardsToZone(
    player: PlayerSide,
    toZone: Zone,
    count: number
  ) {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room || !roomState) return;

    if (myRole !== player) {
      setMessage("自分の山札のみ操作できます。");
      return;
    }

    const board = roomState!.players[player];
    const safeCount = Math.max(1, Math.min(count, board.deckOrder.length));

    if (safeCount <= 0) {
      setMessage("山札がありません。");
      return;
    }

    const movingIds = board.deckOrder.slice(0, safeCount);
    const nextDeckOrder = board.deckOrder.slice(safeCount);

    const nextPlayer = {
      ...board,
      deckOrder: nextDeckOrder,
      hand: toZone === "hand" ? [...board.hand, ...movingIds] : board.hand,
      battle: toZone === "battle" ? [...board.battle, ...movingIds] : board.battle,
      mana: toZone === "mana" ? [...board.mana, ...movingIds] : board.mana,
      grave: toZone === "grave" ? [...board.grave, ...movingIds] : board.grave,
      shields:
        toZone === "shield"
          ? [...board.shields, ...movingIds.map((id) => [id])]
          : board.shields
    };

    const nextCardInstances = { ...roomState!.cardInstances };

    movingIds.forEach((cardId) => {
      const card = nextCardInstances[cardId];
      if (!card) return;

      nextCardInstances[cardId] = {
        ...card,
        zone: toZone,
        faceUp: toZone === "mana" || toZone === "battle" || toZone === "grave",
        tapped: false,
        reversed: false
      };
    });

    clearUndoSnapshot();

    const nextState: RoomState = {
      ...roomState!,
      players: {
        ...roomState!.players,
        [player]: nextPlayer
      },
      cardInstances: nextCardInstances
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("山札からの移動に失敗しました。");
      return;
    }

    await saveOperationLog({
      eventType: "move_from_deck",
      message: `${actorDisplayName(myProfile)}が山札の上から${safeCount}枚を${zoneLabel(
        toZone
      )}へ移動しました。`,
      payload: {
        player,
        toZone,
        count: safeCount
      }
    });

    setRoomState(nextState);
    setMessage(`山札の上から${safeCount}枚を${zoneLabel(toZone)}へ移動しました。`);
  }

  async function sendDeckTopToBottom(player: PlayerSide, count: number) {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room || !roomState) return;

    if (myRole !== player) {
      setMessage("自分の山札のみ操作できます。");
      return;
    }

    const board = roomState!.players[player];
    const safeCount = Math.max(1, Math.min(count, board.deckOrder.length));

    if (safeCount <= 0) {
      setMessage("山札がありません。");
      return;
    }

    const movingIds = board.deckOrder.slice(0, safeCount);
    const rest = board.deckOrder.slice(safeCount);

    clearUndoSnapshot();

    const nextState: RoomState = {
      ...roomState!,
      players: {
        ...roomState!.players,
        [player]: {
          ...board,
          deckOrder: [...rest, ...movingIds]
        }
      }
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("山札下への移動に失敗しました。");
      return;
    }

    await saveOperationLog({
      eventType: "deck_order",
      message: `${actorDisplayName(myProfile)}が山札の上から${safeCount}枚を山札の下へ送りました。`,
      payload: {
        player,
        count: safeCount
      }
    });

    setRoomState(nextState);
    setMessage(`山札の上から${safeCount}枚を山札の下へ送りました。`);
  }

  async function breakShield(
    cardId: string,
    choice: "return" | "hand" | "battle"
  ) {
    if (isStaleClient) {
      setMessage("別端末で開かれたため、この画面では操作できません。");
      return;
    }

    if (!room || !roomState) return;

    const card = roomState!.cardInstances[cardId];

    if (!card) {
      setMessage("シールドが見つかりません。");
      return;
    }

    if (card.owner !== myRole) {
      setMessage("自分のシールドのみ操作できます。");
      return;
    }

    if (card.zone !== "shield") {
      setMessage("このカードはシールドではありません。");
      return;
    }

    const player = roomState!.players[card.owner];

    if (choice === "return") {
      await saveOperationLog({
        eventType: "shield_break_check",
        message: `${actorDisplayName(myProfile)}がシールドを確認し、そのまま戻しました。`,
        payload: {
          cardInstanceId: cardId,
          cardName: null,
          checked: true,
          returned: true
        }
      });

      setMessage(`${card.name} をシールドに戻しました。`);
      return;
    }

    const toZone: Zone = choice === "battle" ? "battle" : "hand";

    const nextPlayer = {
      ...player,
      shields: removeCardFromShieldStacks(player.shields, cardId),
      hand: choice === "hand" ? [...player.hand, cardId] : player.hand,
      battle: choice === "battle" ? [...player.battle, cardId] : player.battle
    };

    const nextState: RoomState = {
      ...roomState!,
      players: {
        ...roomState!.players,
        [card.owner]: nextPlayer
      },
      cardInstances: {
        ...roomState!.cardInstances,
        [cardId]: {
          ...card,
          zone: toZone,
          faceUp: choice === "battle",
          tapped: false,
          reversed: false,
          stackId: null
        }
      }
    };

    const error = await persistRoomState(nextState, { operationCount: 1 });

    if (error) {
      console.error(error);
      setMessage("シールドブレイク処理に失敗しました。");
      return;
    }

    await saveOperationLog({
      eventType: "shield_break",
      message:
        choice === "battle"
          ? `${actorDisplayName(myProfile)}がシールドを使用しました。`
          : `${actorDisplayName(myProfile)}がシールドを手札に加えました。`,
      payload: {
        cardInstanceId: cardId,
        cardName: choice === "battle" ? card.name : null,
        choice,
        toZone
      }
    });

    setRoomState(nextState);
    setMessage(
      choice === "battle"
        ? `${card.name} をバトルゾーンに出しました。`
        : `${card.name} を手札に加えました。`
    );
  }

  useEffect(() => {
    void loadRoom();
  }, [roomCode]);

  useEffect(() => {
    if (!room?.id) return;

    const channel = supabase
      .channel(`room-state-${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_state",
          filter: `room_id=eq.${room.id}`
        },
        (payload) => {
          const newRow = payload.new as Partial<RoomStateRow> | null;
          const updatedAt = toTimeValue(newRow?.updated_at);
          const operationCount = newRow?.operation_count ?? 0;

          if (
            updatedAt > 0 &&
            updatedAt < lastAcceptedRoomStateUpdatedAtRef.current &&
            operationCount <= lastAcceptedOperationCountRef.current
          ) {
            return;
          }

          const incomingState = newRow?.state_json ?? null;

          if (incomingState) {
            const normalizedIncomingState =
              normalizeRoomStateForDisplay(incomingState as RoomState) ??
              (incomingState as RoomState);

            setRoomState(normalizedIncomingState);
            lastAcceptedRoomStateUpdatedAtRef.current = Math.max(
              lastAcceptedRoomStateUpdatedAtRef.current,
              updatedAt
            );
            lastAcceptedOperationCountRef.current = Math.max(
              lastAcceptedOperationCountRef.current,
              operationCount
            );
            setLastSyncedAt(new Date().toLocaleTimeString());
            unlockBoardOperation();
            return;
          }

          scheduleRealtimeReload();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`
        },
        () => {
          scheduleRealtimeReload();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_members",
          filter: `room_id=eq.${room.id}`
        },
        () => {
          scheduleRealtimeReload();
        }
      )
      .subscribe();

    return () => {
      if (realtimeReloadTimerRef.current) {
        clearTimeout(realtimeReloadTimerRef.current);
        realtimeReloadTimerRef.current = null;
      }

      realtimeReloadQueuedRef.current = false;
      realtimeReloadInFlightRef.current = false;

      supabase.removeChannel(channel);
    };
  }, [room?.id]);


  useEffect(() => {
    if (!room || !myProfile) return;

    updateMyLastSeen();

    const intervalId = window.setInterval(() => {
      updateMyLastSeen();
    }, 15_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [room?.id, myProfile?.id, clientId]);

  useEffect(() => {
    if (!room || !myProfile) return;

    const syncAfterReturn = () => {
      if (document.visibilityState === "visible") {
        void updateMyLastSeen();
        void loadRoom({ silent: true });
      }
    };

    const syncAfterFocus = () => {
      void updateMyLastSeen();
      void loadRoom({ silent: true });
    };

    document.addEventListener("visibilitychange", syncAfterReturn);
    window.addEventListener("focus", syncAfterFocus);

    return () => {
      document.removeEventListener("visibilitychange", syncAfterReturn);
      window.removeEventListener("focus", syncAfterFocus);
    };
  }, [room?.id, myProfile?.id, clientId]);

  const player1 = members.find((member) => member.role === "player1");
  const player2 = members.find((member) => member.role === "player2");
  const spectators = members.filter((member) => member.role === "spectator");

  const spectatorNames =
    spectators.length > 0
      ? spectators
          .map((spectator) => spectator.profiles?.nickname ?? "観戦者")
          .join("、")
      : "なし";

  const player1Name = player1?.profiles?.nickname ?? (player1 ? "player1" : "未入室");
  const player2Name = player2?.profiles?.nickname ?? (player2 ? "player2" : "未入室");
  const player1DeckReady = Boolean(player1?.selected_deck_id);
  const player2DeckReady = Boolean(player2?.selected_deck_id);
  const canStartMatch =
    !isStaleClient &&
    !isBoardOperationPending &&
    room?.status === "waiting" &&
    myRole === "player1" &&
    Boolean(player1) &&
    Boolean(player2) &&
    player1DeckReady &&
    player2DeckReady;

  const startMatchHelpText = (() => {
    if (room?.status !== "waiting") return "対戦開始後は開始ボタンは表示されません。";
    if (myRole !== "player1") return "対戦開始はplayer1のみ実行できます。";
    if (!player2) return "player2の入室待ちです。";
    if (!player1DeckReady) return "player1の使用デッキが未選択です。";
    if (!player2DeckReady) return "player2の使用デッキが未選択です。";
    if (isStaleClient) return "接続状態を更新してください。";
    if (isBoardOperationPending) return "盤面操作の完了待ちです。";
    return "両者の準備が完了しています。";
  })();

  const canUseRoomActions =
    !isStaleClient &&
    (myRole === "player1" || myRole === "player2" || myRole === "spectator");

  const isPreparationBoardVisible =
    room?.status === "waiting" &&
    (myRole === "player1" || myRole === "player2");

  const isBoardReadOnly =
    isStaleClient ||
    room?.status === "finished" ||
    (room?.status === "waiting" && myRole !== "player1" && myRole !== "player2");

  if (!room && loading) {
    return (
      <main
        className="page"
        style={{
          height: "100dvh",
          maxHeight: "100dvh",
          background: "#171717",
          color: "#f2f2f2",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            position: "fixed",
            right: 16,
            top: 16,
            zIndex: 2000,
            border: "1px solid #444",
            borderRadius: 999,
            padding: "6px 12px",
            background: "rgba(17,17,17,.92)",
            color: "#cbd5e1",
            fontSize: 12
          }}
        >
          同期中…
        </div>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="page">
        <h1>ルーム</h1>
        <p className="muted">{message || "ルームが見つかりません。"}</p>
        <a href="/rooms">ルームへ戻る</a>
      </main>
    );
  }

  const shouldShowBoard =
    Boolean(roomState) &&
    (
      room?.status === "playing" ||
      room?.status === "finished" ||
      isPreparationBoardVisible
    );

  const waitingPreparationMessage =
    room.status === "waiting"
      ? "準備盤面です。player1/player2は使用デッキから自分の盤面をリセットし、自分のカードだけ操作できます。"
      : "";

  return (
    <main
      className="page"
      style={{
        height: "100dvh",
        maxHeight: "100dvh",
        padding: 0,
        paddingLeft: 240,
        background: "#171717",
        color: "#f2f2f2",
        overflow: "hidden"
      }}
    >
      {loading && (
        <div
          style={{
            position: "fixed",
            right: 16,
            top: 16,
            zIndex: 2200,
            border: "1px solid #444",
            borderRadius: 999,
            padding: "6px 12px",
            background: "rgba(17,17,17,.92)",
            color: "#cbd5e1",
            fontSize: 12
          }}
        >
          同期中…
        </div>
      )}

      <aside
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 1000,
          width: 232,
          borderRight: "1px solid #333",
          padding: 10,
          background: "rgba(24,24,24,.98)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          overflowY: "auto",
          boxShadow: "8px 0 24px rgba(0,0,0,.28)"
        }}
      >
        <section
          style={{
            border: "1px solid #444",
            borderRadius: 10,
            padding: 8,
            background: "#111",
            color: "#e5e7eb",
            fontSize: 12,
            lineHeight: 1.45,
            wordBreak: "break-all"
          }}
        >
          <strong>ルームID</strong>
          <br />
          {room.room_code}
          <br />
          <span style={{ color: "#94a3b8" }}>状態：{room.status}</span>
          <br />
          <span style={{ color: "#94a3b8" }}>あなた：{myRole ?? "未参加"}</span>
        </section>

        {room.status === "waiting" && (myRole === "player1" || myRole === "player2") && (
          <section
            style={{
              border: "1px solid #2563eb",
              borderRadius: 10,
              padding: 8,
              background: "rgba(37, 99, 235, 0.12)",
              color: "#bfdbfe",
              fontSize: 12,
              lineHeight: 1.55
            }}
          >
            準備盤面です。
            <br />
            player1/player2は使用デッキから自分の盤面をリセットできます。
          </section>
        )}

        <section
          style={{
            border: "1px solid #444",
            borderRadius: 10,
            padding: 8,
            background: "#111",
            color: "#e5e7eb",
            display: "grid",
            gap: 6,
            fontSize: 12
          }}
        >
          <strong>入室状況</strong>
          <div style={{ display: "grid", gap: 4 }}>
            <span>player1：{player1Name} {player1 ? "🟢" : "⚪"}</span>
            <span style={{ color: player1DeckReady ? "#86efac" : "#fca5a5" }}>
              デッキ：{player1DeckReady ? "選択済み" : "未選択"}
            </span>
            <span>player2：{player2Name} {player2 ? "🟢" : "⚪"}</span>
            <span style={{ color: player2 ? player2DeckReady ? "#86efac" : "#fca5a5" : "#94a3b8" }}>
              デッキ：{player2 ? player2DeckReady ? "選択済み" : "未選択" : "未入室"}
            </span>
          </div>
          {room.status === "waiting" && myRole === "player1" && (
            <button
              type="button"
              onClick={startMatch}
              disabled={!canStartMatch || starting}
              style={{
                borderColor: canStartMatch ? "#22c55e" : "#444",
                background: canStartMatch ? "#14532d" : "#202020",
                color: canStartMatch ? "#bbf7d0" : "#cbd5e1",
                fontWeight: 800
              }}
            >
              {starting ? "開始中..." : "対戦開始"}
            </button>
          )}
          <span style={{ color: "#94a3b8" }}>{startMatchHelpText}</span>
        </section>

        <button
          type="button"
          onClick={() =>
            setActiveLeftPopup((current) =>
              current === "participants" ? null : "participants"
            )
          }
        >
          参加者
        </button>

        {(myRole === "player1" || myRole === "player2") && room.status === "waiting" && (
          <button
            type="button"
            onClick={() =>
              setActiveLeftPopup((current) =>
                current === "deck" ? null : "deck"
              )
            }
          >
            使用デッキ
          </button>
        )}

        {room.status === "waiting" && myRole === "player1" && (
          <button
            type="button"
            onClick={() =>
              setActiveLeftPopup((current) =>
                current === "start" ? null : "start"
              )
            }
          >
            対戦開始
          </button>
        )}

        {room.status === "playing" && (myRole === "player1" || myRole === "player2") && (
          <button type="button" onClick={finishMatch} disabled={isStaleClient || isBoardOperationPending}>
            対戦終了
          </button>
        )}

        {canUseRoomActions && (
          <button type="button" onClick={leaveRoom} disabled={isStaleClient || isBoardOperationPending}>
            退出
          </button>
        )}


        <section
          style={{
            border: "1px solid #444",
            borderRadius: 10,
            padding: 8,
            background: "#1f1f1f",
            display: "grid",
            gap: 6,
            fontSize: 12
          }}
        >
          <strong>復旧</strong>
          <button type="button" onClick={() => void reloadRoomFromServer()}>
            盤面を再読み込み
          </button>
          <button type="button" onClick={() => void refreshMyConnectionStatus()}>
            接続状態を更新
          </button>
          {isBoardOperationPending && (
            <span style={{ color: "#facc15" }}>操作処理中...</span>
          )}
          {lastSyncedAt && (
            <span style={{ color: "#94a3b8" }}>最終同期：{lastSyncedAt}</span>
          )}
          {connectionMessage && (
            <span style={{ color: "#bfdbfe" }}>{connectionMessage}</span>
          )}
        </section>

        {(myRole === "player1" || room.owner_id === myProfile?.id) && (
          <button
            type="button"
            onClick={dissolveRoom}
            disabled={isStaleClient || isBoardOperationPending}
            style={{
              marginTop: "auto",
              borderColor: "#7f1d1d",
              background: "#3f1111",
              color: "#fecaca",
              fontWeight: 700
            }}
          >
            部屋を解散
          </button>
        )}

        <style>{`
          aside button,
          aside a,
          aside select {
            border: 1px solid #444;
            border-radius: 8px;
            padding: 7px 6px;
            background: #202020;
            color: #f8fafc;
            cursor: pointer;
            text-decoration: none;
            font-size: 12px;
            line-height: 1.2;
          }
          aside button:hover,
          aside a:hover {
            background: #303030;
          }
          aside button:disabled {
            opacity: .5;
            cursor: not-allowed;
          }
        `}</style>
      </aside>
        {activeLeftPopup && (
        <section
          style={{
            position: "fixed",
            left: 236,
            top: 12,
            zIndex: 1200,
            width: 340,
            maxHeight: "calc(100vh - 24px)",
            overflowY: "auto",
            border: "1px solid #4b5563",
            borderRadius: 12,
            padding: 12,
            background: "rgba(24, 24, 24, 0.98)",
            boxShadow: "0 18px 48px rgba(0,0,0,.45)",
            color: "#f8fafc",
            display: "grid",
            gap: 10
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8
            }}
          >
            <strong>
              {activeLeftPopup === "participants"
                ? "参加者"
                : activeLeftPopup === "deck"
                  ? "使用デッキ"
                  : "対戦開始"}
            </strong>

            <button type="button" onClick={() => setActiveLeftPopup(null)}>
              閉じる
            </button>
          </div>

          {activeLeftPopup === "participants" && (
            <section style={{ display: "grid", gap: 7, fontSize: 13 }}>
              <div>player1：{player1Name} {player1 ? "🟢入室中" : "⚪未入室"}</div>
              <div>デッキ：{player1DeckReady ? "選択済み" : "未選択"}</div>
              <hr style={{ width: "100%", borderColor: "#333" }} />
              <div>player2：{player2Name} {player2 ? "🟢入室中" : "⚪未入室"}</div>
              <div>
                デッキ：{player2 ? player2DeckReady ? "選択済み" : "未選択" : "未入室"}
              </div>
              <hr style={{ width: "100%", borderColor: "#333" }} />
              <div>観戦者：{spectators.length} / 3</div>
              <div style={{ color: "#94a3b8" }}>{spectatorNames}</div>
            </section>
          )}

          {activeLeftPopup === "deck" && (
            <section style={{ display: "grid", gap: 8, fontSize: 13 }}>
              <select
                value={selectedDeckId}
                onChange={(event) => setSelectedDeckId(event.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">デッキを選択</option>
                {savedDecks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>

              <button type="button" onClick={saveSelectedDeck} disabled={savingDeck || isBoardOperationPending}>
                {savingDeck ? "保存中..." : "このデッキを使用"}
              </button>

              {(myRole === "player1" || myRole === "player2") && selectedDeckId && room.status === "waiting" && (
                <button
                  type="button"
                  onClick={() => {
                    void createOrUpdatePreparationBoard(selectedDeckId);
                  }}
                  disabled={isBoardOperationPending}
                >
                  自分の盤面をリセット
                </button>
              )}
            </section>
          )}

          {activeLeftPopup === "start" && (
            <section style={{ display: "grid", gap: 8, fontSize: 13 }}>
              <div>player1：{player1Name} {player1DeckReady ? "✅" : "未選択"}</div>
              <div>player2：{player2Name} {player2 ? player2DeckReady ? "✅" : "未選択" : "未入室"}</div>
              <p style={{ margin: 0, color: canStartMatch ? "#86efac" : "#fca5a5" }}>
                {startMatchHelpText}
              </p>
              <button
                type="button"
                onClick={startMatch}
                disabled={!canStartMatch || starting}
                style={{
                  borderColor: canStartMatch ? "#22c55e" : "#444",
                  background: canStartMatch ? "#14532d" : "#202020",
                  color: canStartMatch ? "#bbf7d0" : "#cbd5e1",
                  fontWeight: 800
                }}
              >
                {starting ? "開始中..." : "対戦開始"}
              </button>
            </section>
          )}

          <style>{`
            section button,
            section select {
              border: 1px solid #444;
              border-radius: 8px;
              padding: 7px 8px;
              background: #202020;
              color: #f8fafc;
              cursor: pointer;
              font-size: 12px;
            }
            section button:hover {
              background: #303030;
            }
            section button:disabled {
              opacity: .5;
              cursor: not-allowed;
            }
          `}</style>
        </section>
      )}

      {message && (
        <section
          style={{
            border: "1px solid #facc15",
            borderRadius: 10,
            padding: 8,
            background: "rgba(250, 204, 21, 0.12)",
            color: "#fde68a",
            margin: "8px 8px 8px 0",
            fontWeight: 700
          }}
        >
          {message}
        </section>
      )}

      {room.status === "waiting" && myRole === "player1" && !roomState && (
        <section
          style={{
            border: "1px dashed #64748b",
            borderRadius: 12,
            padding: 14,
            background: "#0f172a",
            color: "#cbd5e1"
          }}
        >
          <strong>準備盤面はまだ作成されていません。</strong>
          <p style={{ margin: "6px 0 0" }}>
            上部の「デッキ」ボタンからデッキを選び、「準備盤面を作成/更新」を押してください。
          </p>
        </section>
      )}

      {shouldShowBoard ? (
        <div style={{ display: "grid", gap: 0, height: "100%", minHeight: 0, overflow: "hidden" }}>
          <SimpleBoard
            roomState={roomState!}
            myRole={myRole}
            isInteractionDisabled={isBoardReadOnly || isBoardOperationPending}
            onDrawCard={drawCard}
            onMoveCard={moveCard}
            onBreakShield={breakShield}
            onToggleTapped={(cardId) => updateCardOrientation(cardId, "tapped")}
            onToggleReversed={(cardId) => updateCardOrientation(cardId, "reversed")}
            onToggleFaceUp={(cardId) => updateCardOrientation(cardId, "faceUp")}
            onToggleMultipleCardOrientation={updateMultipleCardOrientation}
            onMoveCardToDeckTop={(cardId) => moveCardToDeck(cardId, "top")}
            onMoveCardToDeckBottom={(cardId) => moveCardToDeck(cardId, "bottom")}
            onMoveCardToDeckAndShuffle={(cardId) => moveCardToDeck(cardId, "shuffle")}
            onMoveCardToManaFaceUp={(cardId) => moveCardToManaWithFace(cardId, true)}
            onMoveCardToManaFaceDown={(cardId) => moveCardToManaWithFace(cardId, false)}
            onShuffleDeck={shuffleDeck}
            onPeekDeck={peekDeck}
            onMoveDeckCardsToZone={moveDeckCardsToZone}
            onSendDeckTopToBottom={sendDeckTopToBottom}
            onRevealCard={revealCard}
            onCancelAllRevealedCards={cancelAllRevealedCards}
            onInspectMultipleDeck={inspectMultipleDeck}
            onInspectPublicDeck={inspectPublicDeck}
            onInspectDeckSelectModal={inspectDeckSelectModal}
            onStackCardToBattle={stackCardToBattle}
            onMoveMultipleCards={moveMultipleCards}
            onSealTopCard={sealTopCard}
            onMoveTopStackCardToGrave={moveTopStackCardToGrave}
            onMoveStackSourceOnly={moveStackSourceOnly}
            onSetDeckVisibility={setDeckVisibilityStatus}
            onStartCheckingStatus={startCheckingStatus}
            onClearCheckingStatus={clearCheckingStatus}
          />
        </div>
      ) : (
        room.status !== "waiting" && <p className="muted">同期中…</p>
      )}
    </main>
  );
}