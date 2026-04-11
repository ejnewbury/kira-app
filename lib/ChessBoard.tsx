/**
 * Kira Chess Board — Interactive chess component for the Kira app.
 *
 * Features:
 * - Tap to select, tap to move
 * - Legal move highlighting
 * - Move history
 * - Kira's moves via backend/MCP
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  ScrollView,
  ActivityIndicator,
} from "react-native";
// @ts-ignore — chess.js types
import { Chess } from "chess.js";
import { supabase } from "./supabase";

const BOARD_SIZE = Math.min(Dimensions.get("window").width - 32, 400);
const SQUARE_SIZE = BOARD_SIZE / 8;

// Unicode chess pieces
const PIECE_SYMBOLS: Record<string, string> = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};

// Mirror's Edge aesthetic — barely visible grid
const LIGHT_SQUARE = "#FAFAFA";
const DARK_SQUARE = "#F0F0F0";
const SELECTED_COLOR = "rgba(255, 68, 34, 0.12)";
const LEGAL_MOVE_COLOR = "rgba(255, 68, 34, 0.08)";
const LAST_MOVE_COLOR = "rgba(0, 200, 255, 0.1)";

// Module-level game instance — survives screen switches
let persistentGame: InstanceType<typeof Chess> | null = null;
let currentGameId: string | null = null;

function getGame(): InstanceType<typeof Chess> {
  if (!persistentGame) persistentGame = new Chess();
  return persistentGame;
}

async function saveGameToSupabase(game: any) {
  if (!currentGameId) return;
  try {
    const history = game.history();
    await supabase.from("chess_games").update({
      fen: game.fen(),
      pgn: game.pgn(),
      moves: history,
      current_turn: game.turn(),
      last_move: history.length > 0 ? history[history.length - 1] : null,
      last_move_by: game.turn() === "w" ? "kira" : "eric",
      status: game.isGameOver() ? "completed" : "active",
      updated_at: new Date().toISOString(),
    }).eq("id", currentGameId);
  } catch {}
}

async function loadGameFromSupabase(): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("chess_games")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (data) {
      currentGameId = data.id;
      return data.fen;
    }
  } catch {}
  return null;
}

interface ChessBoardProps {
  onGameOver?: (result: string) => void;
  onKiraMoveRequest?: (fen: string, moveHistory: string[]) => Promise<string | null>;
}

export default function ChessBoard({ onGameOver, onKiraMoveRequest }: ChessBoardProps) {
  const [game] = useState(() => getGame());
  const [board, setBoard] = useState(() => game.board());
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [moveHistory, setMoveHistory] = useState<string[]>(() => game.history());
  const [isKiraThinking, setIsKiraThinking] = useState(false);
  const [status, setStatus] = useState(() => {
    if (game.isGameOver()) return "Game over";
    return game.turn() === "w" ? "Your move (White)" : "Kira thinking...";
  });
  const [gameOver, setGameOver] = useState(() => game.isGameOver());

  // Restore board state from Supabase on mount + subscribe to Realtime
  useEffect(() => {
    (async () => {
      // Load active game from Supabase
      const savedFen = await loadGameFromSupabase();
      if (savedFen && savedFen !== "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1") {
        try {
          game.load(savedFen);
        } catch {}
      }

      setBoard([...game.board()]);
      setMoveHistory([...game.history()]);
      if (game.isGameOver()) {
        setGameOver(true);
      } else {
        setStatus(game.turn() === "w" ? "Your move (White)" : "Kira thinking...");
      }
    })();

    // Subscribe to Realtime updates for Kira's moves
    // Note: filter uses currentGameId which is now set by loadGameFromSupabase above
    const gameIdForFilter = currentGameId;
    if (!gameIdForFilter) return; // No game to subscribe to yet
    const channel = supabase
      .channel("chess-moves")
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "chess_games",
        filter: `id=eq.${gameIdForFilter}`,
      }, (payload: any) => {
        const row = payload.new;
        // Only process if it's now Eric's turn (Kira just moved)
        if (row.current_turn === "w" && row.last_move_by === "kira") {
          try {
            game.load(row.fen);
            const history = game.history();
            setBoard([...game.board()]);
            setMoveHistory([...history]);
            setIsKiraThinking(false);
            if (row.last_move) {
              // Find the last move's from/to for highlighting
              const tempGame = new Chess(row.fen);
              tempGame.undo();
              const lastMoveObj = tempGame.move(row.last_move);
              if (lastMoveObj) setLastMove({ from: lastMoveObj.from, to: lastMoveObj.to });
            }
            if (game.isGameOver()) {
              setGameOver(true);
            } else {
              setStatus("Your move (White)");
            }
          } catch {}
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const updateBoard = useCallback(() => {
    setBoard([...game.board()]);
    const history = game.history();
    setMoveHistory([...history]);
    saveGameToSupabase(game); // Persist to Supabase after every move

    if (game.isCheckmate()) {
      const winner = game.turn() === "w" ? "Kira" : "Eric";
      setStatus(`Checkmate! ${winner} wins!`);
      setGameOver(true);
      onGameOver?.(`${winner} wins by checkmate`);
    } else if (game.isDraw()) {
      setStatus("Draw!");
      setGameOver(true);
      onGameOver?.("Draw");
    } else if (game.isCheck()) {
      setStatus(game.turn() === "w" ? "Check! Your move" : "Check! Kira thinking...");
    } else {
      setStatus(game.turn() === "w" ? "Your move (White)" : "Kira thinking...");
    }
  }, [game, onGameOver]);

  const requestKiraMove = useCallback(async () => {
    if (gameOver || game.turn() !== "b") return;

    setIsKiraThinking(true);
    try {
      if (onKiraMoveRequest) {
        const move = await onKiraMoveRequest(game.fen(), game.history());
        if (move) {
          // Try SAN format first, then UCI
          let result = game.move(move);
          if (!result) {
            // Try as UCI (e.g., "e7e5")
            result = game.move({ from: move.substring(0, 2), to: move.substring(2, 4), promotion: move[4] || undefined });
          }
          if (result) {
            setLastMove({ from: result.from, to: result.to });
            updateBoard();
          } else {
            console.warn("Invalid move from Kira:", move);
          }
        }
        // If move is null, Kira is still thinking — don't play random, just wait
      }
    } catch (e) {
      console.warn("Kira move error:", e);
      // Don't play random — just log and wait
    } finally {
      setIsKiraThinking(false);
    }
  }, [game, gameOver, onKiraMoveRequest, updateBoard]);

  // Trigger Kira's move when it's black's turn (only on new moves)
  const kiraThinkingRef = React.useRef(false);
  useEffect(() => {
    if (game.turn() === "b" && !gameOver && !kiraThinkingRef.current) {
      kiraThinkingRef.current = true;
      setIsKiraThinking(true);
      const timer = setTimeout(async () => {
        await requestKiraMove();
        kiraThinkingRef.current = false;
      }, 500);
      return () => { clearTimeout(timer); kiraThinkingRef.current = false; };
    }
  }, [moveHistory.length, gameOver]);

  const handleSquarePress = useCallback(
    (row: number, col: number) => {
      if (gameOver || game.turn() !== "w" || isKiraThinking) return;

      const file = String.fromCharCode(97 + col); // a-h
      const rank = String(8 - row); // 8-1
      const square = `${file}${rank}`;

      if (selectedSquare) {
        // Try to make a move
        try {
          const move = game.move({ from: selectedSquare, to: square, promotion: "q" });
          if (move) {
            setLastMove({ from: move.from, to: move.to });
            setSelectedSquare(null);
            setLegalMoves([]);
            updateBoard();
            return;
          }
        } catch {}

        // If the clicked square has our piece, select it instead
        const piece = game.get(square as any);
        if (piece && piece.color === "w") {
          setSelectedSquare(square);
          const moves = game.moves({ square: square as any, verbose: true });
          setLegalMoves(moves.map((m: any) => m.to));
          return;
        }

        // Deselect
        setSelectedSquare(null);
        setLegalMoves([]);
      } else {
        // Select a piece
        const piece = game.get(square as any);
        if (piece && piece.color === "w") {
          setSelectedSquare(square);
          const moves = game.moves({ square: square as any, verbose: true });
          setLegalMoves(moves.map((m: any) => m.to));
        }
      }
    },
    [game, selectedSquare, gameOver, isKiraThinking, updateBoard]
  );

  const newGame = useCallback(async () => {
    // Mark old game as completed
    if (currentGameId) {
      await supabase.from("chess_games").update({ status: "completed" }).eq("id", currentGameId);
    }
    persistentGame = new Chess();
    game.reset();
    // Create new game in Supabase
    try {
      const { data } = await supabase.from("chess_games").insert({
        fen: game.fen(),
        white_player: "eric",
        black_player: "kira",
        status: "active",
        current_turn: "w",
      }).select().single();
      if (data) currentGameId = data.id;
    } catch {}
    setSelectedSquare(null);
    setLegalMoves([]);
    setLastMove(null);
    setMoveHistory([]);
    setIsKiraThinking(false);
    setGameOver(false);
    updateBoard();
  }, [game, updateBoard]);

  const squareToCoords = (sq: string) => {
    const col = sq.charCodeAt(0) - 97;
    const row = 8 - parseInt(sq[1]);
    return { row, col };
  };

  return (
    <View style={styles.container}>
      <Text style={styles.status}>
        {isKiraThinking ? "🤔 " : ""}
        {status}
      </Text>

      {/* Board */}
      <View style={[styles.board, { width: BOARD_SIZE, height: BOARD_SIZE }]}>
        {board.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={{ flexDirection: "row", width: BOARD_SIZE, height: SQUARE_SIZE }}>
          {row.map((piece, colIndex) => {
            const file = String.fromCharCode(97 + colIndex);
            const rank = String(8 - rowIndex);
            const square = `${file}${rank}`;
            const isLight = (rowIndex + colIndex) % 2 === 0;
            const isSelected = selectedSquare === square;
            const isLegalMove = legalMoves.includes(square);
            const isLastMove =
              lastMove?.from === square || lastMove?.to === square;

            let bgColor = isLight ? LIGHT_SQUARE : DARK_SQUARE;
            if (isSelected) bgColor = SELECTED_COLOR;

            const pieceKey = piece
              ? `${piece.color}${piece.type}`
              : null;

            return (
              <Pressable
                key={square}
                onPress={() => handleSquarePress(rowIndex, colIndex)}
                style={[
                  styles.square,
                  {
                    width: SQUARE_SIZE,
                    height: SQUARE_SIZE,
                    backgroundColor: bgColor,
                  },
                ]}
              >
                {isLastMove && (
                  <View
                    style={[
                      StyleSheet.absoluteFill,
                      { backgroundColor: LAST_MOVE_COLOR },
                    ]}
                  />
                )}
                {isLegalMove && (
                  <View
                    style={[
                      styles.legalMoveIndicator,
                      piece
                        ? styles.legalMoveCapture
                        : styles.legalMoveDot,
                    ]}
                  />
                )}
                {pieceKey && (
                  <Text
                    style={[
                      styles.piece,
                      { fontSize: SQUARE_SIZE * 0.7 },
                      piece?.color === "b" && styles.blackPiece,
                    ]}
                  >
                    {PIECE_SYMBOLS[pieceKey]}
                  </Text>
                )}
                {/* Rank labels */}
                {colIndex === 0 && (
                  <Text
                    style={[
                      styles.label,
                      styles.rankLabel,
                      { color: isLight ? DARK_SQUARE : LIGHT_SQUARE },
                    ]}
                  >
                    {rank}
                  </Text>
                )}
                {/* File labels */}
                {rowIndex === 7 && (
                  <Text
                    style={[
                      styles.label,
                      styles.fileLabel,
                      { color: isLight ? DARK_SQUARE : LIGHT_SQUARE },
                    ]}
                  >
                    {file}
                  </Text>
                )}
              </Pressable>
            );
          })}
          </View>
        ))}
      </View>

      {/* Loading indicator */}
      {isKiraThinking && (
        <ActivityIndicator
          size="small"
          color="#FF4422"
          style={{ marginTop: 8 }}
        />
      )}

      {/* Move history */}
      <ScrollView
        style={styles.historyContainer}
        contentContainerStyle={styles.historyContent}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {moveHistory.map((move, i) => (
          <Text key={i} style={styles.moveText}>
            {i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ""}
            {move}{" "}
          </Text>
        ))}
      </ScrollView>

      {/* Controls */}
      <View style={styles.controls}>
        <Pressable style={styles.button} onPress={newGame}>
          <Text style={styles.buttonText}>New Game</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    padding: 16,
  },
  status: {
    color: "#1A1C1C",
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 3,
    textTransform: "uppercase",
    marginBottom: 16,
  },
  board: {
    flexDirection: "column",
    borderWidth: 1,
    borderColor: "#E8E8E8",
    overflow: "hidden",
  },
  square: {
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  piece: {
    textAlign: "center",
    color: "#1A1C1C",
  },
  blackPiece: {
    color: "#FF4422",
  },
  legalMoveIndicator: {
    position: "absolute",
    zIndex: 1,
  },
  legalMoveDot: {
    width: SQUARE_SIZE * 0.25,
    height: SQUARE_SIZE * 0.25,
    backgroundColor: LEGAL_MOVE_COLOR,
  },
  legalMoveCapture: {
    width: SQUARE_SIZE * 0.9,
    height: SQUARE_SIZE * 0.9,
    borderWidth: 2,
    borderColor: LEGAL_MOVE_COLOR,
  },
  label: {
    position: "absolute",
    fontSize: 8,
    fontWeight: "400",
    letterSpacing: 1,
    color: "#CCCCCC",
  },
  rankLabel: {
    top: 2,
    left: 3,
  },
  fileLabel: {
    bottom: 1,
    right: 3,
  },
  historyContainer: {
    maxHeight: 32,
    marginTop: 16,
    maxWidth: BOARD_SIZE,
  },
  historyContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  moveText: {
    color: "#999",
    fontSize: 10,
    fontFamily: "monospace",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  controls: {
    flexDirection: "row",
    marginTop: 16,
    gap: 12,
  },
  button: {
    backgroundColor: "#FF4422",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
  },
  buttonText: {
    color: "#FFF",
    fontWeight: "600",
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
});
