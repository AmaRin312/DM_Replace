"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type MenuKey = "w" | "a" | "s" | "d";

export type MenuAction = string;

export type MenuNode = {
  label: string;
  action?: MenuAction;
  w?: MenuNode;
  a?: MenuNode;
  s?: MenuNode;
  d?: MenuNode;
};

type RightClickMenuProps = {
  root: MenuNode;
  x: number;
  y: number;
  onClose: () => void;
  onAction: (action: MenuAction) => void;
};

const KEY_LABELS: Record<MenuKey, string> = {
  w: "W",
  a: "A",
  s: "S",
  d: "D"
};

const KEY_ORDER: MenuKey[] = ["w", "a", "s", "d"];

const KEY_POSITIONS: Record<MenuKey, { gridColumn: string; gridRow: string }> = {
  w: { gridColumn: "2", gridRow: "1" },
  a: { gridColumn: "1", gridRow: "2" },
  s: { gridColumn: "2", gridRow: "3" },
  d: { gridColumn: "3", gridRow: "2" }
};

function getChild(node: MenuNode, key: MenuKey) {
  return node[key];
}

function hasChildren(node: MenuNode) {
  return KEY_ORDER.some((key) => Boolean(getChild(node, key)));
}

function clampPosition(value: number, max: number, size: number) {
  return Math.max(12, Math.min(value, max - size - 12));
}

export function RightClickMenu({ root, x, y, onClose, onAction }: RightClickMenuProps) {
  const [currentNode, setCurrentNode] = useState<MenuNode>(root);
  const [history, setHistory] = useState<MenuNode[]>([]);
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setCurrentNode(root);
    setHistory([]);
  }, [root]);

  const entries = useMemo(() => {
    return KEY_ORDER.map((key) => ({
      key,
      node: getChild(currentNode, key)
    }));
  }, [currentNode]);

  function goBack() {
    setHistory((previous) => {
      if (previous.length === 0) {
        onClose();
        return previous;
      }

      const nextHistory = previous.slice(0, -1);
      const previousNode = previous[previous.length - 1];
      setCurrentNode(previousNode);
      return nextHistory;
    });
  }

  function chooseNode(nextNode: MenuNode | undefined) {
    if (!nextNode) return;

    if (nextNode.action) {
      onAction(nextNode.action);
      onClose();
      return;
    }

    if (hasChildren(nextNode)) {
      setHistory((previous) => [...previous, currentNode]);
      setCurrentNode(nextNode);
      return;
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();

      if (key === "escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (key === "shift" || key === "backspace") {
        event.preventDefault();
        goBack();
        return;
      }

      if (key === "w" || key === "a" || key === "s" || key === "d") {
        event.preventDefault();
        chooseNode(getChild(currentNode, key));
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;

      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [currentNode, onClose]);

  const menuWidth = 380;
  const menuHeight = 380;
  const left =
    typeof window === "undefined"
      ? x
      : clampPosition(x - menuWidth / 2, window.innerWidth, menuWidth);
  const top =
    typeof window === "undefined"
      ? y
      : clampPosition(y - menuHeight / 2, window.innerHeight, menuHeight);

  function renderDirectionButton(key: MenuKey, node: MenuNode | undefined) {
    const disabled = !node;
    const isAction = Boolean(node?.action);
    const isFolder = Boolean(node && !node.action && hasChildren(node));

    return (
      <button
        key={key}
        type="button"
        disabled={disabled}
        onClick={() => chooseNode(node)}
        style={{
          ...KEY_POSITIONS[key],
          width: 118,
          minHeight: 78,
          justifySelf: "center",
          alignSelf: "center",
          border: disabled ? "1px dashed #334155" : "1px solid #94a3b8",
          borderRadius: 16,
          padding: 8,
          background: disabled
            ? "rgba(15, 23, 42, 0.52)"
            : "rgba(15, 23, 42, 0.94)",
          color: disabled ? "#64748b" : "#fff",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          alignItems: "center",
          gap: 4,
          textAlign: "center",
          boxShadow: disabled
            ? "none"
            : "0 10px 24px rgba(0,0,0,.38), inset 0 0 0 1px rgba(255,255,255,.06)"
        }}
      >
        <span
          style={{
            justifySelf: "center",
            border: "1px solid #cbd5e1",
            borderRadius: 999,
            minWidth: 34,
            padding: "3px 8px",
            fontWeight: 900,
            background: disabled ? "#111827" : "#020617",
            color: disabled ? "#64748b" : "#e2e8f0"
          }}
        >
          {KEY_LABELS[key]}
        </span>

        <strong style={{ fontSize: 13, lineHeight: 1.25 }}>
          {node?.label ?? "未使用"}
        </strong>

        <span style={{ opacity: 0.7, fontSize: 11 }}>
          {isAction ? "実行" : isFolder ? "次へ" : ""}
        </span>
      </button>
    );
  }

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 100000,
        width: menuWidth,
        height: menuHeight,
        color: "#fff",
        display: "grid",
        gridTemplateColumns: "1fr",
        gridTemplateRows: "1fr",
        pointerEvents: "auto"
      }}
      role="menu"
      aria-label={currentNode.label}
    >
      <button
        type="button"
        onClick={onClose}
        title="閉じる"
        style={{
          position: "absolute",
          right: 6,
          top: 6,
          zIndex: 2,
          border: "1px solid #475569",
          borderRadius: 999,
          background: "rgba(15, 23, 42, 0.92)",
          color: "#fff",
          cursor: "pointer",
          padding: "5px 9px",
          fontSize: 12
        }}
      >
        Esc
      </button>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gridTemplateRows: "1fr 1fr 1fr",
          gap: 8
        }}
      >
        {entries.map(({ key, node }) => renderDirectionButton(key, node))}

        <div
          style={{
            gridColumn: "2",
            gridRow: "2",
            width: 116,
            height: 116,
            justifySelf: "center",
            alignSelf: "center",
            border: "1px solid #facc15",
            borderRadius: 20,
            background: "rgba(2, 6, 23, 0.96)",
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            padding: 10,
            boxShadow:
              "0 14px 36px rgba(0,0,0,.48), inset 0 0 0 1px rgba(250,204,21,.12)"
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: "#facc15", marginBottom: 5 }}>
              WASD
            </div>
            <strong style={{ fontSize: 14, lineHeight: 1.3 }}>
              {currentNode.label}
            </strong>
            <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 7 }}>
              Shiftで戻る
            </div>
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <button
          type="button"
          onClick={goBack}
          style={{
            position: "absolute",
            left: 6,
            bottom: 6,
            border: "1px solid #475569",
            borderRadius: 999,
            padding: "6px 10px",
            background: "rgba(15, 23, 42, 0.92)",
            color: "#fff",
            cursor: "pointer",
            fontSize: 12
          }}
        >
          Shift：戻る
        </button>
      )}
    </div>,
    document.body
  );
}
