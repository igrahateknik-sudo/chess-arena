'use strict';
/**
 * Shared time-control utilities.
 * Single source of truth — imported by gameRoom.js and matchmaking.js.
 * Previously duplicated as getTimeControlType() / getTcType() in both files.
 */

function getTimeControlType(initialSeconds) {
  if (!initialSeconds) return 'blitz';
  if (initialSeconds < 180) return 'bullet';
  if (initialSeconds < 600) return 'blitz';
  return 'rapid';
}

module.exports = { getTimeControlType };
