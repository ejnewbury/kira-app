/**
 * Kira Chess Board — Interactive chess component for the Kira app.
 *
 * Features:
 * - Tap to select, tap to move
 * - Legal move highlighting
 * - Move history
 * - Kira's moves via backend/MCP
 */

import React, { useState, useCallback, useEffect } from "react";
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

const BOARD_SIZE = Math.min(Dimensions.get("window").width - 32, 400);
const SQUARE_SIZE = BOARD_SIZE / 8;

// Unicode chess pieces
const PIECE_SYMBOLS: Record<string, string> = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};

const LIGHT_SQUARE = "#E8D5B5";
const DARK_SQUARE = "#B58863";
const SELECTED_COLOR = "rgba(255, 255, 0, 0.4)";
const LEGAL_MOVE_COLOR = "rgba(0, 200, 0, 0.3)";
const LAST_MOVE_COLOR = "rgba(100, 150, 255, 0.3)";

interface ChessBoardProps {
  onGameOver?: (result: string) => void;
  onKiraMoveRequest?: (fen: string, moveHistory: string[]) => Promise<string | null>;
}

export default function ChessBoard({ onGameOver, onKiraMoveRequest }: ChessBoardProps) {
  const [game] = useState(() => new Chess());
  const [board, setBoard] = useState(game.board());
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [isKiraThinking, setIsKiraThinking] = useState(false);
  const [status, setStatus] = useState("Your move (White)");
  const [gameOver, setGameOver] = useState(false);

  const updateBoard = useCallback(() => {
    setBoard([...game.board()]);
    const history = game.history();
    setMoveHistory([...history]);

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

  const newGame = useCallback(() => {
    game.reset();
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
          color="#2A9D8F"
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
    color: "#E0E0E0",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  board: {
    flexDirection: "column",
    borderWidth: 2,
    borderColor: "#5D4E37",
    borderRadius: 4,
    overflow: "hidden",
  },
  square: {
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  piece: {
    textAlign: "center",
  },
  blackPiece: {
    textShadowColor: "rgba(0,0,0,0.3)",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  legalMoveIndicator: {
    position: "absolute",
    zIndex: 1,
  },
  legalMoveDot: {
    width: SQUARE_SIZE * 0.3,
    height: SQUARE_SIZE * 0.3,
    borderRadius: SQUARE_SIZE * 0.15,
    backgroundColor: LEGAL_MOVE_COLOR,
  },
  legalMoveCapture: {
    width: SQUARE_SIZE * 0.9,
    height: SQUARE_SIZE * 0.9,
    borderRadius: SQUARE_SIZE * 0.45,
    borderWidth: 3,
    borderColor: LEGAL_MOVE_COLOR,
  },
  label: {
    position: "absolute",
    fontSize: 9,
    fontWeight: "700",
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
    maxHeight: 40,
    marginTop: 12,
    maxWidth: BOARD_SIZE,
  },
  historyContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  moveText: {
    color: "#AAA",
    fontSize: 14,
    fontFamily: "monospace",
  },
  controls: {
    flexDirection: "row",
    marginTop: 12,
    gap: 12,
  },
  button: {
    backgroundColor: "#2A9D8F",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 16,
  },
});
