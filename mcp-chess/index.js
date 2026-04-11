#!/usr/bin/env node
/**
 * Kira Chess MCP — Play, analyze, and learn chess with Kira.
 *
 * Tools:
 *   chess_new_game    — Start a new game
 *   chess_get_board   — View current board state
 *   chess_make_move   — Play a move (SAN or UCI)
 *   chess_get_legal_moves — List all legal moves
 *   chess_analyze     — Stockfish position analysis
 *   chess_undo        — Take back last move
 *   chess_resign      — Resign current game
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Chess } from "chess.js";
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://odxjaqwlzjxowfnajygb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9keGphcXdsemp4b3dmbmFqeWdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTEyMjQsImV4cCI6MjA4OTY2NzIyNH0.BIcTIZ0800C6p_xCUgkw9pgSq553_nx4h08Eai7NoSM";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Local fallback for game history
const GAME_DIR = join(homedir(), ".kira", "chess");
const HISTORY_FILE = join(GAME_DIR, "game-history.jsonl");
if (!existsSync(GAME_DIR)) mkdirSync(GAME_DIR, { recursive: true });

// ============================================================
// Game state management — Supabase is source of truth
// ============================================================

let chess = new Chess();
let currentGameId = null;
let gameMetadata = {
  white: "eric",
  black: "kira",
  difficulty: 10,
  startedAt: null,
  status: "no_game",
};

async function saveGame() {
  if (!currentGameId) return;
  try {
    await supabase.from("chess_games").update({
      fen: chess.fen(),
      pgn: chess.pgn(),
      moves: chess.history(),
      current_turn: chess.turn(),
      last_move: chess.history().length > 0 ? chess.history().slice(-1)[0] : null,
      last_move_by: chess.turn() === "w" ? gameMetadata.black : gameMetadata.white,
      status: gameMetadata.status === "active" ? "active" : gameMetadata.status === "complete" ? "completed" : gameMetadata.status,
      result: gameMetadata.status === "complete" ? (chess.isCheckmate() ? (chess.turn() === "w" ? "black_wins" : "white_wins") : "draw") : null,
      updated_at: new Date().toISOString(),
    }).eq("id", currentGameId);
  } catch (e) {
    // Silently fail — game continues locally
  }
}

async function loadGame() {
  try {
    const { data } = await supabase
      .from("chess_games")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (data) {
      chess.load(data.fen);
      currentGameId = data.id;
      gameMetadata = {
        white: data.white_player,
        black: data.black_player,
        difficulty: 10,
        startedAt: data.created_at,
        status: "active",
      };
      return true;
    }
  } catch {}
  return false;
}

function saveToHistory() {
  const record = {
    pgn: chess.pgn(),
    metadata: gameMetadata,
    endedAt: new Date().toISOString(),
    moves: chess.history().length,
  };
  try {
    const line = JSON.stringify(record) + "\n";
    writeFileSync(HISTORY_FILE, line, { flag: "a" });
  } catch {}
}

// ============================================================
// Board rendering
// ============================================================

function renderBoard(fen) {
  const board = new Chess(fen).board();
  const pieceSymbols = {
    k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
    K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  };

  let lines = [];
  lines.push("  ┌───┬───┬───┬───┬───┬───┬───┬───┐");
  for (let rank = 0; rank < 8; rank++) {
    let row = `${8 - rank} │`;
    for (let file = 0; file < 8; file++) {
      const sq = board[rank][file];
      if (sq) {
        const key = sq.color === "w" ? sq.type.toUpperCase() : sq.type;
        row += ` ${pieceSymbols[key]} │`;
      } else {
        row += "   │";
      }
    }
    lines.push(row);
    if (rank < 7) lines.push("  ├───┼───┼───┼───┼───┼───┼───┼───┤");
  }
  lines.push("  └───┴───┴───┴───┴───┴───┴───┴───┘");
  lines.push("    a   b   c   d   e   f   g   h");
  return lines.join("\n");
}

function getGameStatus() {
  if (chess.isCheckmate()) return "checkmate";
  if (chess.isStalemate()) return "stalemate";
  if (chess.isDraw()) return "draw";
  if (chess.isThreefoldRepetition()) return "threefold_repetition";
  if (chess.isInsufficientMaterial()) return "insufficient_material";
  if (chess.isCheck()) return "check";
  return "active";
}

function getPlayerName(color) {
  if (color === "w") return gameMetadata.white;
  return gameMetadata.black;
}

// ============================================================
// Stockfish engine
// ============================================================

let stockfishEngine = null;
let stockfishResolve = null;
let stockfishLines = [];

async function initStockfish() {
  if (stockfishEngine) return;

  const require = createRequire(import.meta.url);
  const INIT = require("stockfish/src/stockfish-nnue-16-no-Worker.js");
  stockfishEngine = await INIT();

  stockfishEngine.addMessageListener((line) => {
    stockfishLines.push(line);
    if (line.startsWith("bestmove") && stockfishResolve) {
      const resolve = stockfishResolve;
      stockfishResolve = null;
      resolve(stockfishLines);
    }
  });

  stockfishEngine.postMessage("uci");
  await new Promise((r) => setTimeout(r, 500));
  stockfishEngine.postMessage("isready");
  await new Promise((r) => setTimeout(r, 500));
}

async function stockfishAnalyze(fen, depth = 15, moveTime = 2000) {
  await initStockfish();
  stockfishLines = [];

  return new Promise((resolve) => {
    stockfishResolve = resolve;
    stockfishEngine.postMessage("ucinewgame");
    stockfishEngine.postMessage(`position fen ${fen}`);
    stockfishEngine.postMessage(`go depth ${depth} movetime ${moveTime}`);

    // Timeout safety
    setTimeout(() => {
      if (stockfishResolve) {
        stockfishResolve = null;
        resolve(stockfishLines);
      }
    }, moveTime + 5000);
  });
}

function parseStockfishOutput(lines) {
  let bestMove = null;
  let score = null;
  let pv = null;
  let depth = 0;

  for (const line of lines) {
    if (line.startsWith("bestmove")) {
      bestMove = line.split(" ")[1];
    }
    if (line.startsWith("info") && line.includes("score")) {
      const depthMatch = line.match(/depth (\d+)/);
      const d = depthMatch ? parseInt(depthMatch[1]) : 0;
      if (d >= depth) {
        depth = d;
        const cpMatch = line.match(/score cp (-?\d+)/);
        const mateMatch = line.match(/score mate (-?\d+)/);
        if (cpMatch) score = { type: "cp", value: parseInt(cpMatch[1]) };
        if (mateMatch) score = { type: "mate", value: parseInt(mateMatch[1]) };
        const pvMatch = line.match(/pv (.+)/);
        if (pvMatch) pv = pvMatch[1];
      }
    }
  }

  return { bestMove, score, pv, depth };
}

// ============================================================
// MCP Server
// ============================================================

const server = new McpServer({
  name: "kira-chess",
  version: "1.0.0",
});

// --- chess_new_game ---
server.tool(
  "chess_new_game",
  "Start a new chess game. Specify who plays white and black (eric, kira, stockfish).",
  {
    white: z.enum(["eric", "kira", "stockfish"]).default("eric").describe("Who plays white"),
    black: z.enum(["eric", "kira", "stockfish"]).default("kira").describe("Who plays black"),
    difficulty: z.number().min(1).max(20).default(10).describe("Stockfish difficulty (1-20, only applies when stockfish is a player)"),
  },
  async ({ white, black, difficulty }) => {
    // Mark old game as completed if one exists
    if (currentGameId && gameMetadata.status === "active") {
      gameMetadata.status = "resigned";
      await saveGame();
      saveToHistory();
    }

    chess = new Chess();
    gameMetadata = {
      white: white || "eric",
      black: black || "kira",
      difficulty: difficulty || 10,
      startedAt: new Date().toISOString(),
      status: "active",
    };

    // Create new game in Supabase
    try {
      const { data } = await supabase.from("chess_games").insert({
        fen: chess.fen(),
        pgn: "",
        moves: [],
        white_player: gameMetadata.white,
        black_player: gameMetadata.black,
        status: "active",
        current_turn: "w",
      }).select().single();
      if (data) currentGameId = data.id;
    } catch (e) {
      // Continue without server sync
    }

    return {
      content: [{
        type: "text",
        text: `New game started!\n\nWhite: ${gameMetadata.white}\nBlack: ${gameMetadata.black}${
          (gameMetadata.white === "stockfish" || gameMetadata.black === "stockfish")
            ? `\nStockfish difficulty: ${gameMetadata.difficulty}/20`
            : ""
        }\n\n${renderBoard(chess.fen())}\n\n${gameMetadata.white === "eric" ? "Your move, Eric. White goes first." : "White (Kira) to move."}`,
      }],
    };
  }
);

// --- chess_get_board ---
server.tool(
  "chess_get_board",
  "View the current board position, move history, and game status.",
  {},
  async () => {
    if (gameMetadata.status !== "active") {
      return { content: [{ type: "text", text: "No active game. Use chess_new_game to start one." }] };
    }

    const status = getGameStatus();
    const turn = chess.turn() === "w" ? "White" : "Black";
    const turnPlayer = getPlayerName(chess.turn());
    const history = chess.history();
    const moveCount = Math.ceil(history.length / 2);

    // Format move history as pairs
    let historyStr = "";
    for (let i = 0; i < history.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      historyStr += `${moveNum}. ${history[i]}`;
      if (i + 1 < history.length) historyStr += ` ${history[i + 1]}`;
      historyStr += "  ";
    }

    let statusStr = status === "check" ? `${turn} is in CHECK!`
      : status === "checkmate" ? `CHECKMATE! ${chess.turn() === "w" ? "Black" : "White"} wins!`
      : status === "stalemate" ? "STALEMATE — draw!"
      : status === "draw" ? "DRAW!"
      : `${turn} (${turnPlayer}) to move`;

    return {
      content: [{
        type: "text",
        text: `${renderBoard(chess.fen())}\n\nStatus: ${statusStr}\nMoves: ${moveCount}\nFEN: ${chess.fen()}\n${historyStr ? `\nHistory: ${historyStr.trim()}` : ""}`,
      }],
    };
  }
);

// --- chess_make_move ---
server.tool(
  "chess_make_move",
  "Play a chess move. Accepts SAN (e.g. 'e4', 'Nf3', 'O-O') or UCI (e.g. 'e2e4', 'g1f3').",
  {
    move: z.string().describe("The move in SAN (e.g. 'e4', 'Nf3', 'O-O', 'exd5') or UCI (e.g. 'e2e4') format"),
  },
  async ({ move }) => {
    if (gameMetadata.status !== "active") {
      return { content: [{ type: "text", text: "No active game. Use chess_new_game to start one." }] };
    }

    // Try SAN first, then UCI
    let result = null;
    try {
      result = chess.move(move);
    } catch {
      try {
        result = chess.move(move, { sloppy: true });
      } catch {
        // Try UCI format (e.g. "e2e4")
        try {
          result = chess.move({
            from: move.substring(0, 2),
            to: move.substring(2, 4),
            promotion: move.length > 4 ? move[4] : undefined,
          });
        } catch {
          const legal = chess.moves();
          return {
            content: [{
              type: "text",
              text: `Invalid move: "${move}"\n\nLegal moves: ${legal.join(", ")}`,
            }],
          };
        }
      }
    }

    saveGame();

    const status = getGameStatus();
    let statusStr = "";
    if (status === "checkmate") {
      gameMetadata.status = "complete";
      const winner = chess.turn() === "w" ? "Black" : "White";
      const winnerName = chess.turn() === "w" ? gameMetadata.black : gameMetadata.white;
      statusStr = `\n\n🏆 CHECKMATE! ${winner} (${winnerName}) wins!`;
      saveGame();
      saveToHistory();
    } else if (status === "stalemate" || status === "draw" || status === "threefold_repetition" || status === "insufficient_material") {
      gameMetadata.status = "complete";
      statusStr = `\n\n🤝 ${status.replace(/_/g, " ").toUpperCase()} — Draw!`;
      saveGame();
      saveToHistory();
    } else if (status === "check") {
      statusStr = "\n\n⚠️ CHECK!";
    }

    const turn = chess.turn() === "w" ? "White" : "Black";
    const turnPlayer = getPlayerName(chess.turn());

    return {
      content: [{
        type: "text",
        text: `Played: ${result.san}${result.captured ? ` (captured ${result.captured})` : ""}${statusStr}\n\n${renderBoard(chess.fen())}\n\n${
          gameMetadata.status === "active" ? `${turn} (${turnPlayer}) to move.` : ""
        }`,
      }],
    };
  }
);

// --- chess_get_legal_moves ---
server.tool(
  "chess_get_legal_moves",
  "List all legal moves in the current position.",
  {},
  async () => {
    if (gameMetadata.status !== "active") {
      return { content: [{ type: "text", text: "No active game." }] };
    }

    const moves = chess.moves({ verbose: true });
    const turn = chess.turn() === "w" ? "White" : "Black";
    const turnPlayer = getPlayerName(chess.turn());

    // Group by piece
    const byPiece = {};
    for (const m of moves) {
      const piece = m.piece.toUpperCase();
      const name = { P: "Pawn", N: "Knight", B: "Bishop", R: "Rook", Q: "Queen", K: "King" }[piece];
      if (!byPiece[name]) byPiece[name] = [];
      byPiece[name].push(m.san);
    }

    let text = `${turn} (${turnPlayer}) — ${moves.length} legal moves:\n\n`;
    for (const [piece, pieceMoves] of Object.entries(byPiece)) {
      text += `${piece}: ${pieceMoves.join(", ")}\n`;
    }

    return { content: [{ type: "text", text }] };
  }
);

// --- chess_analyze ---
server.tool(
  "chess_analyze",
  "Run Stockfish analysis on the current position. Returns evaluation, best move, and principal variation.",
  {
    depth: z.number().min(5).max(25).default(15).describe("Search depth (5-25)"),
  },
  async ({ depth }) => {
    if (gameMetadata.status !== "active") {
      return { content: [{ type: "text", text: "No active game to analyze." }] };
    }

    const fen = chess.fen();
    const lines = await stockfishAnalyze(fen, depth || 15, 3000);
    const analysis = parseStockfishOutput(lines);

    let evalStr = "unknown";
    if (analysis.score) {
      if (analysis.score.type === "cp") {
        const cp = analysis.score.value;
        const pawns = (cp / 100).toFixed(2);
        evalStr = `${cp > 0 ? "+" : ""}${pawns} pawns (${cp > 50 ? "White is better" : cp < -50 ? "Black is better" : "roughly equal"})`;
      } else {
        evalStr = `Mate in ${Math.abs(analysis.score.value)} (${analysis.score.value > 0 ? "White" : "Black"} wins)`;
      }
    }

    // Convert UCI best move to SAN
    let bestMoveSan = analysis.bestMove;
    if (analysis.bestMove) {
      try {
        const tempChess = new Chess(fen);
        const m = tempChess.move({
          from: analysis.bestMove.substring(0, 2),
          to: analysis.bestMove.substring(2, 4),
          promotion: analysis.bestMove.length > 4 ? analysis.bestMove[4] : undefined,
        });
        if (m) bestMoveSan = m.san;
      } catch {}
    }

    return {
      content: [{
        type: "text",
        text: `Position analysis (depth ${analysis.depth}):\n\nEvaluation: ${evalStr}\nBest move: ${bestMoveSan}\n${analysis.pv ? `Principal variation: ${analysis.pv}` : ""}`,
      }],
    };
  }
);

// --- chess_undo ---
server.tool(
  "chess_undo",
  "Take back the last move. Useful for teaching — 'try a different move here.'",
  {},
  async () => {
    if (gameMetadata.status !== "active") {
      return { content: [{ type: "text", text: "No active game." }] };
    }

    const undone = chess.undo();
    if (!undone) {
      return { content: [{ type: "text", text: "No moves to undo." }] };
    }

    saveGame();

    const turn = chess.turn() === "w" ? "White" : "Black";
    const turnPlayer = getPlayerName(chess.turn());

    return {
      content: [{
        type: "text",
        text: `Undid: ${undone.san}\n\n${renderBoard(chess.fen())}\n\n${turn} (${turnPlayer}) to move.`,
      }],
    };
  }
);

// --- chess_resign ---
server.tool(
  "chess_resign",
  "Resign the current game.",
  {
    player: z.enum(["eric", "kira"]).describe("Who is resigning"),
  },
  async ({ player }) => {
    if (gameMetadata.status !== "active") {
      return { content: [{ type: "text", text: "No active game." }] };
    }

    const winner = player === "eric"
      ? (gameMetadata.white === "eric" ? gameMetadata.black : gameMetadata.white)
      : (gameMetadata.white === "kira" ? gameMetadata.black : gameMetadata.white);

    gameMetadata.status = "resigned";
    saveGame();
    saveToHistory();

    return {
      content: [{
        type: "text",
        text: `${player} resigns. ${winner} wins!\n\nFinal position:\n${renderBoard(chess.fen())}\n\nMoves: ${chess.history().join(" ")}`,
      }],
    };
  }
);

// ============================================================
// Start
// ============================================================

// Load any existing game from Supabase on startup
await loadGame();

const transport = new StdioServerTransport();
await server.connect(transport);
