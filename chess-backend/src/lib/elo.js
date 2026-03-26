/**
 * FIDE-standard ELO calculation
 */

const K_FACTOR = {
  new: 40,       // < 30 games or rating < 1000
  standard: 20,  // < 2400
  master: 10,    // >= 2400
};

function getKFactor(rating, gamesPlayed) {
  if (gamesPlayed < 30 || rating < 1000) return K_FACTOR.new;
  if (rating >= 2400) return K_FACTOR.master;
  return K_FACTOR.standard;
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function calculateEloChange(playerRating, opponentRating, result, gamesPlayed = 30) {
  const K = getKFactor(playerRating, gamesPlayed);
  const expected = expectedScore(playerRating, opponentRating);
  const actual = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
  return Math.round(K * (actual - expected));
}

function calculateBothElo(whiteRating, blackRating, result) {
  // result: 'white' | 'black' | 'draw'
  const whiteResult = result === 'white' ? 'win' : result === 'draw' ? 'draw' : 'loss';
  const blackResult = result === 'black' ? 'win' : result === 'draw' ? 'draw' : 'loss';

  return {
    whiteChange: calculateEloChange(whiteRating, blackRating, whiteResult),
    blackChange: calculateEloChange(blackRating, whiteRating, blackResult),
  };
}

module.exports = { calculateBothElo, calculateEloChange };
