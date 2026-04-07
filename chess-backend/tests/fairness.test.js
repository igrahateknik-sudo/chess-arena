const { __testOnly } = require('../src/socket/gameRoom');

describe('fairness rules', () => {
  it('marks dual-disconnect as shared fault', () => {
    const responsible = __testOnly.deriveDisconnectResponsibility('u1', true);
    expect(responsible).toBeNull();
  });

  it('marks single disconnect as responsible player', () => {
    const responsible = __testOnly.deriveDisconnectResponsibility('u1', false);
    expect(responsible).toBe('u1');
  });

  it('keeps aborted with >=2 moves out of no-contest', () => {
    const result = __testOnly.computeFairnessOutcome('aborted', 2, 'u1');
    expect(result.isNoContest).toBe(false);
    expect(result.fairnessOutcome).toBe('normal');
  });

  it('keeps disconnect with 0 moves as no-contest', () => {
    const result = __testOnly.computeFairnessOutcome('disconnect', 0, 'u1');
    expect(result.isNoContest).toBe(true);
    expect(result.finalEndReason).toBe('disconnect|resp:u1');
  });
});
