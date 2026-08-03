import { Chessground } from "chessground";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";

export function createBoard(element, onMove) {
  return Chessground(element, { orientation: "white", coordinates: true, turnColor: "white", movable: { free: false, color: "white", events: { after: onMove } }, premovable: { enabled: false } });
}
